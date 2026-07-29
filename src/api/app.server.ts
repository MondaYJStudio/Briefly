import { env } from "cloudflare:workers";
import { Elysia, t } from "elysia";

import {
  createArticle,
  listArticles,
  readArticle,
  updateArticleDraft,
} from "../articles/articles.server";
import { renderSavedArticleDraft } from "../articles/article-publication.server";
import {
  publishArticle,
  readPublicArticle,
} from "../articles/publications.server";
import {
  initializeAdministrator,
  installationIsInitialized,
} from "../auth/initialization.server";
import { secretsMatch } from "../auth/secret.server";
import {
  validateRuntimeBindings,
  type RuntimeBindings,
} from "../env/runtime.server";
import {
  readSiteSettings,
  updateSiteSettings,
} from "../site-settings/site-settings.server";

const siteSettingsContract = t.Object({
  siteName: t.String(),
  siteDescription: t.Any(),
  defaultByline: t.Object({
    name: t.String(),
    url: t.Any(),
  }),
  defaultLanguage: t.String(),
});
const authenticationRequiredContract = t.Object({
  status: t.Literal("error"),
  code: t.Literal("AUTHENTICATION_REQUIRED"),
});
const siteSettingsInvalidContract = t.Object({
  status: t.Literal("error"),
  code: t.Literal("SITE_SETTINGS_INVALID"),
  issues: t.Array(
    t.Object({
      path: t.String(),
      message: t.String(),
    }),
  ),
});

function getValidatedWorkerBindings() {
  const configuration = validateRuntimeBindings(env);
  if (!configuration.ok) {
    throw new Error("Validated Worker bindings are unavailable");
  }
  return configuration.bindings;
}

async function administratorIsAuthenticated(
  bindings: RuntimeBindings,
  headers: Headers,
): Promise<boolean> {
  const { createAuth } = await import("../auth/auth.server");
  return Boolean(
    await createAuth(bindings).api.getSession({
      headers,
      query: { disableRefresh: true },
    }),
  );
}

async function publicArticleResponse(
  database: D1Database,
  request: Request,
  slug: string,
  head = false,
): Promise<Response> {
  const headers = new Headers({
    "access-control-allow-origin": "*",
    "cache-control": "public, max-age=0, must-revalidate",
  });
  const published = await readPublicArticle(database, slug);
  if (!published) {
    return head
      ? new Response(null, { status: 404, headers })
      : Response.json(
          { status: "error", code: "ARTICLE_NOT_FOUND" },
          { status: 404, headers },
        );
  }

  const etag = `"${published.publicationId}"`;
  headers.set("etag", etag);
  const matches = request.headers
    .get("if-none-match")
    ?.split(",")
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === etag || candidate === "*");
  if (matches) return new Response(null, { status: 304, headers });
  if (head) {
    headers.set("content-type", "application/json");
    return new Response(null, { headers });
  }
  return Response.json(published.article, { headers });
}

function createApi(getBindings: () => RuntimeBindings) {
  return new Elysia({
    prefix: "/api",
    aot: false,
  })
    .get("/", () => ({
      service: "briefly" as const,
      transport: "elysia" as const,
    }))
    .get("/installation", async () =>
      Response.json(
        { initialized: await installationIsInitialized(getBindings().DB) },
        { headers: { "cache-control": "no-store" } },
      ),
    )
    .get("/admin/session", async ({ request }) => {
      const { createAuth } = await import("../auth/auth.server");
      const result = await createAuth(getBindings()).api.getSession({
        headers: request.headers,
        returnHeaders: true,
      });
      const headers = new Headers(result.headers);
      headers.set("cache-control", "no-store");

      if (!result.response) {
        return Response.json(
          { status: "error", code: "AUTHENTICATION_REQUIRED" },
          { status: 401, headers },
        );
      }

      return Response.json({ authenticated: true }, { headers });
    })
    .get(
      "/admin/site-settings",
      async ({ request, set, status }) => {
        const bindings = getBindings();
        set.headers["cache-control"] = "no-store";
        if (!(await administratorIsAuthenticated(bindings, request.headers)))
          return status(401, {
            status: "error" as const,
            code: "AUTHENTICATION_REQUIRED" as const,
          });

        return readSiteSettings(bindings.DB);
      },
      {
        response: {
          200: siteSettingsContract,
          401: authenticationRequiredContract,
        },
      },
    )
    .put(
      "/admin/site-settings",
      async ({ body, request, set, status }) => {
        const bindings = getBindings();
        set.headers["cache-control"] = "no-store";
        if (!(await administratorIsAuthenticated(bindings, request.headers)))
          return status(401, {
            status: "error" as const,
            code: "AUTHENTICATION_REQUIRED" as const,
          });

        const result = await updateSiteSettings(bindings.DB, body);
        if (!result.ok) {
          return status(400, {
            status: "error" as const,
            code: "SITE_SETTINGS_INVALID" as const,
            issues: result.issues,
          });
        }
        return result.settings;
      },
      {
        body: siteSettingsContract,
        response: {
          200: siteSettingsContract,
          400: siteSettingsInvalidContract,
          401: authenticationRequiredContract,
        },
      },
    )
    .post("/admin/articles", async ({ request, set, status }) => {
      const bindings = getBindings();
      set.headers["cache-control"] = "no-store";
      if (!(await administratorIsAuthenticated(bindings, request.headers)))
        return status(401, {
          status: "error" as const,
          code: "AUTHENTICATION_REQUIRED" as const,
        });

      return status(201, await createArticle(bindings.DB));
    })
    .get("/admin/articles", async ({ request, set, status }) => {
      const bindings = getBindings();
      set.headers["cache-control"] = "no-store";
      if (!(await administratorIsAuthenticated(bindings, request.headers)))
        return status(401, {
          status: "error" as const,
          code: "AUTHENTICATION_REQUIRED" as const,
        });

      return { articles: await listArticles(bindings.DB) };
    })
    .get(
      "/admin/articles/:articleId",
      async ({ params, request, set, status }) => {
        const bindings = getBindings();
        set.headers["cache-control"] = "no-store";
        if (!(await administratorIsAuthenticated(bindings, request.headers)))
          return status(401, {
            status: "error" as const,
            code: "AUTHENTICATION_REQUIRED" as const,
          });

        const article = await readArticle(bindings.DB, params.articleId);
        return article
          ? article
          : status(404, {
              status: "error" as const,
              code: "ARTICLE_NOT_FOUND" as const,
            });
      },
      { params: t.Object({ articleId: t.String({ format: "uuid" }) }) },
    )
    .put(
      "/admin/articles/:articleId/draft",
      async ({ body, params, request, set, status }) => {
        const bindings = getBindings();
        set.headers["cache-control"] = "no-store";
        if (!(await administratorIsAuthenticated(bindings, request.headers)))
          return status(401, {
            status: "error" as const,
            code: "AUTHENTICATION_REQUIRED" as const,
          });

        const result = await updateArticleDraft(
          bindings.DB,
          params.articleId,
          body,
        );
        if (result.ok) return result.article;
        if (result.reason === "invalid")
          return status(400, {
            status: "error" as const,
            code: "ARTICLE_DRAFT_INVALID" as const,
            issues: result.issues,
          });
        if (result.reason === "not-found")
          return status(404, {
            status: "error" as const,
            code: "ARTICLE_NOT_FOUND" as const,
          });
        return status(409, {
          status: "error" as const,
          code:
            result.reason === "slug-conflict"
              ? ("ARTICLE_SLUG_CONFLICT" as const)
              : ("ARTICLE_DRAFT_VERSION_CONFLICT" as const),
        });
      },
      {
        params: t.Object({ articleId: t.String({ format: "uuid" }) }),
        body: t.Any(),
      },
    )
    .post(
      "/admin/articles/:articleId/preview",
      async ({ body, params, request, set, status }) => {
        const bindings = getBindings();
        set.headers["cache-control"] = "private, no-store";
        if (!(await administratorIsAuthenticated(bindings, request.headers)))
          return status(401, {
            status: "error" as const,
            code: "AUTHENTICATION_REQUIRED" as const,
          });

        const result = await renderSavedArticleDraft(
          bindings.DB,
          params.articleId,
          (body as { version?: unknown })?.version,
          { resolveAsset: async () => null },
        );
        if (result.ok) return result.renderedDraft;
        if (result.reason === "not-found")
          return status(404, {
            status: "error" as const,
            code: "ARTICLE_NOT_FOUND" as const,
          });
        if (result.reason === "version-conflict")
          return status(409, {
            status: "error" as const,
            code: "ARTICLE_DRAFT_VERSION_CONFLICT" as const,
          });
        return status(400, {
          status: "error" as const,
          code: "ARTICLE_PREVIEW_INVALID" as const,
          issues: result.issues ?? [],
        });
      },
      {
        params: t.Object({ articleId: t.String({ format: "uuid" }) }),
        body: t.Any(),
      },
    )
    .post(
      "/admin/articles/:articleId/publications",
      async ({ body, params, request, set, status }) => {
        const bindings = getBindings();
        set.headers["cache-control"] = "no-store";
        if (!(await administratorIsAuthenticated(bindings, request.headers)))
          return status(401, {
            status: "error" as const,
            code: "AUTHENTICATION_REQUIRED" as const,
          });

        let result: Awaited<ReturnType<typeof publishArticle>>;
        try {
          result = await publishArticle(
            bindings.DB,
            params.articleId,
            body.draftVersion,
          );
        } catch {
          return status(500, {
            status: "error" as const,
            code: "INTERNAL_ERROR" as const,
          });
        }
        if (result.ok) return status(201, result.article);
        if (result.reason === "invalid")
          return status(400, {
            status: "error" as const,
            code: "PUBLICATION_INVALID" as const,
            issues: result.issues,
          });
        if (result.reason === "not-found")
          return status(404, {
            status: "error" as const,
            code: "ARTICLE_NOT_FOUND" as const,
          });
        return status(409, {
          status: "error" as const,
          code:
            result.reason === "already-published"
              ? ("ARTICLE_ALREADY_PUBLISHED" as const)
              : ("ARTICLE_DRAFT_VERSION_CONFLICT" as const),
        });
      },
      {
        params: t.Object({ articleId: t.String({ format: "uuid" }) }),
        body: t.Object({ draftVersion: t.Number({ minimum: 1 }) }),
      },
    )
    .get("/articles/:slug", ({ params, request }) =>
      publicArticleResponse(getBindings().DB, request, params.slug),
    )
    .head("/articles/:slug", ({ params, request }) =>
      publicArticleResponse(getBindings().DB, request, params.slug, true),
    )
    .post(
      "/initialize",
      async ({ body, set, status }) => {
        const bindings = getBindings();
        set.headers["cache-control"] = "no-store";

        if (!(await secretsMatch(body.setupSecret, bindings.SETUP_SECRET))) {
          return status(403, {
            status: "error" as const,
            code: "INITIALIZATION_DENIED" as const,
          });
        }

        const result = await initializeAdministrator(bindings, body);
        if (!result.ok) {
          const code =
            result.reason === "already-initialized"
              ? "INITIALIZATION_CLOSED"
              : "INITIALIZATION_INVALID";
          return status(result.reason === "already-initialized" ? 409 : 400, {
            status: "error" as const,
            code,
          });
        }

        return status(201, { status: "ok" as const });
      },
      {
        body: t.Object({
          setupSecret: t.String(),
          email: t.String(),
          password: t.String(),
        }),
      },
    )
    .post("/recover", async ({ body, set, status }) => {
      set.headers["cache-control"] = "no-store";
      const bindings = getBindings();
      const input = body as {
        recoverySecret?: unknown;
        newPassword?: unknown;
      };
      const authorized =
        typeof input?.recoverySecret === "string" &&
        typeof bindings.RECOVERY_SECRET === "string" &&
        (await secretsMatch(input.recoverySecret, bindings.RECOVERY_SECRET));
      let recovered = false;
      if (authorized && typeof input?.newPassword === "string") {
        const { recoverAdministrator } =
          await import("../auth/credentials.server");
        recovered = (await recoverAdministrator(bindings, input.newPassword))
          .ok;
      }

      return recovered
        ? status(200, { status: "ok" as const })
        : status(403, {
            status: "error" as const,
            code: "RECOVERY_DENIED" as const,
          });
    });
}

export const api = createApi(getValidatedWorkerBindings);

export function createApiForBindings(bindings: RuntimeBindings) {
  return createApi(() => bindings);
}
