# Briefly

[English](README.md)

Briefly 是为优质内容打造的现代化自托管发布引擎。它将富文本创作、不可变版本、私有媒体和清晰的内容 API 汇聚在一次紧凑部署中，让一篇文章从初稿出发，稳定抵达网站、应用与内容流的每一个终点。

## 项目状态

Briefly 目前处于 **pre-alpha 阶段，尚不可安装使用**。首个可运行版本正在开发；运行时基础完成后会补充安装和部署说明。

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

## 计划中的公开 API

- `GET /api/articles` — 使用游标分页列出当前发布版本
- `GET /api/articles/:slug` — 根据规范 slug 获取当前发布版本
- `/media/...` — 交付受控的私有媒体与不可变公开媒体
- OpenAPI 3.1 — 描述公开内容契约

公开内容 API 将允许匿名跨域读取，并且不受管理员 Cookie 影响。

## 许可证

Briefly 计划采用 MIT License。许可证文件将在首个可运行版本发布前加入仓库。
