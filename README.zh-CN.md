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
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test` 会在 Cloudflare 的 workerd 兼容 Vitest 环境中，通过导出的 Worker HTTP 接口运行测试，并使用真实且隔离的测试 D1/R2 绑定。本地开发使用 `.wrangler/` 下的 Wrangler 本地存储；除非运维人员显式添加远程标志，否则不会连接生产资源。日常开发不得使用远程绑定。

非秘密运行时配置和绑定名称在 `wrangler.jsonc` 中声明：

- `APP_ENV` — `local`、`test` 或 `production`
- `APP_ORIGIN` — 精确的规范应用来源；生产环境必须使用 HTTPS
- `DB` — D1 绑定
- `MEDIA_BUCKET` — 私有 R2 绑定

Ticket 01 不要求应用秘密。后续功能需要的本地秘密应写入从 `.dev.vars.example` 复制而来的、已忽略的 `.dev.vars`。生产凭据必须通过 Cloudflare Secrets 创建，例如 `pnpm exec wrangler secret put <NAME> --env production`；不得将凭据写入 `wrangler.jsonc`、已提交的环境文件、日志或客户端代码。

## Cloudflare 部署

唯一受支持的部署形态是：一个 Cloudflare Worker、一个生产 D1 数据库和一个私有生产 R2 存储桶。首次部署前：

1. 在目标 Cloudflare 账户创建生产 D1 数据库和私有 R2 存储桶。
2. 替换 `wrangler.jsonc` 中占位的生产 D1 ID、自定义域名路由和示例 `APP_ORIGIN`，并保持 R2 存储桶私有。生产 Worker 会禁用 `workers.dev` 来源，并拒绝来源与 `APP_ORIGIN` 不同的请求。
3. 使用 `pnpm exec wrangler secret put <NAME> --env production` 添加功能所需的凭据。
4. 使用 `pnpm exec wrangler d1 migrations apply DB --env production --remote` 应用已评审的迁移。
5. 执行 `pnpm deploy`，并在规范来源上验证 `GET /health`。

Drizzle schema 文件是数据库结构的事实来源；Drizzle Kit 生成提交在 `src/db/migrations` 下的有序 SQL 与元数据。Wrangler 是迁移执行器，并在 D1 的 `d1_migrations` 表中记录已应用文件；项目不再维护第二套应用 schema 版本计数器。项目不支持生产 schema push。Worker 不会在模块初始化、请求处理或健康检查期间执行迁移。只读健康检查探测当前 Worker 所需的最低数据库能力，因此后续兼容的增量迁移不会让旧 Worker 变为不健康。在迁移优先的自动发布工作流完成前，运维人员必须保持上述顺序，让迁移失败阻止部署。

该基线不包含产品遥测、主动联网、第三方分析或强制监控账户。结构化服务端日志使用固定的安全信封：时间戳、事件名、已校验的请求 ID、粗粒度操作、方法、状态和可选诊断码。日志 API 排除请求体、Cookie、凭据、会话值、初始化/恢复秘密、URL 和签名媒体数据。

## 计划中的公开 API

- `GET /api/articles` — 使用游标分页列出当前发布版本
- `GET /api/articles/:slug` — 根据规范 slug 获取当前发布版本
- `/media/...` — 交付受控的私有媒体与不可变公开媒体
- OpenAPI 3.1 — 描述公开内容契约

公开内容 API 将允许匿名跨域读取，并且不受管理员 Cookie 影响。

## 许可证

Briefly 使用 [MIT License](LICENSE) 发布。
