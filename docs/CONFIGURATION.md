# 配置手册

所有账号、密钥、设备序列号和个性化角色卡只写入被忽略的本地文件。配置路径相对于配置文件所在目录，另有说明的除外。

## 文件和环境变量

| 文件 | 用途 |
| --- | --- |
| 根目录 `.env` | 从 `.env.example` 复制；根启动命令通过 Node 的 `--env-file` 读取 |
| `ai-companion-kit/packages/companion/config.json` | 从同目录 `config.example.json` 复制；账号、白名单、功能开关 |
| `ai-companion-kit/packages/companion/role.md` | 从同目录 `role.example.md` 复制；本地可替换的人设 |
| `local/features-settings.json` | 可选，从 `features-settings.example.json` 复制；自己的手机序列号 |

如使用自定义配置文件：`node --env-file=.env local/run.mjs --config ./your-config.local.json`。不要公开自定义配置。配置必须为 UTF-8 JSON，不支持注释或尾随逗号。

`AI_BASE_URL`、`AI_MODEL` 和 `AI_API_KEY` 的非空环境变量优先于 JSON。未提供 `AI_API_KEY` 时，依次使用 JSON 的 `apiKey`、与接口域名匹配的 `DASHSCOPE_API_KEY` / `DEEPSEEK_API_KEY`。建议只填写 `AI_API_KEY`，避免混用凭据。已有操作系统环境变量会按 Node `--env-file` 的规则覆盖文件值。

OneBot 的三个非空环境变量覆盖 JSON 的 `onebot.wsUrl/httpUrl/accessToken`。`VOICE_API_KEY`、`ASR_API_KEY`、`VISION_API_KEY` 可覆盖各自功能的 Key；语音功能还可使用 `DASHSCOPE_API_KEY`，最终回退到主 API Key，因此使用不同提供方时务必填写对应语音 Key。

## 主配置

| 字段 | 说明 |
| --- | --- |
| `botQQ` | 自己的机器人 QQ，字符串 |
| `ownerIds` | 管理员/管理员平台 ID 数组；权限按 ID 核验 |
| `allow.private` / `allow.groups` | 明确允许处理的私聊与群。空白模板无法从根启动入口运行 |
| `names` / `keywords` | 可替换的机器人名称和唤醒词 |
| `wake.groupAtOnly` | 默认群聊要求 @；管理员免 @ 可单独配置 |
| `wake.ownerAlwaysWake` | 管理员发言唤醒；不会绕过群白名单或明确对其他人说话的判定 |
| `wake.probability` | 非明确触发的随机参与概率；模板为 0 |
| `humanize` | 分条发送、打字延迟与间隔 |
| `ownerMemory` / `groupIdentityReview` | 管理员长期记忆与群聊身份复核，可能额外调用模型 |
| `dataDir` / `diaryDir` | 相对于配置文件的私人运行数据目录 |
| `toolModule` / `autonomyModule` | 模板中已指向仓库内功能模块；通常无需修改 |

## 图片与表情

`vision.enabled=true` 需要当前聊天模型支持图像输入。GIF 采样、图像缩放和压缩需要 FFmpeg。`vision.downloadRoots` 默认空，仅在确实需要访问自己网关附件目录时添加本地目录，不要写进公开模板。

本地表情：自行新建 `data/stickers/`，将具有使用权限的图片放入其中，并参考 `examples/sticker-library.example.json` 创建 `data/stickers/library.json`。`file` 相对于 library 文件；`audience` 的 `owner/private/group` 表示管理员、普通私聊和群聊。没有表情资源时正常文字对话仍可使用。

`stickers.qqFavorites.enabled` 开启 QQ 收藏读取；`autoCollect`、`backgroundCollect` 控制收藏学习和后台收集，模板均为 false。只有实际网关支持对应动作时才启用。收藏目录、描述、图片和发送状态全部属于私人运行数据，不随仓库分发。

## 语音、视频与文档

- 设置 `voice.enabled=true`，在 `.env` 填写 `VOICE_API_KEY`，并设置本地 `voice.endpoint/model/voice`。模板中的百炼地址和音色只是示例。`FFMPEG_PATH` 指向自己的 FFmpeg 或 PATH 中的命令。
- 设置 `asr.enabled=true`，填写 `ASR_API_KEY`，确认 `asr.baseUrl/model`。SILK 解码依赖由第二条 npm 安装命令提供。
- `video.enabled=true` 后启用抽帧；`frames`、`maxSeconds`、`maxBytes` 限制采样数量与体积。需要模型支持图像，音轨识别还需 ASR。
- `attachments.enabled=true` 后允许文件阅读。纯文本不需要 Python 包；PDF/DOCX/XLSX/PPTX 需要 `local/document-requirements.txt`。先阅读第三方许可说明，再在自己选择的 Python 环境安装依赖。例如部署者可自行执行 `python -m pip install -r local/document-requirements.txt`。
- `attachments.python` 必须指向装好这些依赖的解释器；Windows 虚拟环境可使用 `.venv/Scripts/python.exe`，Linux 可使用 `.venv/bin/python`。根启动命令的工作目录是仓库根目录。

媒体内容可能被发送到自己配置的 AI 提供方；不要在未经参与者同意的会话启用相关能力。

## 日记与自主行为

`diary.enabled=true` 开启日记工具和定时日记；`time/timezone` 控制时间。日记从角色卡与本地记忆生成，默认存入私人数据目录。

主动私聊需要：`autonomy.paused=false`、`autonomy.chat.enabled=true`。默认有每日次数、时段、间隔、未回复克制与免打扰限制。`autonomy.dryRun` 以及 `autonomy.chat.dryRun` 为 true 时保留预演逻辑；准备真实发送前由部署者自行改为 false。默认接收者是 `ownerIds` 第一位，可在本地 `autonomy.chat.ownerId` 显式指定已授权管理员。

管理员私聊“不要打扰”“我要睡了”等会进入安静期；“恢复主动”“取消免打扰”“可以找我聊天”可恢复。不要通过删除状态文件重置频率或去重记录。

空间自主行为另外需要 `qzone.enabled=true`、`autonomy.qzone.enabled=true`，并逐项开启 `publishEnabled/readOwnerEnabled/commentEnabled/replyEnabled/likeEnabled`。必须先自行接入支持相应动作的空间网关，见 [QZONE.md](QZONE.md)。后台会处理私人上下文，仍不得把私人事实发布出去。

## 手机工具

`phone.enabled=true` 才启动手机 MCP。自行安装 ADB、启用设备调试并授权；用 `.env` 的 `PHONE_ADB` 和 `PHONE_SERIAL` 或本地 `features-settings.json` 配置自己的设备。设备序列号不得写入示例文件。手机工具限已验证管理员的授权会话。

截图和录屏产生于 `data/shots/`，宏保存于 `data/macros.json`。仓库不携带设备信息、截图或宏数据。

## 运行与隐私

根启动器只运行本目录机器人。原有配置 GUI、启停、日记、自主行为、手机、电源管理、连接监督及可公开原生适配源码均已恢复，入口见 [SCRIPTS.md](SCRIPTS.md)。第三方程序需用户另行获得授权；网关可使用显式本地启动配置，原生高级工具见 [ADVANCED_INTEGRATION.md](ADVANCED_INTEGRATION.md)。

请求审计会对文字、图片二进制和工具参数脱敏，但日志及记忆仍应统一作为私人文件。不要把运行后的工作目录当作发布目录；重新建立干净发布副本并运行静态审计。
