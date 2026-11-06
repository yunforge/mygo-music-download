// MyGo Music 插件 — 音乐下载 / Music Download
// 数据来源：https://flac.music.hi.cn/ （多站合一：网易云音乐 wyy / 酷我音乐 kuwo）
// 导出能力：home, browse, search, album, stream, lyrics
//
// 架构说明：
//   search   —— 按设置里的 platform（wyy / kuwo / all）检索歌曲，支持分页（offset）。
//   stream   —— 播放 / 下载共用。按 quality 选择音源：
//               lossless → flac；high → mp3 320；standard → mp3 128。
//               可在插件设置里用 quality 覆盖 App 全局音质；留空则跟随 App。
//               返回的 type 决定下载文件扩展名，因此“无损”质量会下载到 .flac 文件。
//   lyrics   —— 拉取 LRC 歌词。
//   album    —— 专辑详情 + 曲目。
//   home/browse —— 首页与榜单（网易云歌单，榜单带封面）。
//
// 反爬要点：getUrl / getLyric 需要 time + sign，且会过期；每次调用前先用
// act=song 取一次最新的 time/sign/minfo。直链音频需要带 Referer 才能下载。

const API_BASE = "https://flac.music.hi.cn/ajax.php?act=";
const PAGE = 20;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// 网易云榜单（歌单 id）
const CHARTS = [
  { title: "热歌榜", id: "3778678" },
  { title: "新歌榜", id: "3779629" },
  { title: "飙升榜", id: "19723756" },
  { title: "原创榜", id: "2884035" },
];

// 供 host.t 翻译
function t(s) {
  try {
    return host.t(s);
  } catch (e) {
    return s;
  }
}

function fail(code, message) {
  const e = new Error(message);
  e.code = code; // signIn | setup | unavailable | unsupported
  return e;
}

// 表单编码（不依赖 URLSearchParams）
function enc(params) {
  return Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== "")
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(String(params[k])))
    .join("&");
}

async function api(act, params) {
  let res;
  try {
    res = await fetch(API_BASE + act, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Accept: "application/json",
      },
      body: enc(params || {}),
    });
  } catch (e) {
    throw fail("unavailable", act + ": " + ((e && e.message) || e));
  }
  if (!res.ok) throw fail("unavailable", act + ": HTTP " + res.status);
  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw fail("unavailable", act + ": invalid JSON");
  }
  if (!json || json.code !== 0) {
    throw fail("unavailable", (json && json.msg) || act + " failed");
  }
  return json.data;
}

// 读取设置里的搜索来源：wyy / kuwo / all（默认 all）
function currentMode() {
  let v = "";
  try {
    v = String(host.setting("platform") || "").trim().toLowerCase();
  } catch (e) {}
  if (/^(kuwo|k|2|酷我|酷我音乐)$/.test(v)) return "kuwo";
  if (/^(wyy|w|1|netease|网易|网易云|网易云音乐)$/.test(v)) return "wyy";
  return "all";
}

// 插件内“下载音质”设置：覆盖 App 的全局音质；留空则跟随 App
function settingQuality() {
  let v = "";
  try {
    v = String(host.setting("quality") || "").trim().toLowerCase();
  } catch (e) {}
  if (/^(lossless|flac|无损|sq)$/.test(v)) return "lossless";
  if (/^(high|320|hq|高音质|高)$/.test(v)) return "high";
  if (/^(standard|128|std|标准)$/.test(v)) return "standard";
  return "";
}

// id 形如 "<platform>:<songId>" / "<platform>:<albumId>"
function parseId(id) {
  const s = String(id == null ? "" : id);
  const i = s.indexOf(":");
  if (i < 0) return { platform: "", id: s };
  return { platform: s.slice(0, i), id: s.slice(i + 1) };
}

// 接口歌曲对象 → MyGo Track
function songToTrack(platform, it) {
  const albumId = it.album_id ? platform + ":" + it.album_id : "";
  return {
    id: platform + ":" + it.id,
    name: it.name || "",
    artists: [{ id: "", name: it.artist || "", imageUrl: "" }],
    album: {
      id: albumId,
      name: it.album_name || "",
      imageUrl: it.pic_url || "",
    },
    duration: Math.round(Number(it.duration || 0) * 1000), // 秒 → 毫秒
    url: it.link || "",
    unavailable: false,
  };
}

// 按绝对下标 [start, start+count) 拉取某平台搜索结果
async function fetchRange(platform, keyword, start, count) {
  const out = [];
  let total = 0;
  if (count <= 0) return { items: out, total };
  const firstPage = Math.floor(start / PAGE) + 1;
  const lastPage = Math.floor((start + count - 1) / PAGE) + 1;
  for (let p = firstPage; p <= lastPage; p++) {
    let d;
    try {
      d = await api("search", { platform: platform, keyword: keyword, page: p, size: PAGE });
    } catch (e) {
      break; // 某站失败不影响另一站
    }
    total = Number(d && d.total) || total;
    const list = (d && d.list) || [];
    if (list.length === 0) break;
    for (let i = 0; i < list.length; i++) {
      const abs = (p - 1) * PAGE + i;
      if (abs >= start && abs < start + count) out.push(list[i]);
    }
    if (list.length < PAGE) break;
  }
  return { items: out, total: total };
}

async function totalOf(platform, keyword) {
  try {
    const d = await api("search", { platform: platform, keyword: keyword, page: 1, size: PAGE });
    const list = (d && d.list) || [];
    if (list.length === 0) return 0; // 处理“total>0 但列表为空”的站点怪癖
    return Number(d.total) || list.length;
  } catch (e) {
    return 0;
  }
}

async function doSearch(keyword, offset) {
  const mode = currentMode();
  const count = PAGE;
  if (mode === "all") {
    const totals = await Promise.all([totalOf("wyy", keyword), totalOf("kuwo", keyword)]);
    const wyyTotal = totals[0];
    const kuwoTotal = totals[1];
    const combinedTotal = wyyTotal + kuwoTotal;
    const end = Math.min(offset + count, combinedTotal);
    const tracks = [];
    // 合并顺序：先网易云，再酷我（连续、无空洞，保证 offset 语义正确）
    const wa0 = offset;
    const wa1 = Math.min(end, wyyTotal);
    if (wa1 > wa0) {
      const r = await fetchRange("wyy", keyword, wa0, wa1 - wa0);
      for (const it of r.items) tracks.push(songToTrack("wyy", it));
    }
    const ka0 = Math.max(offset, wyyTotal);
    const ka1 = end;
    if (ka1 > ka0) {
      const r = await fetchRange("kuwo", keyword, ka0 - wyyTotal, ka1 - ka0);
      for (const it of r.items) tracks.push(songToTrack("kuwo", it));
    }
    return { tracks: tracks, more: offset + count < combinedTotal };
  }
  const r = await fetchRange(mode, keyword, offset, count);
  return {
    tracks: r.items.map((it) => songToTrack(mode, it)),
    more: offset + count < r.total,
  };
}

export async function search({ query, kind, offset }) {
  kind = kind || "tracks";
  offset = Math.max(0, Number(offset) || 0);
  const q = String(query == null ? "" : query).trim();
  if (!q || kind !== "tracks") return { [kind]: [], more: false };
  const r = await doSearch(q, offset);
  return { [kind]: r.tracks, more: r.more };
}

export async function album({ id }) {
  const p = parseId(id);
  if (p.platform !== "wyy" && p.platform !== "kuwo") {
    throw fail("unavailable", "invalid album id");
  }
  const d = await api("album", { platform: p.platform, id: p.id, page: 1, size: 100 });
  const info = (d && d.info) || {};
  const tracks = ((d && d.list) || []).map((it) => songToTrack(p.platform, it));
  return {
    album: {
      id: String(id),
      name: info.name || "",
      imageUrl: info.pic_url || "",
      description: info.description || "",
      artists: [{ id: "", name: info.artist || "" }],
      released: "",
    },
    tracks: tracks,
  };
}

// 依据质量挑音源：lossless→flac，high→mp3 320，standard→mp3 128
function pickMinfo(minfo, quality) {
  const list = Array.isArray(minfo) ? minfo.filter((m) => m && m.format) : [];
  const flac = list.find((m) => m.format === "flac");
  const mp3 = list.filter((m) => m.format === "mp3");
  const mp3_320 = mp3.find((m) => String(m.bitrate) === "320") || mp3[0];
  const mp3_128 =
    mp3.find((m) => String(m.bitrate) === "128") || mp3[mp3.length - 1];
  if (quality === "lossless") return flac || mp3_320 || null;
  if (quality === "standard") return mp3_128 || mp3_320 || flac || null;
  return mp3_320 || flac || null; // high
}

function parseSize(s) {
  if (typeof s === "number" && isFinite(s)) return Math.round(s);
  const m = /([\d.]+)\s*([KMGT]?B)/i.exec(String(s == null ? "" : s));
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return undefined;
  const mult =
    { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024, TB: 1024 * 1024 * 1024 * 1024 }[
      m[2].toUpperCase()
    ] || 1;
  return Math.round(n * mult);
}

export async function stream({ id, quality }) {
  // 插件设置里的音质优先，其次用 App 传入的，最后默认 high
  quality = settingQuality() || quality || "high";
  const p = parseId(id);
  if (p.platform !== "wyy" && p.platform !== "kuwo") {
    throw fail("unavailable", "invalid track id");
  }
  const songId = p.id;
  const referer =
    p.platform === "kuwo" ? "https://www.kuwo.cn/" : "https://music.163.com/";
  // time/sign 会过期，且偶发一次无效（冷启动/瞬时）。每次重试都重新取 song 拿新 token。
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 300 * attempt));
    try {
      const d = await api("song", { platform: p.platform, id: songId });
      const item = ((d && d.list) || [])[0];
      if (!item) throw fail("unavailable", "song not found");
      const info = pickMinfo(item.minfo, quality);
      if (!info) throw fail("unavailable", "no source for quality: " + quality);
      const u = await api("getUrl", {
        platform: p.platform,
        songid: songId,
        format: info.format,
        bitrate: info.bitrate,
        time: item.time,
        sign: item.sign,
      });
      if (!u || !u.url) throw fail("unavailable", "no download url");
      return {
        url: u.url,
        type: u.format || info.format || "mp3",
        quality: quality,
        bitRate: Number(info.bitrate) || undefined,
        size: parseSize(info.size),
        headers: { Referer: referer, "User-Agent": UA },
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || fail("unavailable", "stream failed");
}

export async function lyrics({ id }) {
  const p = parseId(id);
  if (p.platform !== "wyy" && p.platform !== "kuwo") return { lrc: "" };
  const songId = p.id;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 300 * attempt));
    try {
      const d = await api("song", { platform: p.platform, id: songId });
      const item = ((d && d.list) || [])[0];
      if (!item) continue;
      const data = await api("getLyric", {
        platform: p.platform,
        songid: songId,
        time: item.time,
        sign: item.sign,
      });
      const lrc =
        typeof data === "string" ? data : (data && (data.lrc || data.lyric || "")) || "";
      if (lrc) return { lrc: lrc };
    } catch (e) {
      // 重试
    }
  }
  return { lrc: "" };
}

// 榜单链接，带封面（向接口取每个歌单的 pic_url）
async function chartLinks() {
  return Promise.all(
    CHARTS.map(async (c) => {
      let title = c.title;
      let imageUrl = "";
      try {
        const d = await api("playlist", { platform: "wyy", id: c.id, page: 1, size: 1 });
        const info = (d && d.info) || {};
        if (info.name) title = info.name;
        if (info.pic_url) imageUrl = info.pic_url;
      } catch (e) {}
      return {
        title: t(title),
        subtitle: t("NetEase Cloud Music"),
        imageUrl: imageUrl,
        page: "playlist:wyy:" + c.id,
      };
    })
  );
}

export async function home() {
  const links = await chartLinks();
  return {
    title: t("Music Download"),
    subtitle: t("Search in the search bar · download FLAC lossless"),
    sections: [
      {
        title: t("How to download"),
        links: [
          {
            title: t("Type a song name in the search bar to search"),
            subtitle: t("Choose the source in Settings"),
            page: "about",
          },
        ],
      },
      { title: t("Charts"), links: links },
    ],
  };
}

export async function browse({ page }) {
  const s = String(page == null ? "" : page);
  if (s === "charts") {
    const links = await chartLinks();
    return {
      title: t("Charts"),
      sections: [{ title: t("NetEase Cloud Music"), links: links }],
    };
  }
  if (s === "about") {
    return {
      title: t("How to download"),
      subtitle: t(
        "Type a song name in the search bar to search. Set the source (wyy / kuwo / all) and an optional download quality under Settings → Plugins. With quality lossless you download FLAC."
      ),
      sections: [],
    };
  }
  if (s.indexOf("playlist:") === 0) {
    const rest = s.slice("playlist:".length);
    const parts = rest.split(":");
    const platform = parts[0];
    const pid = parts[1];
    const pageNum = Math.max(1, Number(parts[2]) || 1);
    const d = await api("playlist", {
      platform: platform,
      id: pid,
      page: pageNum,
      size: PAGE,
    });
    const info = (d && d.info) || {};
    const tracks = ((d && d.list) || []).map((it) => songToTrack(platform, it));
    const total = Number(d && d.total) || 0;
    const section = { title: t("Songs"), tracks: tracks };
    if (pageNum * PAGE < total) {
      section.morePage = "playlist:" + platform + ":" + pid + ":" + (pageNum + 1);
    }
    return {
      title: info.name || t("Playlist"),
      subtitle: info.description || "",
      sections: [section],
    };
  }
  throw fail("unavailable", "no such page");
}
