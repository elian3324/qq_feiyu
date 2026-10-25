# QQ AI 机器人

通过 OneBot v11 接入 QQ 的可配置 AI 机器人。保留当前机器人使用的对话、身份识别、记忆、多媒体和自主行为代码，提供中立角色模板。仓库不包含任何可用密钥、真实账号、聊天数据、私人角色卡或第三方网关程序。

## 功能与边界

| 功能 | 说明 |
| --- | --- |
| QQ 群聊与私聊 | NapCat 等 OneBot v11 网关；正向 WebSocket 收事件、HTTP 调用动作；白名单、提及与引用解析、多人身份区分、断线重连 |
| AI 接入 | OpenAI 兼容 Chat Completions 接口，可配置 DeepSeek 或阿里云百炼；模型与区域以部署者账户实际支持为准 |
| 角色与管理员身份 | `role.md` 可替换；`ownerIds` 按平台 ID 识别管理员，不信任昵称或消息中的自称 |
| 记忆与日记 | 会话上下文、管理员长期记忆、按会话隔离、记忆后台整理、手动与定时日记 |
| 图片与表情 | 图像输入、GIF 采样、本地表情目录、QQ 收藏表情读取/发送/收藏；相关网关扩展需要实际支持 |
| 语音、视频、文件 | 百炼 TTS/ASR、SILK 解码、视频抽帧、常见文本及 PDF/Office 阅读；需要额外工具和对应模型 |
| 主动行为 | 主动私聊、频率限制、免打扰、状态与去重；默认暂停，可自行开启 |
| QQ 空间 | 发布、动态读取、点赞、评论、回复以及自主互动的调用与决策逻辑保留；需要兼容的空间扩展网关，详见 [空间接口](docs/QZONE.md) |
| Android 手机工具 | 可选 MCP + ADB；截图、操作与录屏等功能默认关闭 |

**空间扩展不是标准 OneBot v11 能力。** 自有空间逻辑完整保留，支持空间网关或用户另行取得授权的本地协议适配器。仅配置普通 NapCat 不保证拥有完整空间互动能力。受限第三方实现不能随仓库分发，详见 [高级集成](docs/ADVANCED_INTEGRATION.md)。

原 DSH 桥接、控制台、插件、预设、原生适配和诊断/测试源码已经恢复。DSH 是另一条运行路径，见 [桥接部署](docs/DSH_BRIDGE.md)。所有原文件的恢复或替代去向见 [逐项对照](docs/FILE_PARITY.md)。

## Windows 快捷部署

快捷脚本随仓库提供，下载后就存在；不会等启动后再生成。

依次使用 `安装依赖.cmd` → `Configure.cmd` / `配置百炼和QQ.cmd` → 编辑自己的 `.env` 网关凭据 → 启动自己的 NapCat → `Start.cmd` / `一键启动.cmd`。

`初始化配置.cmd` 只在本地创建缺少的 `.env`、账号配置、人设、通用表情库和本机 MCP 配置，保留已有配置。停止、重启、日记、自主行为、手机、日志、表情生成、关屏防睡眠和守护模式入口均已提供。完整清单见 [脚本说明](docs/SCRIPTS.md)。

## 环境

- Node.js 22.13 或更高版本及 npm；推荐使用仍受维护的 LTS，具体版本自行确认。
- 独立安装、登录并运行的 NapCat / OneBot v11 网关。
- 自己的 AI API 凭据，已开通需要的模型与区域。
- 多媒体建议在 PATH 中安装 FFmpeg，或配置 `FFMPEG_PATH`。仓库不包含 FFmpeg。
- 静态审计需要 Python 3.10+、Git 和 Node；文件阅读功能另需 Python 3.10+ 及可选依赖。
- 手机功能需要自己安装 Android Platform Tools / ADB 并授权自己的设备。

Windows 的 `Start.cmd` 会把工作目录设为仓库根目录；其他系统请从根目录运行命令。

## 安装与配置

以下命令供部署者自行执行，会下载依赖或启动服务。本次开源整理没有执行这些命令。

1. 获取本仓库后，在根目录安装 JavaScript 依赖。保留锁文件，并禁用安装脚本：

   ```powershell
   npm --prefix ai-companion-kit ci --ignore-scripts
   npm --prefix local/media-runtime ci --ignore-scripts
   npm --prefix qq-bridge ci --ignore-scripts
   ```

2. 复制模板（PowerShell）：

   ```powershell
   Copy-Item .env.example .env
   Copy-Item ai-companion-kit/packages/companion/config.example.json ai-companion-kit/packages/companion/config.json
   Copy-Item ai-companion-kit/packages/companion/role.example.md ai-companion-kit/packages/companion/role.md
   ```

   macOS/Linux 可用相同路径执行 `cp`。`.env`、`config.json` 和 `role.md` 默认被 Git 忽略。

3. 修改 `config.json` 中的账号和允许的会话。模板全部留空，启动入口会拒绝不完整的配置。下面的账号仅为虚拟示例，必须全部替换：

   ```json
   {
     "botQQ": "1000000001",
     "ownerIds": ["1000000002"],
     "allow": {
       "private": ["1000000002"],
       "groups": ["1000000003"]
     }
   }
   ```

   这是需要修改的字段片段，不要用它覆盖整个配置。`ownerIds` 不会绕过群白名单。

4. 在 `.env` 中填写自己的 `AI_API_KEY` 和 `ONEBOT_ACCESS_TOKEN`。需要在本地配置的其他字段见 [配置手册](docs/CONFIGURATION.md)。不要把密钥填入 `.env.example` 或任何 `*.example.*`。

5. 调整 `role.md`。默认是友好、克制的“小助手”，没有私人关系设定；名称同步修改 `names` 和 `keywords`。

## NapCat 配置

自行按照所使用 NapCat 发行版的说明安装并登录机器人账号；本仓库不自动安装、启动或结束 QQ / NapCat。

在 NapCat 的 OneBot v11 网络配置中：

1. 启用 **HTTP 服务端**，示例监听 `127.0.0.1:3000`。
2. 启用 **正向 WebSocket 服务端**，示例监听 `127.0.0.1:3001`。机器人是 WebSocket 客户端，不需要反向 WebSocket 回调。
3. 两个接口配置相同的随机访问 Token，填入 `.env` 的 `ONEBOT_ACCESS_TOKEN`。
4. `ONEBOT_HTTP_URL` 与 `ONEBOT_WS_URL` 对应自己的实际监听地址；在 NapCat 中开启消息事件上报。
5. 如网关运行在另一台机器，配置其可达地址，并按自己的网关部署方式处理传输保护、文件访问和监听权限。跨机器时网关返回的本地文件路径未必能被机器人读取，可优先使用网关提供的下载接口。

不要导入他人的登录状态或 Token。首次自行部署时使用自己的账号和端口；不要让两个机器人实例同时处理同一网关的相同会话。

## AI API 配置

`.env.example` 默认展示百炼兼容接口与图像模型名称示例。需要自行确认账户所支持的模型、区域、费用和输入类型；本次整理没有请求 API 验证。

百炼示例：

```dotenv
AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
AI_MODEL=qwen3-vl-plus
AI_API_KEY=
```

DeepSeek 文本对话示例：

```dotenv
AI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-chat
AI_API_KEY=
```

使用文本模型时，将本地配置中的 `vision.enabled`、`video.enabled` 设为 `false`，不要向不支持图像输入的模型发送图片。当前主链路把图片直接交给当前聊天模型，单独填写 `vision.model` 不会自动切换聊天模型。语音可使用单独的百炼 Key，见配置手册。

## 启动与使用

确认网关、配置和依赖就绪后，从仓库根目录执行：

```powershell
npm start
```

Windows 也可双击 `Start.cmd`。在运行窗口按 `Ctrl+C` 停止本机器人进程，或使用 `Stop.cmd` / `Restart.cmd`。启停脚本核验本目录的进程身份，不按通用进程名停止其他机器人。网关使用自己配置的独立启动器；内置 OneBot 客户端保留断线重连，也可使用 `守护模式启动.cmd`。

- 白名单内私聊可直接交流；群聊默认需要 @ 机器人，管理员群聊免 @ 由 `wake.ownerAlwaysWake` 控制，仍受目标识别与白名单约束。
- 启用多模态模型和 FFmpeg 后，可以发送图片、GIF。没有附带私人表情素材；本地表情配置见 [配置手册](docs/CONFIGURATION.md)。
- 启用 `voice.enabled` 并填写语音凭据后，管理员私聊可明确要求“用语音回复”。语音生成与真实发送取决于 API 和网关支持。
- 日记、主动私聊、空间互动、手机操作默认关闭。按文档逐项开启，不需要的功能可一直关闭。
- 运行后产生的记忆、附件、日志和日记属于部署者本地私人数据，均默认忽略。

`--dry-run` 会运行业务代码，并可能读取网关和调用模型，不能作为离线安全检查。

## 静态检查与发布

在尚未放入本地私人配置、安装包和运行数据的发布目录中执行：

```powershell
python -B scripts/static_audit.py
```

检查器仅解析文件、检查 Node/PowerShell/内联浏览器脚本语法与 Git 忽略规则，不加载业务模块、不安装依赖、不联网。已经初始化 Git 的源码工作区可加 `--allow-local-git`，此选项仅跳过当前工作区的 Git 元数据，不代表已经检查历史。已配置运行的私人副本会因出现 `.env`、`data/` 等文件而失败；发布请使用干净导出目录。

发布前阅读 [文件差异与恢复清单](docs/FILE_PARITY.md)、[静态审计报告](docs/RELEASE_AUDIT.md)、[安全说明](SECURITY.md) 和 [第三方许可说明](docs/THIRD_PARTY_NOTICES.md)。没有复制原项目 `.git` 或历史提交；用户自行建立的开源仓库 Git 元数据保留。本次整理没有提交、上传或执行 Git Push。

## 许可证

本项目自有集成代码采用 [MIT](LICENSE)。继承的 AI Companion Kit 和 qq-bridge 辅助源码保留各自的原始版权和 LICENSE。第三方服务、安装后获取的依赖和可选 Python 组件不因本项目 MIT 声明而改变许可证。PDF 可选依赖 PyMuPDF 具有 AGPL / 商业双重许可，使用前请阅读 [许可说明](docs/THIRD_PARTY_NOTICES.md)。
