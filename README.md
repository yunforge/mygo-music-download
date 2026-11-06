# 音乐下载 · MyGo Music 插件

一个 [MyGo Music](https://github.com/egoist/mygo-music) 插件，接入
[flac.music.hi.cn](https://flac.music.hi.cn/) 提供的**多站合一**音乐搜索
（网易云音乐 `wyy` / 酷我音乐 `kuwo`），并额外接入 **B站（bilibili）**，
支持在线播放与**无损 FLAC 下载**。

> 插件内部 id 仍为 `flac-music`（安装标识，保持不变）；显示名称为「音乐下载 / Music Download」。

## 功能

- 🔍 **多站合一搜索**：可只搜网易云、只搜酷我，或两站合并（默认 `all`），支持分页加载。
- 📺 **B站来源**：可把来源切换为 `bili`，通过 B 站官方接口搜索视频并下载其**真实音轨**
  （最高 192k，部分内容为 Hi-Res；文件为 `.m4a` 容器）。
- 🎵 **无损试听 / 下载**：根据质量自动选择音源 —— `无损(Lossless)` → FLAC，
  `高(High)` → MP3 320，`标准(Standard)` → MP3 128。
  MyGo 的「下载」会以音源类型作为扩展名，所以在设置里选「无损」即可下载到真正的 `.flac` 文件。
- 🎚️ **插件内音质设置**：可在「设置 → 插件 → 音乐下载」里单独指定下载音质
  （`lossless / high / standard`），留空则跟随 App 的全局音质。
- 📄 **歌词**：联网拉取 LRC 歌词并显示。
- 💿 **专辑 / 榜单**：支持打开专辑详情；「热门榜单」页按平台分栏——
  **网易云** 内置热歌榜 / 新歌榜 / 飙升榜 / 原创榜，**B站** 提供音乐区排行榜，榜单项均带真实封面。
  （酷我官方榜单接口需反爬令牌、公开接口取不到榜单数据，故暂不提供酷我榜单。）
- 🌐 **双语界面**：内置简体中文翻译（`locales/zh-CN.json`）。

## 安装

任选其一：

1. **从 GitHub 安装（推荐）**：在 MyGo Music 中打开设置 → 插件 → “从仓库安装”，
   或直接在浏览器打开：

   ```
   mygo-music://install-plugin?repo=yunforge/mygo-music-download
   ```

2. **本地文件夹 / ZIP**：把整个项目打包成 zip，或用文件夹形式，在
   「设置 → 插件 → 安装插件」中选择。

> 插件无需构建，`plugin.json` 与 `index.js` 即可直接运行。

## 使用

1. 打开「设置 → 插件 → 音乐下载」，可设置：
   - **搜索来源**：`all`（网易云+酷我，默认）/ `wyy`（网易云）/ `kuwo`（酷我）/ `bili`（B站）。
   - **下载音质**：`lossless`（无损 FLAC）/ `high`（MP3 320）/ `standard`（MP3 128），留空跟随 App。
2. 在主界面顶部搜索框输入歌名 / 歌手，结果来自所选来源。
3. **在线播放**：直接点歌即可。
4. **下载无损**：把音质设为「无损」，然后在歌曲上选择「下载」，即可保存 `.flac` 文件。

## 关于新增来源 / 下载配套（重要说明）

以下几点受 MyGo 插件 API 与 flac 后端的**硬性限制**，插件层无法完全实现，说明如下：

- **汽水音乐 / QQ 音乐 / YouTube Music / Spotify**：本站（flac.music.hi.cn）后端只聚合
  **网易云** 与 **酷我** 两个来源，其它平台代码传给接口都会返回「不支持的平台」。
  经实测，公开接口（GD 音乐台、vkeys、Meting 系列等）也基本只能拿到**网易云**的音频直链，
  QQ / 汽水 / YouTube / Spotify 要么无公开音频，要么 DRM / 加密鉴权 / 需解密签名（通常得靠 yt-dlp）。
  故本插件未接入这四个来源。
- **B站（bilibili）**：B 站有公开官方接口，可用 `x/web-interface/search/type` 搜索、用
  `x/player/playurl` 取到真实 DASH 音轨直链，故已接入（`bili` 来源）。音频取自视频音轨，
  匿名最高 192k，热门 Hi-Res（30251）音轨需登录 VIP。
- **指定默认下载目录 / 歌词与封面一并下载**：MyGo 插件**没有任何文件写入 API**；App 的下载是
  调用系统「另存为」对话框保存**单个音频文件**（文件名「歌手 - 标题.扩展名」），且没有“下载目录”设置。
  所以插件无法改变保存路径，也无法把歌词 / 封面作为附加文件一起保存。这些需要修改 MyGo 本体才能实现。
- **插件主页中间的搜索框**：插件的 `browse()` 页面只支持「曲目 / 专辑 / 链接 / 文字区块」等展示型组件，
  **没有文本输入框**组件。不过 MyGo 在主界面顶部有一个常驻搜索框，会直接调用本插件的 `search()`，
  使用方法即：进入「音乐下载」后在顶部搜索框输入歌名。

## 工作原理

- 后端接口：`https://flac.music.hi.cn/ajax.php?act=<action>`（`POST`，`application/x-www-form-urlencoded`）。
  `act` 取值：`search` / `song` / `album` / `playlist` / `getUrl` / `getLyric`。
- 搜索结果的歌曲带 `time` 与 `sign` 两个防篡改令牌；`getUrl` / `getLyric` 需要它们，且会过期。
  因此播放/取词前，插件会先用 `act=song` 取一次**最新**的 `time`/`sign`/`minfo`，再请求直链；
  直链偶发一次无效时会自动重试（重新取令牌）。
- 直链音频（网易云 / 酷我 CDN）**必须带 `Referer`**：网易云 `https://music.163.com/`，
  酷我 `https://www.kuwo.cn/`。插件在 `stream()` 返回的 `headers` 中带上 `Referer` 与 `User-Agent`。
- **B站**：搜索前先请求 `x/frontend/finger/spi` 取 `buvid3`/`buvid4` 写入 Cookie 以规避风控，
  再用 `x/web-interface/search/type` 搜索；取音频时用 `x/player/pagelist` 得 `cid`，
  再 `x/player/playurl?fnval=16&fourk=1` 取 `dash.audio[]`，按音质挑最高可用音轨（`.m4a`），
  下载同样需要 `Referer: https://www.bilibili.com/`（插件已在 `headers` 内附带）。

## 目录结构

```
.
├── plugin.json          # 插件清单（id / 权限 / 设置 / 导航）
├── index.js             # 插件主文件（browse/search/album/stream/lyrics）
├── locales/zh-CN.json   # 简体中文翻译
├── test/harness.mjs     # 开发用端到端测试（不属于运行时）
├── README.md
└── LICENSE
```

## 本地测试

需要 Node 18+（自带 `fetch`）：

```bash
node test/harness.mjs
```

会用 stub 的 `host` 载入 `index.js`，并请求真实接口，校验搜索、分页、无损直链（含 `Referer`）、
音质设置覆盖、歌词、专辑、榜单封面、B站搜索与音轨下载等是否正常。

## 发布

1. 新建一个**公开** GitHub 仓库，把本目录内容放到仓库根目录（`plugin.json` 在顶层）。
2. 在仓库 About 中添加话题 `mygo-music-plugin`，即可出现在 MyGo 的插件列表页。
3. 打一个 Release 并上传 zip（可选，命名如 `plugin-darwin-arm64.zip` 或直接 `plugin.zip`），
   或直接使用默认分支最新提交。新的 tag / commit 即视为新版本。
4. 安装链接：`mygo-music://install-plugin?repo=yunforge/mygo-music-download`。

## 免责声明

本插件仅调用第三方公开接口，用于个人学习与试听。音乐版权归原版权方所有，请勿用于商业用途，
下载内容请在 24 小时内删除。接口可用性与稳定性由第三方站点决定，与本插件作者无关。
