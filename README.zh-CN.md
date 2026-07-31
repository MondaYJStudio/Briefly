# Briefly

[English](README.md)

Briefly 是为优质内容打造的现代化自托管发布引擎。它将富文本创作、不可变版本、私有媒体和清晰的内容 API 汇聚在一次紧凑部署中，让一篇文章从初稿出发，稳定抵达网站、应用与内容流的每一个终点。

## 项目状态

Briefly 目前处于 **pre-alpha 阶段**。Cloudflare 运行时基础已经可以运行，但文章创作与发布功能仍在开发中。

## 为什么选择 Briefly

- 精致的私有创作空间，承载富文本与媒体内容
- 审慎可靠的发布流程，让未完成的修改始终远离公开环境
- 不可变的发布版本，完整保留历史，让每次发布都值得信任
- 私有资源管理，以及面向长期交付的稳定媒体地址
- 展示中立的内容 API，可以自由驱动任何前端
- 完整发布能力集中在一个高效的 Cloudflare Worker 中

## 发布模型

每篇文章拥有一个可变草稿和一组不可变发布版本。发布操作会校验并渲染已保存的草稿、创建新发布版本，并以原子方式将其切换为当前公开版本。如果校验、渲染、媒体解析或存储失败，原有公开版本保持不变。

公开消费者获得的是已存储的语义化 HTML 和解析后的元数据。草稿、认证记录和可编辑的 ProseMirror JSON 永远不会通过公开 API 暴露。

## 技术方案

- TanStack Start 与 React
- Elysia 与 Eden Treaty
- Cloudflare Workers、D1 和私有 R2 存储
- Drizzle ORM 与有序数据库迁移
- Better Auth，用于唯一管理员认证
- Tiptap 与受约束、带版本的 ProseMirror 文档模型
- HeroUI，用于管理界面

## 项目目录

计划中的源码结构让传输层保持轻量，使业务规则不依赖 HTTP，并让路由专属 UI 与所属路由共置。

```text
src/
├── articles/                         # 草稿、发布版本和文章规则
├── assets/                           # 图片元数据与 R2 生命周期规则
├── auth/                             # 认证与授权
├── components/                       # 跨多个路由复用的 UI
├── db/
│   ├── migrations/                   # 有序数据库迁移
│   └── schema/                       # Drizzle schema
├── env/                              # 运行时配置与绑定
└── routes/
    ├── api.$.ts                      # Elysia API 入口
    ├── admin/articles/$articleId/
    │   └── -components/              # 文章路由私有的编辑器 UI
    └── media/$publicId/               # 受控媒体交付
```

## 运行时基线

Briefly 是一个 pnpm 包、一个 TanStack Start 应用和一个 Cloudflare Worker。应用、Elysia/Eden API、健康检查、D1 数据库和私有 R2 存储桶都位于同一个规范来源下。Elysia 运行在 TanStack Start 的服务端路由中，而不是第二个服务器或 Worker。Better-T-Stack 仅作为参考资料，不承担项目生成、工作区管理或生命周期管理。

经过测试并固定的基线如下：

| 工具或运行时        | 固定版本        |
| ------------------- | --------------- |
| Node.js Active LTS  | `24.15.0`       |
| pnpm                | `10.30.3`       |
| Cloudflare 兼容日期 | `2026-07-28`    |
| Cloudflare 兼容标志 | `nodejs_compat` |

请使用 Corepack 或其他遵循 `packageManager` 字段的 pnpm 安装。项目不支持其他包管理器。

## Publication 渲染器

生产环境唯一的 Publication 渲染入口是 [`src/articles/publication-renderer.server.ts`](src/articles/publication-renderer.server.ts) 中的 `renderPublication` 操作。成功结果会记录独立于输入 Document Schema Version 的 Renderer Version `3`。任何可能改变已存储 Publication HTML 或引用事实的修改都必须提升 Renderer Version；现有 Publication 不会被自动重新渲染。

Renderer Version `1` 至 `3` 均使用 Ticket 02 已在 workerd 中验证的无 DOM `@tiptap/static-renderer/pm/html-string` 路径。Version `2` 记录可发布的视频输出及 provider facts；Version `3` 记录由应用拥有的公开 Asset URL 和 Publication Asset 引用事实。生产依赖版本精确固定为：`@tiptap/core`、`@tiptap/pm` 和 `@tiptap/static-renderer` 均为 `3.29.2`，Zod 为 `4.4.3`。它在项目统一的 Cloudflare 兼容日期 `2026-07-28` 和 `nodejs_compat` 标志下运行。可复现的运行时、依赖、打包、安全与被拒绝路径证据保留在 [`prototype/publication-renderer/README.md`](prototype/publication-renderer/README.md)。

`pnpm build` 会在 Cloudflare Vite 插件写入部署配置前选择 Wrangler 的 `production` 环境，避免后续部署意外携带本地 D1/R2 绑定。已提交的配置同时关闭了 Wrangler CLI 指标上报和部署依赖检测。

## 本地开发

从全新检出开始执行：

```sh
pnpm install --frozen-lockfile
pnpm db:migrate:local
pnpm dev
```

应用运行在 `http://localhost:3000`。`GET /api` 用于证明 Elysia API 已通过 TanStack Start 挂载在同一个 Worker 中。`GET /health` 是只读的运行时与数据库结构兼容性检查，不返回凭据、内容、存储桶名称、数据库标识符或对象键。Cloudflare workerd 禁止运行时字符串代码生成，因此 Elysia 的 AOT handler 生成已关闭；决定性的运行时测试会覆盖这项配置。

贡献者的标准检查命令如下：

```sh
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
```

`pnpm test` 会在 Cloudflare 的 workerd 兼容 Vitest 环境中，通过导出的 Worker HTTP 接口运行测试，并使用真实且隔离的测试 D1/R2 绑定。本地开发使用 `.wrangler/` 下的 Wrangler 本地存储；除非运维人员显式添加远程标志，否则不会连接生产资源。日常开发不得使用远程绑定。

`pnpm test:e2e` 只运行一个覆盖关键浏览器旅程的 Playwright 用例。它会在 `.output/playwright/` 下使用全新迁移且隔离的本地 D1/R2 状态启动 Cloudflare 兼容应用，不会复用本地开发或生产存储。本地首次运行前安装 Playwright 锁定版本的 Chromium；失败输出会保留步骤名称、trace 和截图。

非秘密运行时配置和绑定名称在 `wrangler.jsonc` 中声明：

- `APP_ENV` — `local`、`test` 或 `production`
- `APP_ORIGIN` — 精确的规范应用来源；生产环境必须使用 HTTPS
- `DB` — D1 绑定
- `MEDIA_BUCKET` — 私有 R2 绑定

Ticket 01 不要求应用秘密。后续功能需要的本地秘密应写入从 `.dev.vars.example` 复制而来的、已忽略的 `.dev.vars`。生产凭据必须通过 Cloudflare Secrets 创建，例如 `pnpm exec wrangler secret put <NAME> --env production`；不得将凭据写入 `wrangler.jsonc`、已提交的环境文件、日志或客户端代码。

## Cloudflare 部署

唯一受支持的部署形态是：一个 Cloudflare Worker、一个生产 D1 数据库和一个私有生产 R2 存储桶。只有经过检查的变更进入受保护的 `main` 后，已提交的 GitHub Actions 工作流才会发布生产版本。工作流先构建，再由 Wrangler 应用待处理且已提交的迁移；迁移成功后才部署 Worker，最后通过只读的 `GET /health` 能力探测完成冒烟检查。

首次发布前，请创建 Cloudflare 资源、替换 `wrangler.jsonc` 中的生产占位值，并按 [OPERATIONS.zh-CN.md](OPERATIONS.zh-CN.md) 配置受保护的 GitHub 环境和分支规则。应用凭据（包括后续的初始化、恢复与 Better Auth secret）属于 Cloudflare Secrets；Cloudflare 部署令牌和账户标识符属于受保护的 GitHub 环境 secret，二者都不会传给拉取请求任务。

Drizzle schema 文件是数据库结构的事实来源；Drizzle Kit 生成提交在 `src/db/migrations` 下的有序 SQL 与元数据。Wrangler 是唯一的迁移执行器并拥有 D1 迁移账本。项目不支持生产 schema push，Worker 也不会在初始化、请求处理或健康检查期间执行迁移。扩展—收缩迁移规则、0.x 发布兼容要求和故障诊断见运维手册。

该基线不包含产品遥测、主动联网、第三方分析或强制监控账户。结构化服务端日志使用固定的安全信封：时间戳、事件名、已校验的请求 ID、粗粒度操作、方法、状态和可选诊断码。日志 API 排除请求体、Cookie、凭据、会话值、初始化/恢复秘密、URL 和签名媒体数据。

## 公开内容 API

- `GET` / `HEAD /api/articles` — 使用不透明游标仅列出当前发布版本；`limit` 默认为 20、上限为 100，并支持一个归一化后的 `tag` 过滤条件
- `GET` / `HEAD /api/articles/:slug` — 根据规范 slug 获取当前发布版本；Article 公开期间，曾经公开的 slug 会以 `308 Permanent Redirect` 跳转到当前规范 URL
- `GET /api/openapi.json` — 查看机器可读的 OpenAPI 3.1 契约
- `/media/...` — 交付受控的私有媒体与不可变公开媒体

公开内容 API 允许匿名跨域读取，并且不受管理员 Cookie 影响。列表与详情响应使用确定性 ETag，并要求共享缓存重新验证，因此成功发布会立即可见。OpenAPI 源与应用一起提交，其 schema 会用真实 Worker 响应做契约测试。

Article slug 采用唯一且明确的归一化策略：保存的显示 slug 会先移除首尾空白并归一化为 Unicode NFC，同时保留显示大小写；全局唯一键再使用与地区无关的 `und` locale 转为小写，并再次归一化为 NFC，避免大小写映射重新产生可绕过比较的分解等价形式。slug 必须是良构 Unicode，不能包含控制字符、URI 路径保留字符、百分号或反斜杠，也不能是点路径段 `.` 或 `..`。Publication 成功后，其归一化 slug claim 将永久保留；以后成功更改 slug 时，所有曾公开的 slug 都会直接重定向到当前规范 URL。Article 取消发布期间，这些定位符统一返回不披露内部状态的 404。

## 许可证

Briefly 使用 [MIT License](LICENSE) 发布。
