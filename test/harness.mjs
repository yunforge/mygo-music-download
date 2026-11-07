// 开发用测试脚本（不属于插件运行时代码）。
// 用法：node test/harness.mjs
// 它用 stub 的全局 host 载入 index.js，并调用真实的 flac.music.hi.cn 接口，
// 验证 search / stream / lyrics / album / browse / 歌单 端到端可用。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

// stub 全局 host（插件里以裸标识符 host 访问，等价于 globalThis.host）
let SETTINGS = {};
globalThis.host = {
  setting(k) {
    return SETTINGS[k];
  },
  t(s) {
    return s;
  },
  storage: (() => {
    const m = new Map();
    return {
      get: (k) => (m.has(k) ? m.get(k) : undefined),
      set: (k, v) => {
        m.set(k, v);
      },
      remove: (k) => {
        m.delete(k);
      },
    };
  })(),
  dir: "/tmp",
  dataDir: "/tmp",
  crypto: { md5: (s) => s },
  openURL: () => {},
};

// 以 data URL 方式导入 ESM 插件
const mod = await import(
  "data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64")
);

const line = (s) => console.log("\n===== " + s + " =====");
let failures = 0;
function check(cond, msg) {
  if (!cond) {
    failures++;
    console.log("  ✗ FAIL:", msg);
  } else {
    console.log("  ✓", msg);
  }
}

// 内建源偶发瞬时空结果/取流失败，包一层重试让测试稳定（不改变断言含义）
async function streamRetry(id, quality, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await mod.stream({ id, quality });
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  throw lastErr;
}

// 允许直接 fetch（node 24 自带），用于验证直链音频（带 Referer）
async function probeAudio(stream, label) {
  try {
    const res = await fetch(stream.url, {
      headers: Object.assign({ Range: "bytes=0-1023" }, stream.headers || {}),
    });
    check(res.status === 206 || res.status === 200, label + " 直链可访问 (HTTP " + res.status + ")");
    const buf = Buffer.from(await res.arrayBuffer());
    check(buf.length > 0, label + " 收到音频字节: " + buf.length + " bytes, type=" + stream.type);
  } catch (e) {
    check(false, label + " 直链访问异常: " + e.message);
  }
}

// ---------- 1. all 模式搜索（默认） ----------
line("search all 模式: 周杰伦 (offset=0)");
SETTINGS = {};
let s1 = await mod.search({ query: "周杰伦", kind: "tracks", offset: 0 });
// 内建源偶发冷启动空结果，重试几次（不改变断言含义）
for (let i = 0; i < 3 && s1.tracks.length === 0; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  s1 = await mod.search({ query: "周杰伦", kind: "tracks", offset: 0 });
}
console.log("  tracks:", s1.tracks.length, "more:", s1.more);
console.log("  前5:", s1.tracks.slice(0, 5).map((t) => t.id + " " + t.name).join(" | "));
check(s1.tracks.length > 0, "返回了歌曲");
check(s1.tracks.every((t) => /^(wyy|kuwo):/.test(t.id)), "所有 track.id 带平台前缀");
check(s1.tracks.every((t) => t.duration >= 0), "duration 为非负毫秒数");

line("search all 模式: 分页 offset=20");
const s2 = await mod.search({ query: "周杰伦", kind: "tracks", offset: 20 });
console.log("  tracks:", s2.tracks.length, "more:", s2.more);
const ids1 = new Set(s1.tracks.map((t) => t.id));
const overlap = s2.tracks.filter((t) => ids1.has(t.id));
check(s2.tracks.length > 0, "第二页有结果");
check(overlap.length === 0, "第二页与第一页无重复 (重复数=" + overlap.length + ")");

// ---------- 2. stream lossless ----------
const pick = s1.tracks.find((t) => t.id.startsWith("wyy:")) || s1.tracks[0];
line("stream lossless: " + pick.id + " " + pick.name);
const st = await streamRetry(pick.id, "lossless");
console.log("  type:", st.type, "bitRate:", st.bitRate, "size:", st.size, "quality:", st.quality);
console.log("  url:", st.url.slice(0, 70) + "...");
console.log("  headers:", JSON.stringify(st.headers));
check(st.type === "flac", "lossless 返回 flac");
check(st.quality === "lossless", "返回 quality 标为 lossless");
check(typeof st.url === "string" && st.url.startsWith("http"), "url 是 http(s) 直链");
check(st.headers && st.headers.Referer, "headers 带 Referer");
check(typeof st.size === "number" && st.size > 0, "size 解析为字节数");
await probeAudio(st, "lossless");

// ---------- 3. 默认无损 & 音质设置覆盖 ----------
line("默认（未设置）：App 传 high 也应下到 flac");
SETTINGS = {};
const stDefault = await streamRetry(pick.id, "high");
console.log("  type:", stDefault.type, "quality:", stDefault.quality);
check(stDefault.type === "flac", "默认无损失效（即使 App 传 high）");

line("设置 quality=high → 强制 MP3 320");
SETTINGS = { quality: "high" };
const sth = await streamRetry(pick.id, "lossless");
console.log("  type:", sth.type, "bitRate:", sth.bitRate, "quality:", sth.quality);
check(sth.type === "mp3", "high 设置返回 mp3");

line("设置 quality=standard → 强制 MP3 128");
SETTINGS = { quality: "standard" };
const sts = await streamRetry(pick.id, "lossless");
console.log("  type:", sts.type, "bitRate:", sts.bitRate, "quality:", sts.quality);
check(sts.type === "mp3", "standard 设置返回 mp3");
SETTINGS = {};

// ---------- 4. lyrics ----------
line("lyrics: " + pick.id);
const ly = await mod.lyrics({ id: pick.id });
console.log("  lrc length:", (ly.lrc || "").length);
console.log("  head:", (ly.lrc || "").slice(0, 80).replace(/\n/g, " / "));
check(typeof ly.lrc === "string" && ly.lrc.length > 0, "拿到歌词文本");

// ---------- 5. album ----------
const withAlbum = s1.tracks.find((t) => t.album && t.album.id);
if (withAlbum) {
  line("album: " + withAlbum.album.id + " (" + withAlbum.album.name + ")");
  const al = await mod.album({ id: withAlbum.album.id });
  console.log("  album:", al.album.name, "tracks:", al.tracks.length);
  check(al.album && al.album.name, "专辑有名称");
  check(al.tracks.length > 0, "专辑有曲目");
  check(al.tracks.every((t) => /^(wyy|kuwo):/.test(t.id)), "专辑曲目 id 带平台前缀");
}

// ---------- 6. browse（热门榜单，单页） ----------
line("home removed");
check(typeof mod.home !== "function", "已移除 home()，只保留热门榜单页");

line("settings：搜索固定 all，音质默认无损");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "plugin.json"), "utf8"));
const settingKeys = (manifest.settings || []).map((s) => s.key);
check(!settingKeys.includes("platform"), "已移除「搜索来源(platform)」设置（固定多站合一 all）");
check(settingKeys.includes("quality"), "保留「quality」设置");

line("browse charts");
const bc = await mod.browse({ page: "charts" });
const wySec = bc.sections.find((sec) => sec.links && sec.links.some((l) => /playlist:wyy:/.test(l.page)));
check(!!wySec && wySec.links.length > 0, "榜单页有网易云链接");
check(!!(wySec && wySec.links.some((l) => l.imageUrl)), "榜单页网易云链接带封面");
check(
  !bc.sections.some((sec) => sec.links && sec.links.some((l) => l.page === "about")),
  "榜单页不再有“使用说明/如何下载”入口"
);
check(!bc.sections.some((sec) => sec.links && sec.links.some((l) => l.page === "bili_chart")), "不再有 B站 榜单入口");

line("browse playlist (热歌榜)");
const bp = await mod.browse({ page: "playlist:wyy:3778678" });
console.log("  title:", bp.title, "tracks:", bp.sections[0].tracks.length, "morePage:", bp.sections[0].morePage);
check(bp.sections[0].tracks.length > 0, "歌单页有曲目");

// ---------- 7. 酷我来源的音源可播放/下载（固定已知 id，验证多站取流） ----------
line("stream kuwo lossless（固定 id: kuwo:6686351 Hello）");
const stk = await streamRetry("kuwo:6686351", "lossless");
console.log("  type:", stk.type, "bitRate:", stk.bitRate, "quality:", stk.quality);
check(stk.type === "flac", "kuwo lossless 返回 flac");
check(/kuwo\.cn/.test(stk.headers.Referer), "kuwo Referer 正确");
await probeAudio(stk, "kuwo lossless");

// ---------- 8. 歌单：创建 / 添加(右键) / 读取 / 改名 / 排序 / 移除 / 删除 ----------
line("playlists: create");
SETTINGS = {}; // all 模式，用真实搜索结果 id
const s0 = await mod.search({ query: "周杰伦", kind: "tracks", offset: 0 });
check(s0.tracks.length >= 2, "搜索结果至少 2 首（后续歌单断言依赖两首不同的歌）");
const trackA = s0.tracks[0];
const trackB = s0.tracks[1];
const created = await mod.createPlaylist({ name: "我的测试歌单" });
console.log("  created:", created.id, created.name, "mine:", created.mine);
check(!!created.id && created.name === "我的测试歌单" && created.mine === true, "创建歌单成功且 mine=true");

line("playlists: addToPlaylist (模拟右键添加到歌单)");
const addRes = await mod.addToPlaylist({ id: created.id, trackIds: [trackA.id, trackB.id] });
console.log("  addToPlaylist 返回:", JSON.stringify(addRes));
check(addRes && addRes.added === 2 && addRes.failed === 0, "addToPlaylist 返回 {added:2, failed:0}");
const plFull = await mod.playlist({ id: created.id });
console.log("  playlist tracks:", plFull.tracks.length, "first:", plFull.tracks[0] && plFull.tracks[0].name);
check(plFull.tracks.length === 2, "歌单里有 2 首");
check(plFull.tracks.every((t) => t.id && t.name && t.album), "歌单曲目带完整元数据（可展示/播放）");
check(!!plFull.imageUrl && /^https?:\/\//.test(plFull.imageUrl), "歌单封面取自首曲封面");

line("playlists: playlists() 列表 & browse charts 底部我的歌单");
const allpl = await mod.playlists();
check(allpl.some((p) => p.id === created.id && p.mine === true), "playlists() 返回该歌单标 mine");
const ch = await mod.browse({ page: "charts" });
const mySec = ch.sections.find((sec) => sec.title === "My Playlists");
check(!!mySec && Array.isArray(mySec.playlists) && mySec.playlists.some((p) => p.id === created.id), "榜单页底部有「我的歌单」分区并含该歌单");

line("playlists: rename / move / remove");
await mod.renamePlaylist({ id: created.id, name: "改名后的歌单" });
let pl2 = await mod.playlist({ id: created.id });
check(pl2.name === "改名后的歌单", "歌单改名生效");
await mod.movePlaylistTrack({ id: created.id, from: 0, to: 1 });
pl2 = await mod.playlist({ id: created.id });
check(pl2.tracks[1] && pl2.tracks[1].id === trackA.id, "movePlaylistTrack 生效（首曲移到末尾）");
await mod.removeFromPlaylist({ id: created.id, trackIds: [trackA.id] });
pl2 = await mod.playlist({ id: created.id });
check(pl2.tracks.length === 1, "removeFromPlaylist 删除一首后剩 1 首");
await mod.removeFromPlaylist({ id: created.id, trackIds: [trackB.id] });
pl2 = await mod.playlist({ id: created.id });
check(pl2.tracks.length === 0 && pl2.imageUrl === "", "清空歌单后封面被清空");

line("playlists: delete");
await mod.deletePlaylist({ id: created.id });
const after = await mod.playlists();
check(!after.some((p) => p.id === created.id), "删除歌单后列表不再包含");
let deleteMissingThrew = false;
try {
  await mod.deletePlaylist({ id: created.id });
} catch (e) {
  deleteMissingThrew = e && e.code === "unavailable";
}
check(deleteMissingThrew, "删除不存在的歌单明确报 unavailable");
let moveInvalidThrew = false;
try {
  await mod.movePlaylistTrack({ id: "pl_nonexistent", from: 0, to: 1 });
} catch (e) {
  moveInvalidThrew = e && e.code === "unavailable";
}
check(moveInvalidThrew, "movePlaylistTrack 对不存在歌单明确报错");

// ---------- 9. 空查询 / 其他 kind / 非法 id ----------
line("边界：空查询 & 非 tracks kind & 非法 id");
const e1 = await mod.search({ query: "", kind: "tracks", offset: 0 });
check(e1.tracks.length === 0 && e1.more === false, "空查询返回空");
const e2 = await mod.search({ query: "x", kind: "albums", offset: 0 });
check(Array.isArray(e2.albums) && e2.albums.length === 0, "非 tracks kind 返回空");
let invalidThrew = false;
try {
  await mod.stream({ id: "bili:BV1xx", quality: "high" });
} catch (e) {
  invalidThrew = e && e.code === "unavailable";
}
check(invalidThrew, "非法/已移除来源的 track id 明确报 unavailable");

// ---------- 10. 单元：flac 取流失败 → 自动回退 mp3 320 ----------
line("unit: 无损音源取流失败 → 自动回退 mp3 320");
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const act = String(url).split("act=")[1];
    if (act === "song") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          data: {
            list: [
              {
                id: "999",
                name: "X",
                artist: "Y",
                album_name: "A",
                album_id: "1",
                pic_url: "",
                duration: 200,
                minfo: [
                  { format: "flac", bitrate: "900", size: "30MB" },
                  { format: "mp3", bitrate: "320", size: "3MB" },
                ],
                time: 1,
                sign: "s",
              },
            ],
          },
        }),
      };
    }
    if (act === "getUrl") {
      const body = String((opts && opts.body) || "");
      if (/format=flac/.test(body)) {
        return { ok: true, status: 200, json: async () => ({ code: -1, msg: "flac unavailable" }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 0, data: { url: "http://cdn.example/x.mp3", format: "mp3", bitrate: "320" } }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ code: 0, data: {} }) };
  };
  try {
    SETTINGS = {};
    const r = await mod.stream({ id: "wyy:999", quality: "lossless" });
    check(
      r.type === "mp3" && String(r.bitRate) === "320",
      "flac 取流失败后回退到 mp3 320 (type=" + r.type + ", bitRate=" + r.bitRate + ")"
    );
  } catch (e) {
    check(false, "回退 mp3 失败: " + e.message);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ---------- 11. 单元：搜索上游首次失败自动重试 ----------
line("unit: 搜索上游偶发失败 → 自动重试");
{
  const realFetch = globalThis.fetch;
  let wyyFailsLeft = 1;
  globalThis.fetch = async (url, opts) => {
    const body = String((opts && opts.body) || "");
    const platform = (/platform=(\w+)/.exec(body) || [])[1] || "";
    const page = (/[?&]?page=(\d+)/.exec(body) || [])[1] || "1";
    if (platform === "wyy" && page === "1" && wyyFailsLeft-- > 0) {
      throw new Error("transient network");
    }
    const item = {
      id: platform === "wyy" ? "1" : "2",
      name: platform,
      artist: "a",
      album_name: "b",
      album_id: "9",
      pic_url: "",
      duration: 100,
      minfo: [],
      time: 1,
      sign: "s",
    };
    return { ok: true, status: 200, json: async () => ({ code: 0, data: { list: [item], total: 1 } }) };
  };
  try {
    SETTINGS = {};
    const r = await mod.search({ query: "unit-retry", kind: "tracks", offset: 0 });
    check(r.tracks.length === 2, "上游首次失败后重试成功，返回两站结果 (n=" + r.tracks.length + ")");
  } catch (e) {
    check(false, "搜索重试失败: " + e.message);
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log("\n========================================");
console.log(failures === 0 ? "全部通过 ✅" : "有 " + failures + " 项失败 ❌");
process.exit(failures === 0 ? 0 : 1);
