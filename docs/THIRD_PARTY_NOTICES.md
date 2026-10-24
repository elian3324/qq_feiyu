# 第三方代码、资源与许可证

本次核对依据原目录随附 LICENSE、npm 锁文件以及本地已安装 Python 包的元数据，未下载或安装依赖，未联网验证上游最新许可。此文记录检查范围与待确认事项，不把包元数据等同于对所有上游内容的权利保证。

## 随仓库分发的源码

| 来源 | 本版本范围 | 许可与处理 |
| --- | --- | --- |
| AI Companion Kit | companion、own-life、phone-mcp 及空间 MCP 入口；已清理配置、示例和人设 | MIT；保留 `ai-companion-kit/LICENSE` 的版权与授权原文 |
| qq-bridge | media-normalize、voice-core、sticker-lib、md-to-plain 四个辅助模块 | MIT；保留 `qq-bridge/LICENSE`。该文件 MIT 正文之后有上游历史应用的说明，其涉及 DSH/SnowLuma 的旧部署流程不代表本版本的安装要求 |
| 本项目新增集成、配置模板与文档 | 根入口、配置环境变量处理、空间动作转发适配、安全检查等 | 根目录 MIT；不为独立第三方程序重新授权 |

源文件中的原有版权说明继续保留。本版本修改包括：移除个人配置和固定关系提示、统一中立称呼、改为系统工具路径、可选手机/空间开关，以及替换受限空间协议实现。

## 明确未分发的第三方内容

- SnowLuma 原生组件、桌面客户端、源码包、SDK/MCP 安装副本及能力目录快照。
- `local/vendor/qzone-protocol.mjs` 的旧改写实现：原附许可为源码可见非商业许可，限制修改版公开分发，不能作为 MIT 项目内容直接公开。没有将其改写、删标注或换名后混入本版本。
- QQ 客户端、NapCat 程序包、登录补丁、预打包 Node/Python/ADB/FFmpeg 和下载缓存。
- 本地 NapCat 源码的随附许可也含公开修改版与商业用途限制；本次未从中摘录、改写或重新许可空间实现。
- 原截图、个人图片、表情、语音、测试媒体和来源授权无法逐项确认的资源。
- 原项目补丁包、历史发布/验收材料和 Git 历史。

本版本主链路没有 `@snowluma/sdk` / `@snowluma/mcp` 依赖，不运行其 postinstall 修补。空间能力通过接口互操作，由部署者另行选择具备相应权限的网关；未对任何特定网关的分发权作保证。

## npm 依赖

只分发依赖声明和锁文件，不分发 `node_modules`。完整版本与锁文件声明的许可证见 [dependency-inventory.json](dependency-inventory.json)。当前发布锁文件中 97 条外部安装记录的许可证为 MIT、ISC、BSD-2-Clause 或 BSD-3-Clause；没有留下指向缺失 LICENSE 的受限 SDK 记录。

主要直接依赖：`ws`、`@modelcontextprotocol/sdk`、`zod` 和 `silk-wasm`。安装必须由部署者自行执行；README 使用 `--ignore-scripts` 避免自动运行安装钩子。若将来把安装后的依赖、WASM 或二进制一起打包，必须重新核对并附带各组件完整许可与所需通知，不能只使用根 MIT。

## 可选 Python 依赖

| 组件 | 本地元数据所载许可 | 本仓库处理 |
| --- | --- | --- |
| PyMuPDF 1.26.7 | GNU AGPL 3.0 / Artifex 商业双重许可 | 仅 requirements 声明；未捆绑其代码或二进制。PDF 功能依赖它，采用 AGPL 或商业授权的部署义务需要部署者按自己的使用/分发方式确认 |
| python-docx 1.2.0 | MIT | 仅声明，不捆绑 |
| openpyxl 3.1.5 | MIT | 仅声明，不捆绑 |
| python-pptx 1.0.2 | MIT | 仅声明，不捆绑 |

根 MIT 不覆盖这些组件。文件阅读默认关闭；无需 PDF 功能时可不安装 PyMuPDF，代码会在实际读取 PDF 时才导入它。若要提供服务、分发集成包或使用商业许可，请先完成对应许可确认。本次没有声称整套含可选依赖的运行环境全部属于 MIT。

FFmpeg 的许可取决于具体构建选项，ADB / Android 工具也有独立条款；本仓库没有提供安装包、自动下载器或再分发授权。

## 尚未覆盖的确认

已排除确定受限和来源不明的随附文件；未联网核验每一个上游发布包实际随附的 LICENSE，也没有证明任意后续网关插件的分发权限。公开本仓库源码与自行打包完整运行环境是不同的分发范围，后者需要重新审查。
