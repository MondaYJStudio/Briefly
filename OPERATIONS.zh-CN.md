# 生产运维

Briefly 仅支持本地/测试环境和一个生产环境，不会创建或记录常驻预发布环境，也不会为拉取请求创建 Worker、D1 或 R2 资源。

## 一次性生产配置

1. 创建一个生产 D1 数据库和一个私有生产 R2 存储桶。替换 `wrangler.jsonc` 中生产数据库 ID、存储桶名称、自定义域名路由和 `APP_ORIGIN` 占位值；保持 `workers_dev` 关闭和 R2 私有。
2. 创建名为 `production` 的 GitHub Environment，把部署分支限制为 `main`，并添加环境变量 `PRODUCTION_ORIGIN`。其值必须与 `wrangler.jsonc` 中不带路径、查询、片段或凭据的规范 HTTPS 来源完全一致。
3. 在该 Environment 添加 secret `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`。令牌只应拥有应用 D1 迁移及部署已配置 Worker、绑定和路由所需的 Cloudflare 权限。不得将二者放入仓库变量或 `wrangler.jsonc`。
4. 通过 `pnpm exec wrangler secret put <NAME> --env production` 将应用 secret 直接写入 Cloudflare。初始化、恢复和 Better Auth secret 属于 Cloudflare Secrets，不属于 GitHub 工作流 YAML 或已提交的环境文件。Wrangler 部署时会保留这些 Worker secret。
5. 使用 GitHub ruleset 或分支保护规则保护 `main`：要求通过拉取请求变更，要求 `Repository checks` 状态检查，合并前要求分支为最新，并禁止强制推送和删除。仅向恢复管理员授予绕过权限。

不要启用 Actions 调试日志，也不要添加打印环境的步骤。GitHub 会遮蔽已登记的 secret；工作流还会把 Cloudflare 凭据仅限于迁移和部署步骤。

## 发布顺序

`.github/workflows/pull-request.yml` 会执行锁定依赖安装、格式检查、发布工作流 lint、类型检查、全部测试和生产构建。它只有仓库只读权限，不接收生产凭据或远程绑定。

把检查通过的修订合并到受保护 `main` 是唯一受支持的生产发布路径。`.github/workflows/deploy-production.yml` 使用不可取消的 `production-release` 并发组，因此迁移/部署不会重叠。单个任务按以下顺序快速失败：

1. 安装已提交的依赖图并在没有部署凭据的情况下构建生产产物。
2. 对生产 D1 绑定运行 `wrangler d1 migrations apply`。Wrangler 是 `d1_migrations` 账本的唯一所有者；不得编辑该表、另行应用生成的 SQL 或使用 schema push。
3. 仅在迁移命令成功后部署 Worker。
4. 向规范来源发送一次匿名 `GET /health` 请求。该路由读取已部署 Worker 所需的数据库结构和存储能力，不比较全局 schema 版本，也不能初始化管理员、创建 Article、上传 Asset 或执行其他生产写入。

基础设施故障后可以安全地重新运行任务：Wrangler 会跳过已记录在账本中的迁移。不得在 Worker 模块初始化、请求处理或健康路由中加入迁移执行。

## 迁移和发布兼容性

每个生产迁移必须是增量迁移，或遵循扩展—收缩顺序。迁移执行后，仍在服务流量的旧 Worker 必须与新数据库结构兼容；如果部署失败，它仍然是生产应用。

重命名或破坏性变更应先扩展结构，并部署同时容忍新旧形态的代码；需要时通过单独评审的步骤迁移数据。只有在已部署代码不再依赖旧形态后的后续版本中才能删除旧结构。不得通过删除或改写已提交的迁移文件来回滚已应用迁移；应添加向前迁移。

Briefly 处于 0.x 生命周期。发布说明必须明确指出任何破坏性 API 行为或迁移要求。补丁版本不得有意破坏已发布的 API 契约或受支持的迁移路径。必要的破坏性变更应进入合适的非补丁版本，并在部署前说明运维操作。

## 私有 Asset 上传

认证媒体库接受 JPEG、PNG、WebP 和 AVIF 图片。系统不信任文件扩展名：声明的 MIME 类型必须与结构验证后的图片字节一致。SVG、GIF、HTML、文档、压缩包、音频、视频和任意二进制文件都会被拒绝。

每次上传采用以下精确边界：

- 编码文件大小：最多 8 MiB（8,388,608 字节）；
- 宽或高：每边最多 8,192 像素；
- 总尺寸：最多 8,388,608 像素。

这些应用限制有意低于平台上限。Cloudflare 文档规定，所有套餐的 Worker 请求体限制均至少为 [100 MB](https://developers.cloudflare.com/workers/platform/limits/#request-limits)，[isolate 内存限制为 128 MB](https://developers.cloudflare.com/workers/platform/limits/#worker-limits)，而 R2 [单次上传限制为 5 GiB](https://developers.cloudflare.com/r2/platform/limits/#r2-limits)。上传校验会在受支持的 workerd 运行时中使用 jSquash 完整解码像素。达到像素上限时，一份 RGBA 图片占 32 MiB；PNG 路径可能短暂同时持有 Wasm 输出及其 32 MiB JavaScript 副本。再为编码请求、JavaScript 缓冲区和 Wasm 输入预留最多 24 MiB 后，isolate 预算仍约有 40 MiB 可供解码器工作内存和运行时状态使用。该精确边界通过使用真实测试 D1/R2 绑定的 Worker HTTP 接口测试验证。

必须保持 R2 绑定私有。未发布对象只能通过认证应用路由 `/media/private/:assetId` 交付；响应带有 `private, no-store` 和 `nosniff`。浏览器可见 API 只公开不透明的 Asset ID 和安全元数据，绝不公开原始 R2 对象键。对象键保密不是授权边界，运维人员不得为私有 Asset 增加直接或匿名存储桶交付。

上传先进入 `uploading` 状态，只有 R2 存储和 D1 的 `ready` 转换都成功后才可选择。失败记录不会出现在媒体库中，并保留机器可读的故障码。`R2_PUT_FAILED` 表示对象未成功写入；`D1_FINALIZE_FAILED` 表示 D1 无法完成收尾后，已上传对象已被删除；`D1_FINALIZE_AND_R2_CLEANUP_FAILED` 表示记录已隐藏，但对象可能仍需运维清理或稍后重试。应根据 D1 状态和存储操作结果诊断；日志绝不能包含图片字节、原始对象键、Cookie 或签名存储数据。

## 故障诊断

| 故障                   | 含义与处理                                                                                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 拉取请求检查           | 没有执行生产操作。在本地复现 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test` 和 `pnpm build`，然后修复待评审修订。                                                                                                          |
| 构建                   | 没有执行生产迁移。根据已检查源码和锁文件诊断构建，不得绕过门禁。                                                                                                                                                                      |
| 迁移                   | 部署尚未开始。检查已提交且由 Drizzle 生成的 SQL 与 Wrangler 错误；使用 `wrangler d1 migrations list DB --env production --remote` 检查待处理状态。不得编辑 Wrangler 账本或改用 schema push/手工 SQL。提交向前修复并通过 `main` 发布。 |
| 迁移后的部署           | 旧 Worker 仍在运行；按设计，已应用迁移必须向后兼容。修复部署/配置问题并重新运行任务，已应用迁移会被跳过。不得试图删除账本记录。                                                                                                       |
| 数据库结构兼容冒烟检查 | 已部署 Worker 无法读取所需的表、列、约束标记或引导行。检查健康诊断和迁移输出，通过已评审的向前迁移恢复能力；健康请求本身必须保持只读。                                                                                                |
| D1 或 R2 健康检查      | 检查生产绑定、Cloudflare 服务状态以及令牌/资源配置。健康响应会有意省略资源标识符和 secret 值。                                                                                                                                        |
| 冒烟传输               | 检查 `PRODUCTION_ORIGIN`、DNS、自定义域名路由、TLS 与已部署 Worker 的规范来源配置。探测不会跟随重定向，只接受文档规定的健康 JSON 能力响应。                                                                                           |

工作流日志只应承载运维元数据，不得包含凭据、请求体、Cookie、内容或带 secret 的 URL。

## 管理员初始化与认证

在部署接收第一个请求前，将 `BETTER_AUTH_SECRET`（至少 32 个字符）和 `SETUP_SECRET`（任意非空值）配置为相互独立的 Cloudflare 配置项。`BETTER_AUTH_SECRET` 建议用密码学安全的密码生成器生成。生产环境使用 `pnpm exec wrangler secret put <NAME> --env production` 写入（一键部署的 `SETUP_SECRET` 也可作为可见 Worker 变量）；不要把真实值放进已提交的 `wrangler.jsonc`、GitHub 变量、日志、URL 或已提交的 `.dev.vars`。

全新安装通过 `/admin/setup` 认领。仅当 D1 安装标记仍为未初始化且请求提供正确 setup secret 时，初始化才会成功。D1 约束与原子认领会阻止并发请求创建第二个 Better Auth 用户。初始化成功后，初始化入口和 Better Auth 邮箱注册都会永久关闭；setup secret 不会存入 D1。认证身份保持私有，也不会被复用为公开署名。

唯一管理员的密码长度为 12–128 个字符，建议使用密码管理器生成。未知邮箱和错误密码返回完全相同的登录失败响应。

凭证滥用限制保存在 D1，而不是 Worker 内存，因此所有 isolate 共享计数器。所有限制都采用固定的 15 分钟窗口，并以 Cloudflare 客户端 IP 的 SHA-256 摘要为键：

- 初始化：5 次；
- 紧急恢复：5 次；
- 邮箱/密码登录：10 次。

无论成功还是失败，每个请求都会计数。超限请求返回 `429` 和 `Retry-After`；无法取得客户端 IP 时，请求共享一个后备桶。后续认证请求会清理已过期的计数器。

Better Auth 将可撤销 session 存在 D1 中。记住的 session 固定有效 7 天；使用满 24 小时后会续回 7 天，受保护的 Elysia 操作会透传续期 cookie。生产 HTTPS 源上的 session cookie 带有 HttpOnly、SameSite=Lax、路径 `/` 和 Secure 属性。退出会删除当前 D1 session，因此重放已丢弃的 cookie 无法再次授权。在 `/admin` 修改密码会撤销全部管理员 session，包括提交改密的当前 session，并要求重新登录。`/admin` 会为导航体验把匿名浏览器重定向到 `/admin/login`，但每个私有服务端操作仍必须独立解析并授权 Better Auth session。

## 管理员紧急恢复

只有部署运维人员有意配置独立的 `RECOVERY_SECRET` 时，恢复功能才会开启。它绝不会回退使用 `SETUP_SECRET`、`BETTER_AUTH_SECRET`、session 或已存储数据；Worker 只从运行时配置读取该值。此 secret 可为任意非空字符串，必须与其他 secret 相互独立，且不得出现在 URL、命令历史参数、日志或已提交文件中。

仅在现有管理员无法登录时执行以下短时流程：

1. 生成新的高熵值，然后运行 `pnpm exec wrangler secret put RECOVERY_SECRET --env production`。仅在 Wrangler 的交互提示中输入该值；如果 Wrangler 提示需要新 Worker 版本，则完成部署。
2. 打开规范生产来源下的 `/admin/recovery`，提交临时恢复 secret 和一个 12–128 字符的新密码。该表单及 `POST /api/recover` 只会重置已经存在的唯一管理员，不能初始化空安装或添加身份。
3. 收到成功响应后，确认持有旧 cookie 的浏览器访问 `/admin` 会被重定向到 `/admin/login`，旧密码登录失败且新密码可以登录。恢复只会在删除 D1 中全部 session 后报告成功。
4. 立即运行 `pnpm exec wrangler secret delete RECOVERY_SECRET --env production` 并确认变更。如果仍需再次尝试，应生成新值进行轮换，不得复用旧值。

恢复按每个客户端固定 15 分钟窗口最多接受 5 个请求，每个请求都会计数。超限客户端会收到带 `Retry-After` 的 `429`，必须等待所指示的窗口；等待期间不要继续保留临时 secret。恢复关闭、secret 错误、管理员不存在和密码输入无效都会返回相同的通用拒绝响应。
