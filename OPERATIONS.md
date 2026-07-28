# Production operations

Briefly supports local/test and one production environment. It does not provision or document standing staging or per-pull-request Worker, D1, or R2 resources.

## One-time production setup

1. Create one production D1 database and one private production R2 bucket. Replace the production database ID, bucket name, custom-domain route, and `APP_ORIGIN` placeholders in `wrangler.jsonc`. Keep `workers_dev` disabled and R2 private.
2. Create a GitHub Environment named `production`. Restrict its deployment branches to `main` and add `PRODUCTION_ORIGIN` as an environment variable. Its value must be the canonical HTTPS origin from `wrangler.jsonc`, without a path, query, fragment, or credentials.
3. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as secrets on that environment. Give the token only the Cloudflare permissions needed to apply D1 migrations and deploy the configured Worker, bindings, and route. Do not put either value in repository variables or `wrangler.jsonc`.
4. Add application secrets directly to Cloudflare with `pnpm exec wrangler secret put <NAME> --env production`. Setup, recovery, and Better Auth secrets belong there rather than in GitHub workflow YAML or committed environment files. Wrangler preserves these Worker secrets during deployment.
5. Protect `main` with a GitHub ruleset or branch-protection rule. Require changes through pull requests, require the `Repository checks` status check, require the branch to be current before merge, and block force pushes and deletion. Restrict bypass permission to recovery administrators.

Do not enable Actions debug logging or add steps that print the environment. GitHub masks registered secrets, but the workflows also keep Cloudflare credentials scoped only to the migration and deploy steps.

## Release sequence

`.github/workflows/pull-request.yml` runs locked installation, formatting, release-workflow linting, typechecking, all tests, and the production build. It has read-only repository permission and receives no production credentials or remote bindings.

Merging a checked revision to protected `main` is the only supported production release path. `.github/workflows/deploy-production.yml` uses the non-cancelling `production-release` concurrency group, so migration/deployment runs cannot overlap. One job performs these fail-fast steps in order:

1. Install the committed dependency graph and build the production artifact without deployment credentials.
2. Run `wrangler d1 migrations apply` against the production D1 binding. Wrangler is the sole owner of the `d1_migrations` ledger; never edit that table, apply the generated SQL separately, or use schema push.
3. Deploy the Worker only after the migration command succeeds.
4. Send one unauthenticated `GET /health` request to the canonical origin. This route reads the schema and storage capabilities required by the deployed Worker. It does not compare a global schema version and cannot initialize an Administrator, create an Article, upload an Asset, or perform another production write.

A rerun is safe after an infrastructure failure: Wrangler skips migrations already recorded in its ledger. Never add migration execution to Worker module initialization, request handling, or the health route.

## Migration and release compatibility

Every production migration must be additive or follow expand-contract sequencing. The Worker currently serving traffic must remain compatible with the schema immediately after the migration. If a deploy fails, that previous Worker is still the production application.

For a rename or destructive change, first expand the schema and deploy code that tolerates both shapes. Migrate data in a separately reviewed step where needed. Only remove the old shape in a later release after no deployed code depends on it. Do not roll back an applied migration by deleting or rewriting its committed file; add a forward migration.

Briefly is in the 0.x lifecycle. Release notes must explicitly call out any breaking API behavior or migration requirement. A patch release must not intentionally break the published API contract or the supported migration path. Put a necessary breaking change in an appropriate non-patch release and explain operator action before deployment.

## Diagnosing failures

| Failure                    | Meaning and response                                                                                                                                                                                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pull-request check         | No production operation ran. Reproduce `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` locally, then fix the reviewed revision.                                                                                                                                               |
| Build                      | No production migration ran. Diagnose the build from the checked source and lockfile; do not bypass the gate.                                                                                                                                                                                             |
| Migration                  | Deployment did not start. Inspect the committed Drizzle-generated SQL and the Wrangler error. Check pending state with `wrangler d1 migrations list DB --env production --remote`; do not edit Wrangler's ledger or switch to schema push/manual SQL. Commit a forward fix and release it through `main`. |
| Deploy after migration     | The old Worker remains active. The applied migration must be backward-compatible by design. Fix the deployment/configuration issue and rerun the job; already-applied migrations are skipped. Do not try to erase the ledger entry.                                                                       |
| Schema compatibility smoke | The deployed Worker cannot read a required table, column, constraint marker, or bootstrap row. Inspect the health diagnosis and migration output. Restore capability with a reviewed forward migration; the health request itself must stay read-only.                                                    |
| D1 or R2 health            | Check the production bindings, Cloudflare service state, and token/resource configuration. Health responses intentionally omit resource identifiers and secret values.                                                                                                                                    |
| Smoke transport            | Confirm `PRODUCTION_ORIGIN`, DNS, the custom-domain route, TLS, and the deployed Worker's canonical-origin configuration. The probe follows no redirects and accepts only the documented healthy JSON capability response.                                                                                |

Treat workflow logs as operational metadata, not a place for credentials, request bodies, cookies, content, or secret-bearing URLs.

## Administrator initialization and authentication

Configure `BETTER_AUTH_SECRET` and `SETUP_SECRET` as independent Cloudflare Secrets before the first request reaches a deployment. Each value must contain at least 32 characters and should be generated by a cryptographically secure password generator. For production, set them with `pnpm exec wrangler secret put <NAME> --env production`; never put either value in `wrangler.jsonc`, GitHub variables, logs, URLs, or a committed `.dev.vars` file.

A fresh installation is claimed at `/setup`. Initialization accepts the configured setup secret only while the D1 installation marker is uninitialized. D1 constraints and an atomic claim prevent a concurrent request from creating a second Better Auth user. After success, initialization and Better Auth email sign-up remain permanently closed; the setup secret is not stored in D1. Authentication identity is private and is not reused as a public Byline.

The sole Administrator password is 12–128 characters. A password-manager-generated password is recommended. Sign-in failures use the same response for an unknown email and an incorrect password.

Credential abuse limits use D1 rather than Worker memory, so isolates share the same counters. Both are fixed 15-minute windows keyed by a SHA-256 digest of Cloudflare's client IP:

- initialization: 5 attempts;
- email/password sign-in: 10 attempts.

Every request counts, whether it succeeds or fails. A blocked request returns `429` and `Retry-After`; an unavailable client IP shares one fallback bucket. Expired counters are removed during later authentication attempts.

Better Auth stores revocable sessions in D1. A remembered session lasts exactly 7 days and is renewed back to 7 days when used after the first 24 hours; the protected Elysia operation propagates the renewed cookie. The session cookie is HttpOnly, SameSite=Lax, scoped to `/`, and Secure at the production HTTPS origin. Signing out deletes the current D1 session, so replaying the discarded cookie cannot authorize another operation. `/admin` performs a navigation redirect to `/sign-in` for convenience, but every private server operation must continue to resolve and authorize the Better Auth session independently.
