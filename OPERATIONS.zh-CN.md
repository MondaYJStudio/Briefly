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
