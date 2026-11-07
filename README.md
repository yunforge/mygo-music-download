# 音乐下载 · MyGo Music 插件

一个 [MyGo Music](https://github.com/egoist/mygo-music) 插件，接入
[flac.music.hi.cn](https://flac.music.hi.cn/) 提供的**多站合一**音乐搜索
（网易云音乐 `wyy` / 酷我音乐 `kuwo`），支持在线播放与**无损 FLAC 下载**。

## 功能

- 🔍 **多站合一搜索**：可只搜网易云、只搜酷我，或两站合并（默认 `all`），支持分页加载。

- 🎵 **无损试听 / 下载**：根据质量自动选择音源
  - `无损(Lossless)` → FLAC
  - `高(High)` → MP3 320
  - `标准(Standard)` → MP3 128

MyGo 的「下载」会以音源类型作为扩展名，所以在设置里选「无损」即可下载到真正的 `.flac` 文件。


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
   - **搜索来源**：`all`（网易云+酷我，默认）/ `wyy`（网易云）/ `kuwo`（酷我）。
   - **下载音质**：`lossless`（无损 FLAC）/ `high`（MP3 320）/ `standard`（MP3 128），留空跟随 App。
2. 在主界面顶部搜索框输入歌名 / 歌手，结果来自所选来源。
3. **在线播放**：直接点歌即可。
4. **下载无损**：把音质设为「无损」，然后在歌曲上选择「下载」，即可保存 `.flac` 文件。
5. **添加到歌单**：在歌曲上**右键（或点右侧「更多」）→ 添加到歌单**，可新建或选择已有歌单；
   歌单位于「热门榜单」页下方，也可从左侧栏「我的歌单」进入。

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
音质设置覆盖、歌词、专辑、榜单封面、歌单等是否正常。


## 免责声明

本插件仅调用第三方公开接口，用于个人学习与试听。音乐版权归原版权方所有，请勿用于商业用途，
下载内容请在 24 小时内删除。接口可用性与稳定性由第三方站点决定，与本插件作者无关。
