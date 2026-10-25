# 原项目与开源副本逐项对照

本表记录恢复去向，不把静态文件齐全等同于全部功能已运行验证。真实名称/账号出现在原文件名时已使用占位标记。

共对比 399 个项目源码、脚本、配置和文档；另外遍历了原目录全部 14716 个文件，并按类别统计其余运行/第三方/私人内容。
原项目 399 个文件哈希复核，变化数 0；没有未交代去向的公开源码/入口（数量 0）。

## 原快捷入口恢复清单

| 原相对位置（必要时匿名） | 开源位置 | 状态 |
| --- | --- | --- |
| Configure.cmd | Configure.cmd | 已恢复 / 通用替代 |
| Gateway.cmd | Gateway.cmd | 已恢复 / 通用替代 |
| Restart.cmd | Restart.cmd | 已恢复 / 通用替代 |
| Start.cmd | Start.cmd | 已恢复 / 通用替代 |
| Stop.cmd | Stop.cmd | 已恢复 / 通用替代 |
| ai-companion-kit/packages/qzone/开通.bat | ai-companion-kit/packages/qzone/开通.bat | 已恢复 / 通用替代 |
| ai-companion-kit/tools/install-node.ps1 | ai-companion-kit/tools/install-node.ps1 | 已恢复 / 通用替代 |
| ai-companion-kit/tools/写日记.bat | ai-companion-kit/tools/写日记.bat | 已恢复 / 通用替代 |
| ai-companion-kit/tools/启动.bat | ai-companion-kit/tools/启动.bat | 已恢复 / 通用替代 |
| ai-companion-kit/tools/安装.bat | ai-companion-kit/tools/安装.bat | 已恢复 / 通用替代 |
| ai-companion-kit/tools/看日记.bat | ai-companion-kit/tools/看日记.bat | 已恢复 / 通用替代 |
| local/autonomy-config.ps1 | local/autonomy-config.ps1 | 已恢复 / 通用替代 |
| local/build-stickers.ps1 | local/build-stickers.ps1 | 已恢复 / 通用替代 |
| local/chat-autonomy-config.ps1 | local/chat-autonomy-config.ps1 | 已恢复 / 通用替代 |
| local/configure.ps1 | local/configure.ps1 | 已恢复 / 通用替代 |
| local/gateway.ps1 | local/gateway.ps1 | 已恢复 / 通用替代 |
| local/keep-awake.ps1 | local/keep-awake.ps1 | 已恢复 / 通用替代 |
| local/launch.ps1 | local/launch.ps1 | 已恢复 / 通用替代 |
| local/phone-setup.ps1 | local/phone-setup.ps1 | 已恢复 / 通用替代 |
| local/qq-runtime-migrate.ps1 | local/qq-runtime-migrate.ps1 | 已恢复 / 通用替代 |
| local/restart.ps1 | local/restart.ps1 | 已恢复 / 通用替代 |
| local/screen-off.ps1 | local/screen-off.ps1 | 已恢复 / 通用替代 |
| local/stop.ps1 | local/stop.ps1 | 已恢复 / 通用替代 |
| qq-bridge/restart.bat | qq-bridge/restart.bat | 已恢复 / 通用替代 |
| qq-bridge/start.bat | qq-bridge/start.bat | 已恢复 / 通用替代 |
| 一键启动.cmd | 一键启动.cmd | 已恢复 / 通用替代 |
| 主动私聊设置.cmd | 主动私聊设置.cmd | 已恢复 / 通用替代 |
| 仅关屏保持[private-name]运行.cmd | 仅关屏保持机器人运行.cmd | 已恢复 / 通用替代 |
| 停止全部.cmd | 停止全部.cmd | 已恢复 / 通用替代 |
| 写日记.cmd | 写日记.cmd | 已恢复 / 通用替代 |
| 恢复自主行为.cmd | 恢复自主行为.cmd | 已恢复 / 通用替代 |
| 暂停自主行为.cmd | 暂停自主行为.cmd | 已恢复 / 通用替代 |
| 检查环境.cmd | 检查环境.cmd | 已恢复 / 通用替代 |
| 看日记.cmd | 看日记.cmd | 已恢复 / 通用替代 |
| 自主行为设置.cmd | 自主行为设置.cmd | 已恢复 / 通用替代 |
| 连接手机.cmd | 连接手机.cmd | 已恢复 / 通用替代 |
| 配置百炼和QQ.cmd | 配置百炼和QQ.cmd | 已恢复 / 通用替代 |
| 重启机器人.cmd | 重启机器人.cmd | 已恢复 / 通用替代 |

## 未原样复制的文件与原因

| 类别 | 文件数 | 替代或处理 |
| --- | ---: | --- |
| 个人/授权未逐项确认的媒体及测试资源 | 24 | 提供程序化通用表情和文档测试生成脚本；公共 HTML 测试基线已单独恢复 |
| 依赖安装副本 | 9025 | 保留锁文件；安装依赖入口使用 npm ci --ignore-scripts |
| 原 Git 历史与元数据 | 221 | 没有复制原历史；当前开源目录中用户自行建立的 Git 元数据不改动 |
| 受限空间协议实现与随附许可文件 | 3 | 用户使用自己的程序/账号初始化；不分发作者运行环境、私人数据或无权再分发的内容 |
| 打包运行环境、下载包和第三方源码 | 1956 | 用户使用自己的程序/账号初始化；不分发作者运行环境、私人数据或无权再分发的内容 |
| 私人备份与旧版本数据 | 9 | 用户使用自己的程序/账号初始化；不分发作者运行环境、私人数据或无权再分发的内容 |
| 私人消息、记忆、空间/媒体记录、日志与状态 | 563 | 用户使用自己的程序/账号初始化；不分发作者运行环境、私人数据或无权再分发的内容 |
| 第三方网关、QQ/原生组件、登录与运行数据 | 2516 | 用户使用自己的程序/账号初始化；不分发作者运行环境、私人数据或无权再分发的内容 |

私人配置、人设和原目录下的单独例外：

| 原文件 | 替代文件 | 原因 |
| --- | --- | --- |
| MCP空间配置.json | MCP空间配置.example.json | 模板公开；初始化时生成本机路径和自己的配置 |
| MCP配置.json | MCP配置.example.json | 模板公开；初始化时生成本机路径和自己的配置 |
| ai-companion-kit/packages/companion/config.json | ai-companion-kit/packages/companion/config.example.json | 真实凭据、账号、路径不复制；由模板在本地初始化 |
| ai-companion-kit/packages/companion/role.md | ai-companion-kit/packages/companion/role.example.md | 私人角色或备份不公开，使用中立可替换模板 |
| ai-companion-kit/packages/companion/role.md.bak-features | ai-companion-kit/packages/companion/role.example.md | 私人角色或备份不公开，使用中立可替换模板 |
| local/features-settings.json | local/features-settings.example.json | 设备序列号与本机信息改为空模板 |
| local/verification-status.json | docs/static-checks.json | 历史运行验收不移植，使用本次真实静态结果 |
| qq-bridge/_snowluma-catalog.json | qq-bridge/src/onebot-client.js | 受限第三方目录快照不分发；自有 OneBot 传输和安全 MCP 替代实际用到的接口 |
| qq-bridge/roles/傲娇助手.md | qq-bridge/roles/default.example.md | 私人角色或备份不公开，使用中立可替换模板 |
| qq-bridge/roles/[private-name].md | qq-bridge/roles/default.example.md | 私人角色或备份不公开，使用中立可替换模板 |

## 功能对照

| 功能 | 保留位置 / 入口 | 外部条件 |
| --- | --- | --- |
| QQ 群聊/私聊、人设、身份、记忆、日记 | companion 全部 src 与根快捷入口 | 自己的账号、API、OneBot |
| 图片/GIF、语音、ASR、视频、文件 | local/multimedia、incoming-attachments、read-document 及原诊断/测试 | 自己的模型、FFmpeg、可选 Python 依赖 |
| 本地/QQ 收藏表情 | stickers、qq-favorites、sticker-collector、build-stickers 与表情入口 | 收藏接口需网关支持；初始化可生成通用素材 |
| 主动私聊、空间自主行为 | chat-autonomy、qzone-autonomy、autonomy GUI 与暂停/恢复入口 | 用户明确开启；完整空间后端见许可条件 |
| 空间发布/读取/点赞/评论/回复 | qzone-adapter、qzone-mcp、vendor-build 本地生成工具 | 自己取得授权的适配器或兼容网关；不能分发旧受限实现 |
| Android、宏、录屏和音乐辅助 | phone-mcp、ncm 与手机入口 | 自己的设备、ADB、应用和必要的键盘 |
| DSH、社交模式、控制台、搜索、语音工具 | qq-bridge 全部 src/public/plugins/dsh/scripts | 自己安装兼容 DSH；受限 SDK 用独立 OneBot 客户端替代 |
| 网关、守护、认证/会话、原生桌面工具 | gateway-health/runtime、service、原生模块和对应测试/PS 工具 | 自己获得授权的程序；启停只针对本副本身份核验通过的进程 |
| 启停、重启、GUI、日志、日记、关屏 | 原入口全部恢复或通用重实现 | 见 SCRIPTS.md |

## 详细文件清单

完整逐文件记录见 [file-parity.json](file-parity.json)；本轮新增恢复文件见 [restored-files.txt](restored-files.txt)；未原样分发的逐文件例外见 [not-distributed-files.txt](not-distributed-files.txt)。

**许可证边界仍然存在：** 本仓库没有声称只安装 npm 依赖并填写 Key，就能自动获得受限空间协议代码或 QQ 原生组件。自有功能逻辑与接入路径已恢复，但必须由用户另外合法取得这些外部能力。见 [ADVANCED_INTEGRATION](ADVANCED_INTEGRATION.md)。

原 npm 入口 68 项，未交代去向 0 项。详见 [entrypoint-parity.json](entrypoint-parity.json)。取消的 postinstall 只用于修补已移除的受限 SDK，其业务接口已由独立实现替代。
