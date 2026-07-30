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

## Publication renderer

The production Publication renderer is the single `renderPublication` operation in [`src/articles/publication-renderer.server.ts`](src/articles/publication-renderer.server.ts). Successful output records the current Renderer Version `3` separately from the input Document Schema Version. Increment the Renderer Version whenever a change can alter stored Publication HTML or reference facts; existing Publications are not re-rendered automatically.

Renderer Versions `1` through `3` use the DOM-free `@tiptap/static-renderer/pm/html-string` path proven in workerd by Ticket 02. Version `2` records the now-publishable video output and provider facts; Version `3` records application-owned public Asset URLs and Publication Asset reference facts. Production versions are pinned exactly: `@tiptap/core`, `@tiptap/pm`, and `@tiptap/static-renderer` at `3.29.2`, with Zod `4.4.3`. It runs under the project-wide Cloudflare compatibility date `2026-07-28` and `nodejs_compat` flag. The reproducible runtime, dependency, bundle, security, and rejected-path evidence remains in [`prototype/publication-renderer/README.md`](prototype/publication-renderer/README.md).

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
pnpm lint
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

Cloudflare Workers with one production D1 database and one private production R2 bucket is the only supported deployment shape. Production releases run only through the committed GitHub Actions workflow after a checked change reaches protected `main`. The workflow builds first, applies pending committed migrations with Wrangler, deploys the Worker only after migration success, and then makes a read-only `GET /health` capability probe.

Before the first release, create the Cloudflare resources, replace the production placeholders in `wrangler.jsonc`, and configure the protected GitHub environment and branch rules described in [OPERATIONS.md](OPERATIONS.md). Application credentials, including future setup, recovery, and Better Auth secrets, belong in Cloudflare Secrets. The Cloudflare deployment token and account identifier belong in protected GitHub environment secrets; neither is passed to pull-request jobs.

Drizzle schema files are the source of truth, and Drizzle Kit generates the ordered SQL and metadata committed under `src/db/migrations`. Wrangler is the sole migration executor and owns D1's migration ledger. Production schema push is unsupported, and the Worker never runs migrations during initialization, requests, or health checks. See the operations runbook for expand-contract migration rules, 0.x release compatibility, and failure diagnosis.

The baseline contains no product telemetry, phone-home behavior, third-party analytics, or mandatory monitoring account. Structured server logs use a fixed safe envelope: timestamp, event name, validated request ID, coarse operation, method, status, and optional diagnosis code. Request bodies, cookies, credentials, session values, setup/recovery secrets, URLs, and signed media data are excluded by the logging API.

## Public content API

- `GET` / `HEAD /api/articles` — list only current Publications using opaque cursor pagination; `limit` defaults to 20 and is capped at 100, and one normalized `tag` filter is supported
- `GET` / `HEAD /api/articles/:slug` — retrieve the current Publication by canonical slug
- `GET /api/openapi.json` — inspect the machine-readable OpenAPI 3.1 contract
- `/media/...` — serve controlled private media and immutable public media

The public content API is anonymous, cross-origin readable, and independent of administrator cookies. List and detail responses use deterministic ETags and require shared caches to revalidate so a successful publish is visible immediately. The OpenAPI source is committed with the application and its schemas are tested against real Worker responses.

## License

Briefly is released under the [MIT License](LICENSE).
