// MyGo Music 插件 — 音乐下载 / Music Download
// 数据来源：https://flac.music.hi.cn/ （网易云 wyy / 酷我 kuwo）
// 导出能力：browse, search, album, stream, lyrics，以及「我的歌单」增删改查
//
// 架构说明：
//   search —— 按设置里的 platform（all / wyy / kuwo）检索歌曲，支持分页（offset）。
//   stream —— 播放 / 下载共用。按 quality 选择音源：
//             lossless → flac；high → mp3 320；standard → mp3 128。
//             可在插件设置里用 quality 覆盖 App 全局音质；留空则跟随 App。
//             返回的 type 决定下载文件扩展名，因此“无损”质量会下载到 .flac 文件。
//   lyrics —— 拉取 LRC 歌词。
//   album  —— 专辑详情 + 曲目。
//   browse —— 榜单页（网易云歌单链接带封面）+「我的歌单」。
//
// 反爬要点：getUrl / getLyric 需要 time + sign，且会过期；每次调用前先用
// act=song 取一次最新的 time/sign/minfo。直链音频需要带 Referer 才能下载。

const API_BASE = "https://flac.music.hi.cn/ajax.php?act=";
const PAGE = 20;
const REQUEST_TIMEOUT = 8000; // 单次外部请求超时（毫秒）
const STREAM_DEADLINE = 25000; // stream 整体预算，须小于宿主 30s 调用超时
const LYRICS_DEADLINE = 18000; // lyrics 整体预算
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

// timeoutMs：本次请求的独立超时；缺省用 REQUEST_TIMEOUT，且不会超过它。
async function api(act, params, timeoutMs) {
  const to =
    typeof timeoutMs === "number"
      ? Math.max(1000, Math.min(timeoutMs, REQUEST_TIMEOUT))
      : REQUEST_TIMEOUT;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), to);
  let res;
  try {
    res = await fetch(API_BASE + act, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Accept: "application/json",
      },
      body: enc(params || {}),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw fail("unavailable", act + ": " + ((e && e.message) || e));
  } finally {
    clearTimeout(timer);
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

// 限制并发地 map：最多 limit 个 fn 同时在飞，保持结果顺序；单项失败记为 null。
async function mapLimit(items, limit, fn) {
  const res = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        res[i] = await fn(items[i], i);
      } catch (e) {
        res[i] = null;
      }
    }
  };
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return res;
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

// 搜索结果短缓存：避免 all 模式为拿 total 而重复拉 page1。
const searchCache = new Map(); // key -> { list, total, exp }
const SEARCH_CACHE_TTL = 5 * 60 * 1000;

function cacheGet(platform, keyword, page) {
  if (page !== 1) return null;
  const c = searchCache.get(platform + "|" + keyword);
  return c && c.exp > Date.now() ? c : null;
}
function cacheSetPage1(platform, keyword, list, total) {
  // 不做空结果负缓存：冷启动/瞬时失败返回的空列表不应被记住，否则会抵消重试。
  if (!Array.isArray(list) || list.length === 0) return;
  if (searchCache.size > 100) searchCache.clear();
  searchCache.set(platform + "|" + keyword, {
    list: list,
    total: total,
    exp: Date.now() + SEARCH_CACHE_TTL,
  });
}

// 按绝对下标 [start, start+count) 拉取某平台搜索结果
async function fetchRange(platform, keyword, start, count) {
  const out = [];
  let total = 0;
  if (count <= 0) return { items: out, total };
  const firstPage = Math.floor(start / PAGE) + 1;
  const lastPage = Math.floor((start + count - 1) / PAGE) + 1;
  for (let p = firstPage; p <= lastPage; p++) {
    let list;
    let pageTotal = 0;
    const cached = cacheGet(platform, keyword, p);
    if (cached) {
      list = cached.list;
      pageTotal = cached.total;
    } else {
      let d;
      try {
        d = await api("search", { platform: platform, keyword: keyword, page: p, size: PAGE });
      } catch (e) {
        break; // 某站失败不影响另一站
      }
      list = (d && d.list) || [];
      pageTotal = Number(d && d.total) || 0;
      if (p === 1) cacheSetPage1(platform, keyword, list, pageTotal);
    }
    if (pageTotal) total = pageTotal;
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
  const cached = cacheGet(platform, keyword, 1);
  if (cached) return cached.total || cached.list.length;
  try {
    const d = await api("search", { platform: platform, keyword: keyword, page: 1, size: PAGE });
    const list = (d && d.list) || [];
    const total = Number(d && d.total) || 0;
    cacheSetPage1(platform, keyword, list, total); // 空列表不会被缓存
    if (list.length === 0) return 0; // 处理“total>0 但列表为空”的站点怪癖
    return total || list.length;
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
  const mp3_128 = mp3.find((m) => String(m.bitrate) === "128") || mp3[mp3.length - 1];
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

// 反复取最新的 act=song（time/sign 会过期、偶发一次无效），再执行 fn(item, remain)。
// remain() 返回“距总 deadline 的剩余毫秒”，供后续请求作为超时，保证整体不超宿主调用上限。
async function withFreshSong(platform, songId, attempts, deadlineMs, fn) {
  let lastErr;
  const deadline = Date.now() + deadlineMs;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      const wait = 300 * attempt;
      if (Date.now() + wait >= deadline) break;
      await new Promise((r) => setTimeout(r, wait));
    }
    const rem = deadline - Date.now();
    if (rem < 1500) break;
    try {
      const d = await api("song", { platform: platform, id: songId }, rem);
      const item = ((d && d.list) || [])[0];
      if (!item) throw fail("unavailable", "song not found");
      return await fn(item, () => Math.max(1000, deadline - Date.now()));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || fail("unavailable", "request failed");
}

export async function stream({ id, quality }) {
  // 插件设置里的音质优先，其次用 App 传入的，最后默认 high
  quality = settingQuality() || quality || "high";
  const p = parseId(id);
  if (p.platform !== "wyy" && p.platform !== "kuwo") {
    throw fail("unavailable", "invalid track id");
  }
  const songId = p.id;
  const referer = p.platform === "kuwo" ? "https://www.kuwo.cn/" : "https://music.163.com/";
  // 总耗时限制在 STREAM_DEADLINE 内，避免超过宿主 30s 调用超时。
  return withFreshSong(p.platform, songId, 4, STREAM_DEADLINE, async (item, remain) => {
    const info = pickMinfo(item.minfo, quality);
    if (!info) throw fail("unavailable", "no source for quality: " + quality);
    const u = await api(
      "getUrl",
      {
        platform: p.platform,
        songid: songId,
        format: info.format,
        bitrate: info.bitrate,
        time: item.time,
        sign: item.sign,
      },
      remain()
    );
    if (!u || !u.url) throw fail("unavailable", "no download url");
    return {
      url: u.url,
      type: u.format || info.format || "mp3",
      quality: quality,
      bitRate: Number(info.bitrate) || undefined,
      size: parseSize(info.size),
      headers: { Referer: referer, "User-Agent": UA },
    };
  });
}

export async function lyrics({ id }) {
  const p = parseId(id);
  if (p.platform !== "wyy" && p.platform !== "kuwo") return { lrc: "" };
  try {
    return await withFreshSong(p.platform, p.id, 3, LYRICS_DEADLINE, async (item, remain) => {
      const data = await api(
        "getLyric",
        { platform: p.platform, songid: p.id, time: item.time, sign: item.sign },
        remain()
      );
      const lrc = typeof data === "string" ? data : (data && (data.lrc || data.lyric || "")) || "";
      if (!lrc) throw fail("unavailable", "no lyrics"); // 空歌词视为失败，继续重试
      return { lrc: lrc };
    });
  } catch (e) {
    return { lrc: "" };
  }
}

// 网易云榜单链接（带封面，向接口取每个歌单的 pic_url）
async function wyyChartLinks() {
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

// 榜单页分栏：网易云榜单
async function chartSections() {
  return [{ title: t("NetEase Cloud Music"), links: await wyyChartLinks() }];
}

export async function browse({ page }) {
  const s = String(page == null ? "" : page);
  if (s === "charts") {
    const sections = await chartSections();
    // 热门榜单下面就是「我的歌单」
    sections.push({
      title: t("My Playlists"),
      playlists: listPlaylistsMeta(),
    });
    return {
      title: t("Charts"),
      sections: sections,
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

// ===================== 歌单（我的歌单，本地保存于 host.storage） =====================
// 右键歌曲 → 「添加到歌单」由 App 调用 addToPlaylist；歌单数据存在本插件 storage。
const PL_KEY = "playlists";

function loadPlaylists() {
  try {
    const v = host.storage.get(PL_KEY);
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

function savePlaylists(list) {
  try {
    host.storage.set(PL_KEY, list);
  } catch (e) {}
}

function newPlaylistId() {
  return "pl_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function playlistMeta(pl) {
  return {
    id: pl.id,
    name: pl.name,
    imageUrl: pl.imageUrl || "",
    description: pl.description || "",
    owner: pl.owner || "",
    trackCount: Array.isArray(pl.tracks) ? pl.tracks.length : pl.trackCount || 0,
    mine: true,
  };
}

function listPlaylistsMeta() {
  return loadPlaylists().map(playlistMeta);
}

function findPlaylist(list, id) {
  return list.find((pl) => pl.id === id) || null;
}

function refreshPlaylistCover(pl) {
  if (pl.tracks && pl.tracks.length > 0) {
    const t0 = pl.tracks[0];
    if (t0 && t0.album && t0.album.imageUrl) pl.imageUrl = t0.album.imageUrl;
  }
}

// 把 track id 还原成完整 Track（加入歌单时保存元数据，供歌单页展示/播放）
async function resolveTrackById(id) {
  const p = parseId(id);
  if (!p.id || (p.platform !== "wyy" && p.platform !== "kuwo")) return null;
  try {
    const d = await api("song", { platform: p.platform, id: p.id });
    const it = d && d.list && d.list[0];
    if (it) return songToTrack(p.platform, it);
  } catch (e) {}
  return null;
}

export async function playlists() {
  return listPlaylistsMeta();
}

export async function playlist({ id }) {
  const pl = findPlaylist(loadPlaylists(), String(id));
  if (!pl) throw fail("unavailable", "playlist not found");
  return Object.assign(playlistMeta(pl), { tracks: pl.tracks || [] });
}

export async function createPlaylist({ name }) {
  const list = loadPlaylists();
  const nm = String(name == null ? "" : name).trim() || t("New Playlist");
  const pl = {
    id: newPlaylistId(),
    name: nm,
    imageUrl: "",
    description: "",
    owner: "",
    mine: true,
    tracks: [],
  };
  list.unshift(pl);
  savePlaylists(list);
  return Object.assign(playlistMeta(pl), { tracks: [] });
}

export async function renamePlaylist({ id, name }) {
  const list = loadPlaylists();
  const pl = findPlaylist(list, String(id));
  if (!pl) throw fail("unavailable", "playlist not found");
  const nm = String(name == null ? "" : name).trim();
  if (nm) pl.name = nm;
  savePlaylists(list);
}

export async function deletePlaylist({ id }) {
  savePlaylists(loadPlaylists().filter((pl) => pl.id !== String(id)));
}

export async function addToPlaylist({ id, trackIds }) {
  const list = loadPlaylists();
  const pl = findPlaylist(list, String(id));
  if (!pl) throw fail("unavailable", "playlist not found");
  if (!Array.isArray(pl.tracks)) pl.tracks = [];
  const ids = Array.isArray(trackIds) ? trackIds : [];
  const have = new Set(pl.tracks.map((tr) => tr.id));
  const missing = [];
  for (const tid of ids) {
    const key = String(tid);
    if (!have.has(key) && missing.indexOf(key) < 0) missing.push(key);
  }
  // 有界并发解析缺失曲目（每批 5 个），避免一次性几十个请求触发限流
  if (missing.length) {
    const resolved = await mapLimit(missing, 5, (k) => resolveTrackById(k));
    for (let i = 0; i < missing.length; i++) {
      const tr = resolved[i];
      if (tr) {
        pl.tracks.push(tr);
        have.add(missing[i]);
      }
    }
  }
  refreshPlaylistCover(pl);
  savePlaylists(list);
}

export async function removeFromPlaylist({ id, trackIds }) {
  const list = loadPlaylists();
  const pl = findPlaylist(list, String(id));
  if (!pl) throw fail("unavailable", "playlist not found");
  const drop = new Set((Array.isArray(trackIds) ? trackIds : []).map(String));
  pl.tracks = (pl.tracks || []).filter((tr) => !drop.has(tr.id));
  refreshPlaylistCover(pl);
  savePlaylists(list);
}

export async function movePlaylistTrack({ id, from, to }) {
  const list = loadPlaylists();
  const pl = findPlaylist(list, String(id));
  if (!pl) throw fail("unavailable", "playlist not found");
  const tracks = pl.tracks || [];
  const a = Number(from);
  const b = Number(to);
  if (a >= 0 && a < tracks.length && b >= 0 && b < tracks.length) {
    const moved = tracks.splice(a, 1)[0];
    tracks.splice(b, 0, moved);
    pl.tracks = tracks;
    savePlaylists(list);
  }
}
