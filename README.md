# 音乐下载 · MyGo Music 插件

一个 [MyGo Music](https://github.com/egoist/mygo-music) 插件，接入
[flac.music.hi.cn](https://flac.music.hi.cn/) 提供的**多站合一**音乐搜索
（网易云音乐 `wyy` / 酷我音乐 `kuwo`），支持在线播放与**无损 FLAC 下载**。

## 功能

- 🔍 **多站合一搜索**：自动合并网易云 + 酷我，无需选择来源，支持分页加载。

- 🎵 **默认下载无损**：优先 FLAC；若该曲没有无损，自动回退到最高音质 MP3(320)。
  - 默认（留空）→ 无损 FLAC（无 FLAC 时回退 MP3 320）
  - `高(High)` → MP3 320
  - `标准(Standard)` → MP3 128

  MyGo 的「下载」会以音源类型作为扩展名，所以默认即下载到真正的 `.flac`（无 FLAC 时 `.mp3`）。


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

1. 打开「设置 → 插件 → 音乐下载」，可设置 **下载音质**：
   默认无损（优先 FLAC，无则自动 MP3 320）；也可改为 `high`（MP3 320）或 `standard`（MP3 128）。
2. 在主界面顶部搜索框输入歌名 / 歌手，结果来自**网易云 + 酷我合并**。
3. **在线播放**：直接点歌即可。
4. **下载无损**：默认就是无损（无 FLAC 时自动 MP3 320），在歌曲上选择「下载」即可。
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
默认无损与音质设置覆盖、歌词、专辑、榜单封面、歌单等是否正常。


## 免责声明

本插件仅调用第三方公开接口，用于个人学习与试听。音乐版权归原版权方所有，请勿用于商业用途，
下载内容请在 24 小时内删除。接口可用性与稳定性由第三方站点决定，与本插件作者无关。
