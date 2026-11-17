> Unofficial build notice / 非官方声明
>
> This project is an unofficial Android packaging of the open-source
> chat-demo (MIT). It is not affiliated with, endorsed by, or
> connected to DeepSeek. Bring your own DeepSeek API key; your key
> and conversations stay on your device.
>
> 本项目是开源 chat-demo (MIT) 的非官方 Android 打包，与 DeepSeek
> 没有任何隶属或合作关系。请使用你自己的 DeepSeek API Key；
> Key 与聊天记录只保存在本机。
>
> Upstream: https://github.com/deepseek-ai/chat-demo (base: v0.1.1)

# chat-demo

English | [简体中文](README.zh-CN.md)

A static chat demo powered by the DeepSeek API. No application backend is required: the browser connects directly to the configured API service.

You can [try the app online](https://deepseek-ai.github.io/chat-demo/) or download the archive from [Releases](https://github.com/deepseek-ai/deepseek-chat-demo/releases), extract it, and double-click `index.html` to use it locally without installation or a build. Enter your API key in Settings before your first chat.

## Getting started

Install Node.js 22.12+ and pnpm, then run:

```sh
git clone https://github.com/deepseek-ai/chat-demo.git
cd chat-demo
pnpm install
pnpm dev
```

Open http://localhost:8090.

To build the static site:

```sh
pnpm build
```

The output is written to `dist/`. Deploy it to a static web server or open `dist/index.html` directly. Opening the file directly requires browser support for storage on `file://` pages and an API service that permits their cross-origin requests.

## Features

- Multiple conversations with automatic titles, renaming, and deletion; edit prompts, regenerate replies, and switch between message branches.
- Streaming replies, deep thinking, smart search, link reading, and source citations; stop generation or continue eligible replies.
- Upload, paste, or drag and drop attachments; use voice input and read replies aloud. A live audio spectrum appears in the first row of the input area while recording on mobile.
- Markdown, syntax highlighting, KaTeX math, and Mermaid diagrams.
- Simplified Chinese and English, light and dark themes, mobile layouts, location settings, and chat history import and export.

## Data and storage

Your API key and settings are stored in the browser's localStorage. Conversations and original attachments are stored in IndexedDB. Local data is isolated by browser profile and site origin. Sending messages, uploading attachments, and using speech features sends the relevant content to the configured API service.

History import and export in Settings use ZIP archives. After confirmation and successful validation, importing replaces all local conversations and attachments. Exports include conversations and locally available original images, but exclude API keys, settings, and original non-image attachments. See the [history import/export documentation (Chinese)](src/services/chat/history/README.md) for the archive format and preservation details.

Settings → Data → Delete all chats clears all local conversations, original attachments, and unsent drafts after confirmation. It stops ongoing replies and returns to a new chat. Your API key and settings are preserved; files already uploaded to the API service are not deleted.

## Development

| Command       | Description                  |
| ------------- | ---------------------------- |
| `pnpm dev`    | Start the development server |
| `pnpm build`  | Build into `dist/`           |
| `pnpm type`   | Run TypeScript type checks   |
| `pnpm lint`   | Lint with oxlint             |
| `pnpm format` | Format with oxfmt            |

[rspack.config.ts](rspack.config.ts) uses `https://api.deepseek.com` by default. Use `createConfig({ apiOrigin, devServer })` to customize the API origin and development server proxy.

Chat uses `deepseek-flash` by default through Anthropic-compatible Messages / Files APIs. Speech features use ASR / TTS endpoints. Requests include extensions for search, link reading, titles, and `latest_reminder`, so the configured service must support the corresponding capabilities. Supported attachment formats are determined by server-side validation.

```text
src/
  app/                 Application layout, themes, and global styles
  components/          Chat, settings, Markdown, and other UI components
  i18n/                English and Chinese translations
  services/
    api/               API requests, SSE, and protocol types
    chat/              Conversations, message branches, storage, and history import/export
    markdown/          Markdown parsing, syntax highlighting, and diagrams
    speech/            Audio recording and read-aloud playback
  utils/               Shared utilities
```

## License

[MIT](LICENSE). The build copies the license to `dist/LICENSE`; include it when distributing the app. Third-party dependencies are subject to their own licenses.

## Android build (Capacitor)

- Web: `pnpm install`, then build the static site into `dist/`.
  NOTE (Windows): the upstream `build` script uses Unix-only `rm` and
  a `NODE_ENV=` prefix, so `pnpm build` fails on Windows as shipped.
  Verified equivalent on Windows: set `NODE_ENV=production` and run
  `pnpm exec rspack build -c rspack.config.ts` (rspack `clean: true`
  replaces the `rm -rf dist` step). No upstream source was changed.
- Sync web assets into the shell: `pnpm exec cap sync android`
- Debug APK: open `android/` in Android Studio, or run
  `gradlew assembleDebug` with JAVA_HOME set to a full JDK 21.
  NOTE: Gradle 8.14.3 (Capacitor 8.6.2) cannot run on JBR 25 bundled
  with Android Studio ("Unsupported class file major version 69"), and
  the trimmed PyCharm JBR 21 fails too (no jlink). Install Temurin 21
  in a durable location (or move the portable copy out of %TEMP%) and
  point JAVA_HOME and the Studio Gradle JDK setting at it. Output:
  `android/app/build/outputs/apk/debug/app-debug.apk`.
- Working applicationId: `com.tsing.deepseekforchat` (changeable
  before the first release; never a `com.deepseek.*` id). No release
  signing is configured in this repo.

## 致谢

- 上游项目：deepseek-ai/chat-demo（MIT，https://github.com/deepseek-ai/chat-demo）—— 本仓库基于 v0.1.1（commit 5d5dd75），聊天界面与聊天逻辑均来自该项目
- API 服务：DeepSeek API（deepseek-flash）—— 对话、搜索、链接阅读与语音能力均由 DeepSeek API 提供
- 打包框架：Capacitor —— 将网页版打包为 Android 应用

## 反馈与联系

- 问题反馈与建议：2012990260@qq.com
- QQ 交流群：1107601781
