# QQ 空间接口与兼容性

空间模块保留发布、读取、点赞、评论、回复、限流、去重、隐私核验和自主决策逻辑。原本依赖的受限第三方协议改写文件没有进入本仓库。本版本的 `local/qzone-adapter.mjs` 支持明确配置的 OneBot 兼容 HTTP 网关，也恢复了加载用户自己获得授权的本地协议模块的路径，见 [高级集成](ADVANCED_INTEGRATION.md)。

**普通 NapCat 的标准 OneBot v11 接口不保证支持以下空间扩展。** 本次未联网核验任何网关版本，未发布说说或读取账号。如果自己的网关缺少相应能力，请保持空间开关关闭；其他聊天功能仍可运行。此仓库没有附带完整的空间 HTTP 服务端，实现该接口需要自己的、具备使用和分发权限的扩展。

## 接入

本地 `config.json` 的 `qzone.enabled=true` 才开启空间工具。默认使用 OneBot HTTP 地址与 Token；如单独运行空间网关，在本地 `.env` 配置 `QZONE_HTTP_URL` 与 `QZONE_ACCESS_TOKEN`。基础地址不包含动作名称。

请求格式：`POST <base>/<action>`，JSON 请求体；凭据通过 `Authorization: Bearer ...` 传入，禁止放在 URL。响应应符合 OneBot 风格：

```json
{
  "status": "ok",
  "retcode": 0,
  "data": {}
}
```

失败应返回非 ok 状态，机器人会停止该次操作并记录失败，不伪称成功。若服务端动作名不同，可在本地 `qzone.actions` 中配置别名，例如 `{"send_qzone_msg":"publish_post"}`；动作名只允许字母、数字和下划线。别名只改变路由，不转换参数与响应结构。

## 动作契约

| 动作 | 主要参数 | `data` 的必要结构 |
| --- | --- | --- |
| `send_qzone_msg` | `content`, `images`（本地已核验路径数组）, `ugc_right` | `tid` 非空字符串；需可靠返回发布结果，避免重复发布 |
| `get_qzone_msg_list` | `target_uin`, `pos`, `num` | `msglist` 数组；条目含 `tid`, `content`, `time`（Unix 秒）, `images`（URL 数组）, `is_private` |
| `get_qzone_feeds` | `count` | `feeds` 数组；条目含 `key`（tid）, `uin`, `nickname`, `html`, `time`；可附 `has_more` |
| `get_qzone_msg_detail` | `target_uin`, `tid`, `pos`, `num` | `tid`, `comment_num`（整数）, `comments` 数组 |
| `like_qzone` | `target_uin`, `tid`, `abstime` | 成功对象 |
| `comment_qzone` | `target_uin`, `tid`, `content` | 成功对象，建议包含评论标识 |
| `reply_qzone` | `target_uin`, `tid`, `comment_id`, `reply_uin`, `content` | 成功对象，建议包含回复标识 |
| `get_credentials` | `domain: "qzone.qq.com"` | 可选，含 `cookies` 字符串；仅在需要读取已获授权空间配图时使用 |

`comments` 条目应有 `comment_id`、`uin`、`content`、`time`（Unix 秒）、`replies` 数组；回复使用同样字段，可增加 `reply_to_uin`。空列表必须为 `[]`，不要返回 null。分页信息缺失或不一致会被视为不完整，自动回复可能跳过该线程。

`get_credentials` 返回的 Cookie 只在内存缓存，并只用于受限 QQ 图片域名请求；不得写入公开文件。可以不实现这个可选动作，此时需要认证的图片可能不可读，文本互动仍取决于其他动作的支持情况。

## 开启自主互动

1. 先自行确认空间网关的动作契约、可见性和账号权限。
2. 通过已验证管理员的明确指令使用空间工具；群内发布还要满足代码的显式发布意图识别。
3. 如需自主行为，再开启 `autonomy.qzone.enabled` 和各个行为开关，解除 `autonomy.paused`；预演与真实行为由 `autonomy.dryRun` 控制。
4. 自主发布默认好友可见；只允许配置好友或仅自己可见。每日、每周、线程冷却和去重限制均保留。

服务端应自行验证账号与权限、保护凭据、处理本机文件路径，以及保证发布结果可确认。部署在不同主机时，本地配图路径需要服务端自行适配；仓库没有假定存在远程上传能力。
