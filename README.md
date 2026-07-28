# Briefly

[简体中文](README.zh-CN.md)

Briefly is a modern, self-hosted publishing engine built for content that deserves a durable life. It brings rich authoring, immutable versioning, private media, and a clean content API into one compact deployment—from the first draft to every website, app, or feed that publishes it.

## Status

Briefly is **pre-alpha**. Its Cloudflare runtime foundation is runnable, but article authoring and publication features are still under development.

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

## Runtime baseline

Briefly is one pnpm package, one TanStack Start application, and one Cloudflare Worker. The Worker owns the application, its Elysia/Eden API, health endpoint, D1 database, and private R2 bucket under one canonical origin. Elysia runs inside a TanStack Start server route rather than as a second server or Worker. Better-T-Stack is reference material only; it is not a generator, workspace manager, or lifecycle dependency.

The tested baseline is pinned to:

| Tool or runtime                | Pinned value    |
| ------------------------------ | --------------- |
| Node.js active LTS             | `24.15.0`       |
| pnpm                           | `10.30.3`       |
| Cloudflare compatibility date  | `2026-07-28`    |
| Cloudflare compatibility flags | `nodejs_compat` |

Use Corepack or another pnpm installation that honors the `packageManager` field. Other package managers are unsupported.

`pnpm build` selects Wrangler's `production` environment before Cloudflare's Vite plugin writes the deploy configuration. This prevents a later deploy from accidentally carrying local D1/R2 bindings. Wrangler CLI metrics and deployment dependency instrumentation are disabled in the committed configuration.

## Local development

From a clean checkout:

```sh
pnpm install --frozen-lockfile
pnpm db:migrate:local
pnpm dev
```

The application is served at `http://localhost:3000`. `GET /api` proves that the Elysia API is mounted through TanStack Start in the same Worker. `GET /health` is a read-only runtime and schema compatibility check; it returns no credentials, content, bucket names, database identifiers, or object keys. Elysia's AOT handler generation is disabled because Cloudflare workerd prohibits runtime string code generation; the decisive runtime test covers this configuration.

The standard contributor checks are:

```sh
pnpm format
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test` runs the exported Worker HTTP interface inside Cloudflare's workerd-compatible Vitest environment with real isolated test D1 and R2 bindings. Local development uses Wrangler's local storage under `.wrangler/`; it does not connect to production unless an operator explicitly adds a remote flag. Do not use remote bindings for routine development.

Non-secret runtime values and binding names are declared in `wrangler.jsonc`:

- `APP_ENV` — `local`, `test`, or `production`
- `APP_ORIGIN` — the exact canonical application origin; production requires HTTPS
- `DB` — the D1 binding
- `MEDIA_BUCKET` — the private R2 binding

Ticket 01 has no required application secrets. For later features, put local-only values in an ignored `.dev.vars` copied from `.dev.vars.example`. Production credentials must be created with Cloudflare Secrets, for example `pnpm exec wrangler secret put <NAME> --env production`; never add credential values to `wrangler.jsonc`, committed environment files, logs, or client code.

## Cloudflare deployment

Cloudflare Workers with one production D1 database and one private production R2 bucket is the only supported deployment shape. Before the first deployment:

1. Create the production D1 database and private R2 bucket in the target Cloudflare account.
2. Replace the placeholder production D1 ID, custom-domain route, and example `APP_ORIGIN` in `wrangler.jsonc`. Keep the bucket private. The production Worker disables its `workers.dev` origin, and requests whose origin differs from `APP_ORIGIN` are rejected.
3. Add any feature-required credentials with `pnpm exec wrangler secret put <NAME> --env production`.
4. Apply reviewed migrations with `pnpm exec wrangler d1 migrations apply DB --env production --remote`.
5. Run `pnpm deploy` and verify `GET /health` at the canonical origin.

Drizzle schema files are the source of truth, and Drizzle Kit generates the ordered SQL and metadata committed under `src/db/migrations`. Wrangler is the migration executor and records applied files in D1's `d1_migrations` table; the project does not maintain a second application schema-version counter. Production schema push is unsupported. The Worker never runs migrations during module initialization, requests, or health checks. Its read-only health check probes the minimum database capabilities required by that Worker, so later compatible additive migrations do not make an older Worker unhealthy. Until the automated migration-first release workflow is added, operators must preserve the order above so a migration failure prevents deployment.

The baseline contains no product telemetry, phone-home behavior, third-party analytics, or mandatory monitoring account. Structured server logs use a fixed safe envelope: timestamp, event name, validated request ID, coarse operation, method, status, and optional diagnosis code. Request bodies, cookies, credentials, session values, setup/recovery secrets, URLs, and signed media data are excluded by the logging API.

## Planned public API

- `GET /api/articles` — list current Publications with cursor pagination
- `GET /api/articles/:slug` — retrieve the current Publication by canonical slug
- `/media/...` — serve controlled private media and immutable public media
- OpenAPI 3.1 — describe the public content contract

The public content API will be anonymous, cross-origin readable, and independent of administrator cookies.

## License

Briefly is released under the [MIT License](LICENSE).
