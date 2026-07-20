# Briefly

[简体中文](README.zh-CN.md)

Briefly is a modern, self-hosted publishing engine built for content that deserves a durable life. It brings rich authoring, immutable versioning, private media, and a clean content API into one compact deployment—from the first draft to every website, app, or feed that publishes it.

## Status

Briefly is currently **pre-alpha and not ready to install**. The first runnable release is under development; setup and deployment instructions will be added when the runtime foundation is available.

## Why Briefly

- A polished private workspace for writing rich, media-backed articles
- Deliberate publishing that keeps every unfinished change safely out of public view
- Immutable Publications that preserve history and make every release trustworthy
- Private asset management with permanent, publication-ready media URLs
- A presentation-neutral content API ready to power any frontend
- A complete publishing stack delivered as one efficient Cloudflare Worker

## Publishing model

Each Article has one mutable Draft and a history of immutable Publications. Publishing validates and renders a saved Draft, creates a new Publication, and atomically makes it current. If validation, rendering, media resolution, or storage fails, the previous public version remains unchanged.

Public consumers receive stored semantic HTML and resolved metadata. Drafts, authentication records, and editable ProseMirror JSON are never exposed by the public API.

## Technology

- TanStack Start and React
- Elysia with Eden Treaty
- Cloudflare Workers, D1, and private R2 storage
- Drizzle ORM and ordered database migrations
- Better Auth for the sole administrator
- Tiptap with a constrained, versioned ProseMirror document model
- HeroUI for the administration interface

## Project structure

The intended source layout keeps transport code thin, business rules independent of HTTP, and route-specific UI beside its route.

```text
src/
├── articles/                         # Draft, publication, and article rules
├── assets/                           # Image metadata and R2 lifecycle rules
├── auth/                             # Authentication and authorization
├── components/                       # UI shared across multiple routes
├── db/
│   ├── migrations/                   # Ordered database migrations
│   └── schema/                       # Drizzle schemas
├── env/                              # Runtime configuration and bindings
└── routes/
    ├── api.$.ts                      # Elysia API entry point
    ├── admin/articles/$articleId/
    │   └── -components/              # Article editor UI local to the route
    └── media/$publicId/               # Controlled media delivery
```

## Planned public API

- `GET /api/articles` — list current Publications with cursor pagination
- `GET /api/articles/:slug` — retrieve the current Publication by canonical slug
- `/media/...` — serve controlled private media and immutable public media
- OpenAPI 3.1 — describe the public content contract

The public content API will be anonymous, cross-origin readable, and independent of administrator cookies.

## License

Briefly is intended to be released under the MIT License. The license file will be included before the first runnable release.
