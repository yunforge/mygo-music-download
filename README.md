# FLAC 无损音乐 · MyGo Music 插件

一个 [MyGo Music](https://github.com/egoist/mygo-music) 插件，接入
[flac.music.hi.cn](https://flac.music.hi.cn/) 提供的**多站合一**音乐搜索
（网易云音乐 `wyy` / 酷我音乐 `kuwo`），支持在线播放与**无损 FLAC 下载**。

## 功能

- 🔍 **多站合一搜索**：可只搜网易云、只搜酷我，或两站合并（默认 `all`），支持分页加载。
- 🎵 **无损试听 / 下载**：根据播放质量自动选择音源 —— `无损(Lossless)` → FLAC，
  `高(High)` → MP3 320，`标准(Standard)` → MP3 128。
  MyGo 的「下载」会以音源类型作为扩展名，所以在设置里选「无损」即可下载到真正的 `.flac` 文件。
- 📄 **歌词**：联网拉取 LRC 歌词并显示。
- 💿 **专辑 / 榜单**：支持打开专辑详情；首页与「榜单」页内置网易云热歌榜 / 新歌榜 / 飙升榜 / 原创榜。
- 🌐 **双语界面**：内置简体中文翻译（`locales/zh-CN.json`）。

## 安装

任选其一：

1. **从 GitHub 安装（推荐）**：在 MyGo Music 中打开设置 → 插件 → “从仓库安装”，
   或直接在浏览器打开：

   ```
   mygo-music://install-plugin?repo=<你的用户名>/mygo-music-flac
   ```

2. **本地文件夹 / ZIP**：把整个项目打包成 zip，或用文件夹形式，在
   「设置 → 插件 → 安装插件」中选择。

> 插件无需构建，`plugin.json` 与 `index.js` 即可直接运行。

## 使用

1. 打开「设置 → 插件 → FLAC 无损音乐」，可设置：
   - **搜索来源**：`wyy`（网易云）/ `kuwo`（酷我）/ `all`（合并，默认）。
2. 在主界面顶部搜索框输入歌名 / 歌手，结果来自所选来源。
3. **在线播放**：直接点歌即可（默认「高」音质为 320kbps MP3）。
4. **下载无损**：先在应用设置里把「播放质量」设为 **无损 (Lossless)**，
   然后在歌曲上选择「下载」，即可保存 `.flac` 文件。

## 工作原理

- 后端接口：`https://flac.music.hi.cn/ajax.php?act=<action>`（`POST`，`application/x-www-form-urlencoded`）。
  `act` 取值：`search` / `song` / `album` / `playlist` / `getUrl` / `getLyric`。
- 搜索结果的歌曲带 `time` 与 `sign` 两个防篡改令牌；`getUrl` / `getLyric` 需要它们，且会过期。
  因此播放/取词前，插件会先用 `act=song` 取一次**最新**的 `time`/`sign`/`minfo`，再请求直链。
- 直链音频（网易云 / 酷我 CDN）**必须带 `Referer`**：网易云 `https://music.163.com/`，
  酷我 `https://www.kuwo.cn/`。插件在 `stream()` 返回的 `headers` 中带上 `Referer` 与 `User-Agent`。

## 目录结构

```
.
├── plugin.json          # 插件清单（id / 权限 / 设置 / 导航）
├── index.js             # 插件主文件（home/browse/search/album/stream/lyrics）
├── locales/zh-CN.json   # 简体中文翻译
├── test/harness.mjs     # 开发用端到端测试（不属于运行时）
└── README.md
```

## 本地测试

需要 Node 18+（自带 `fetch`）：

```bash
node test/harness.mjs
```

会用 stub 的 `host` 载入 `index.js`，并请求真实接口，校验搜索、分页、无损直链（含 `Referer`）、
歌词、专辑、榜单等是否正常。

## 发布

1. 新建一个**公开** GitHub 仓库，把本目录内容放到仓库根目录（`plugin.json` 在顶层）。
2. 在仓库 About 中添加话题 `mygo-music-plugin`，即可出现在 MyGo 的插件列表页。
3. 打一个 Release 并上传 zip（可选，命名如 `plugin-darwin-arm64.zip` 或直接 `plugin.zip`），
   或直接使用默认分支最新提交。新的 tag / commit 即视为新版本。
4. 安装链接：`mygo-music://install-plugin?repo=<owner>/<repo>`。

## 免责声明

本插件仅调用第三方公开接口，用于个人学习与试听。音乐版权归原版权方所有，请勿用于商业用途，
下载内容请在 24 小时内删除。接口可用性与稳定性由第三方站点决定，与本插件作者无关。
