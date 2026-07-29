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

## Private Asset uploads

The authenticated media library accepts JPEG, PNG, WebP, and AVIF images. It does not trust the filename extension: the declared MIME type must match the structurally verified image bytes. SVG, GIF, HTML, documents, archives, audio, video, and arbitrary binary files are rejected.

Each upload is limited to exactly these boundaries:

- encoded file size: at most 8 MiB (8,388,608 bytes);
- width or height: at most 8,192 pixels per side;
- total dimensions: at most 16,777,216 pixels.

These application limits are intentionally below the platform ceilings. Cloudflare documents a Worker request-body limit of at least [100 MB on every plan](https://developers.cloudflare.com/workers/platform/limits/#request-limits), an [isolate memory limit of 128 MB](https://developers.cloudflare.com/workers/platform/limits/#worker-limits), and an R2 [single-upload limit of 5 GiB](https://developers.cloudflare.com/r2/platform/limits/#r2-limits). A maximum-size image expands to about 64 MiB at four bytes per pixel, leaving the remainder of the Worker limit for multipart parsing, JavaScript/Wasm runtime state, validation, and concurrent request overhead.

Keep the R2 binding private. A never-published object is delivered only through the authenticated `/media/private/:assetId` application route, whose response is marked `private, no-store` and `nosniff`. Browser-visible APIs expose the opaque Asset ID and safe metadata, never the raw R2 object key. Object-key secrecy is not an authorization boundary, and operators must not add direct or anonymous bucket delivery for private Assets.

Uploads pass through an `uploading` state and become selectable only after both R2 storage and the D1 `ready` transition succeed. Failed rows remain hidden from the media library and carry a machine-readable failure code. `R2_PUT_FAILED` means no object was committed; `D1_FINALIZE_FAILED` means the uploaded object was removed after D1 could not finalize; `D1_FINALIZE_AND_R2_CLEANUP_FAILED` means the row is hidden but its object may still require operator cleanup or a later retry. Diagnose these states from D1 and storage operation results. Logs must never include image bytes, raw object keys, cookies, or signed storage data.

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

Credential abuse limits use D1 rather than Worker memory, so isolates share the same counters. All are fixed 15-minute windows keyed by a SHA-256 digest of Cloudflare's client IP:

- initialization: 5 attempts;
- emergency recovery: 5 attempts;
- email/password sign-in: 10 attempts.

Every request counts, whether it succeeds or fails. A blocked request returns `429` and `Retry-After`; an unavailable client IP shares one fallback bucket. Expired counters are removed during later authentication attempts.

Better Auth stores revocable sessions in D1. A remembered session lasts exactly 7 days and is renewed back to 7 days when used after the first 24 hours; the protected Elysia operation propagates the renewed cookie. The session cookie is HttpOnly, SameSite=Lax, scoped to `/`, and Secure at the production HTTPS origin. Signing out deletes the current D1 session, so replaying the discarded cookie cannot authorize another operation. Changing the password from `/admin` revokes every Administrator session, including the one that submitted the change, and requires a fresh sign-in. `/admin` performs a navigation redirect to `/sign-in` for convenience, but every private server operation must continue to resolve and authorize the Better Auth session independently.

## Emergency Administrator recovery

Recovery is off unless the deployment operator deliberately configures a separate `RECOVERY_SECRET`. It never falls back to `SETUP_SECRET`, `BETTER_AUTH_SECRET`, a session, or stored data; the Worker reads it only from runtime configuration. The value must be at least 32 characters, independent of every other secret, and must never appear in a URL, command history argument, log, or committed file.

Use this short-lived procedure only when the existing Administrator cannot sign in:

1. Generate a new high-entropy value, then run `pnpm exec wrangler secret put RECOVERY_SECRET --env production`. Enter the value only at Wrangler's prompt and deploy if Wrangler indicates that a new Worker version is required.
2. Open `/recover` on the canonical production origin. Submit the temporary recovery secret and a new 12–128 character password. The form and `POST /api/recover` reset only the already-existing Administrator; they cannot initialize an empty installation or add an identity.
3. After the success response, confirm that a browser holding an old cookie is redirected from `/admin` to `/sign-in`, that the old password fails, and that the new password signs in. Recovery deletes all D1 sessions before reporting success.
4. Immediately run `pnpm exec wrangler secret delete RECOVERY_SECRET --env production` and confirm the change. If another attempt is needed, rotate it with a newly generated value rather than reusing the old one.

Recovery allows 5 requests per client in each fixed 15-minute window. Every request counts. A blocked client receives `429` with `Retry-After` and must wait for the indicated window; do not leave the temporary secret configured while waiting. Disabled recovery, a wrong secret, an absent Administrator, and invalid password input all return the same generic denial.
