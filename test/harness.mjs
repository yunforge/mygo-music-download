// 开发用测试脚本（不属于插件运行时代码）。
// 用法：node test/harness.mjs
// 它用 stub 的全局 host 载入 index.js，并调用真实的 flac.music.hi.cn 接口，
// 验证 search / stream / lyrics / album / home / browse 端到端可用。
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
  storage: { get() {}, set() {}, remove() {} },
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
const s1 = await mod.search({ query: "周杰伦", kind: "tracks", offset: 0 });
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
const st = await mod.stream({ id: pick.id, quality: "lossless" });
console.log("  type:", st.type, "bitRate:", st.bitRate, "size:", st.size);
console.log("  url:", st.url.slice(0, 70) + "...");
console.log("  headers:", JSON.stringify(st.headers));
check(st.type === "flac", "lossless 返回 flac");
check(typeof st.url === "string" && st.url.startsWith("http"), "url 是 http(s) 直链");
check(st.headers && st.headers.Referer, "headers 带 Referer");
check(typeof st.size === "number" && st.size > 0, "size 解析为字节数");
await probeAudio(st, "lossless");

// ---------- 3. stream high / standard ----------
line("stream high");
const sth = await mod.stream({ id: pick.id, quality: "high" });
console.log("  type:", sth.type, "bitRate:", sth.bitRate);
check(sth.type === "mp3", "high 返回 mp3");

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

// ---------- 6. home + browse ----------
line("home()");
const h = mod.home();
console.log("  title:", h.title, "sections:", h.sections.length);
check(h.sections.length > 0 && h.sections[0].links.length > 0, "首页有榜单链接");

line("browse charts");
const bc = await mod.browse({ page: "charts" });
check(bc.sections[0].links.length > 0, "榜单页有链接");

line("browse playlist (热歌榜)");
const bp = await mod.browse({ page: "playlist:wyy:3778678" });
console.log("  title:", bp.title, "tracks:", bp.sections[0].tracks.length, "morePage:", bp.sections[0].morePage);
check(bp.sections[0].tracks.length > 0, "歌单页有曲目");

// ---------- 7. kuwo 单站模式 ----------
line("search kuwo 单站: hello");
SETTINGS = { platform: "kuwo" };
const sk = await mod.search({ query: "hello", kind: "tracks", offset: 0 });
console.log("  tracks:", sk.tracks.length, "first:", sk.tracks[0] && sk.tracks[0].name);
check(sk.tracks.length > 0 && sk.tracks.every((t) => t.id.startsWith("kuwo:")), "kuwo 单站仅返回 kuwo 结果");

line("stream kuwo lossless: " + (sk.tracks[0] && sk.tracks[0].id));
if (sk.tracks[0]) {
  const stk = await mod.stream({ id: sk.tracks[0].id, quality: "lossless" });
  console.log("  type:", stk.type, "bitRate:", stk.bitRate);
  check(stk.type === "flac", "kuwo lossless 返回 flac");
  check(/kuwo\.cn/.test(stk.headers.Referer), "kuwo Referer 正确");
  await probeAudio(stk, "kuwo lossless");
}

// ---------- 8. 空查询 / 其他 kind ----------
line("边界：空查询 & 非 tracks kind");
const e1 = await mod.search({ query: "", kind: "tracks", offset: 0 });
check(e1.tracks.length === 0 && e1.more === false, "空查询返回空");
const e2 = await mod.search({ query: "x", kind: "albums", offset: 0 });
check(Array.isArray(e2.albums) && e2.albums.length === 0, "非 tracks kind 返回空");

console.log("\n========================================");
console.log(failures === 0 ? "全部通过 ✅" : "有 " + failures + " 项失败 ❌");
process.exit(failures === 0 ? 0 : 1);
