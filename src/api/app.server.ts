import { env } from "cloudflare:workers";
import { Elysia, t } from "elysia";

import {
  createArticle,
  listArticles,
  readArticle,
  updateArticleDraft,
} from "../articles/articles.server";
import {
  listTrashedArticles,
  purgeTrashedArticle,
  restoreTrashedArticle,
  trashArticle,
} from "../articles/article-trash.server";
import { renderSavedArticleDraft } from "../articles/article-publication.server";
import {
  listArticlePublicationHistory,
  restoreArticlePublication,
} from "../articles/publication-history.server";
import {
  listPublicArticles,
  publishArticle,
  resolvePublicArticle,
  unpublishArticle,
} from "../articles/publications.server";
import { recognizeVideoEmbed } from "../articles/video-embeds";
import {
  cleanupAsset,
  listAssets,
  resolvePrivateAssetForRendering,
  uploadAsset,
} from "../assets/assets.server";
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
import { publicOpenApiDocument } from "./public-openapi";

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

function publicContentHeaders(): Headers {
  return new Headers({
    "access-control-allow-origin": "*",
    "cache-control": "public, max-age=0, must-revalidate",
  });
}

function requestMatchesEtag(request: Request, etag: string): boolean {
  return Boolean(
    request.headers
      .get("if-none-match")
      ?.split(",")
      .map((candidate) => candidate.trim())
      .some(
        (candidate) =>
          candidate === "*" || candidate.replace(/^W\//u, "") === etag,
      ),
  );
}

async function etagForBody(body: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
  );
  const base64 = btoa(String.fromCharCode(...digest));
  return `"sha256-${base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")}"`;
}

async function publicJsonResponse(
  request: Request,
  value: unknown,
  options: {
    status?: number;
    head?: boolean;
    etag?: string | true;
  } = {},
): Promise<Response> {
  const headers = publicContentHeaders();
  const body = JSON.stringify(value);
  if (options.etag) {
    const etag = options.etag === true ? await etagForBody(body) : options.etag;
    headers.set("etag", etag);
    if (requestMatchesEtag(request, etag)) {
      return new Response(null, { status: 304, headers });
    }
  }
  headers.set("content-type", "application/json");
  return new Response(options.head ? null : body, {
    status: options.status ?? 200,
    headers,
  });
}

async function publicArticleListResponse(
  database: D1Database,
  request: Request,
  query: unknown,
  head = false,
): Promise<Response> {
  const result = await listPublicArticles(database, query);
  if (!result.ok) {
    const code =
      result.reason === "invalid-query"
        ? "ARTICLE_LIST_QUERY_INVALID"
        : result.reason === "invalid-cursor"
          ? "ARTICLE_LIST_CURSOR_INVALID"
          : "ARTICLE_LIST_CURSOR_STALE";
    return publicJsonResponse(
      request,
      { status: "error", code },
      { status: 400, head },
    );
  }
  return publicJsonResponse(request, result.page, { head, etag: true });
}

async function publicOpenApiResponse(request: Request): Promise<Response> {
  return publicJsonResponse(request, publicOpenApiDocument, { etag: true });
}

async function publicArticleResponse(
  database: D1Database,
  request: Request,
  slug: string,
  head = false,
): Promise<Response> {
  const resolution = await resolvePublicArticle(database, slug);
  if (!resolution) {
    return publicJsonResponse(
      request,
      { status: "error", code: "ARTICLE_NOT_FOUND" },
      { status: 404, head },
    );
  }
  if (resolution.kind === "gone") {
    return publicJsonResponse(
      request,
      { status: "error", code: "ARTICLE_GONE" },
      { status: 410, head },
    );
  }
  if (resolution.kind === "redirect") {
    const headers = publicContentHeaders();
    headers.set(
      "location",
      `/api/articles/${encodeURIComponent(resolution.canonicalSlug)}`,
    );
    return new Response(null, { status: 308, headers });
  }
  return publicJsonResponse(request, resolution.article, {
    head,
    etag: `"${resolution.publicationId}"`,
  });
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
    .get("/admin/trash/articles", async ({ request, set, status }) => {
      const bindings = getBindings();
      set.headers["cache-control"] = "no-store";
      if (!(await administratorIsAuthenticated(bindings, request.headers)))
        return status(401, {
          status: "error" as const,
          code: "AUTHENTICATION_REQUIRED" as const,
        });

      return { articles: await listTrashedArticles(bindings.DB) };
    })
    .post(
      "/admin/articles/:articleId/trash",
      async ({ params, request, set, status }) => {
        const bindings = getBindings();
        set.headers["cache-control"] = "no-store";
        if (!(await administratorIsAuthenticated(bindings, request.headers)))
          return status(401, {
            status: "error" as const,
            code: "AUTHENTICATION_REQUIRED" as const,
          });

        let result: Awaited<ReturnType<typeof trashArticle>>;
        try {
          result = await trashArticle(bindings.DB, params.articleId);
        } catch {
          return status(500, {
            status: "error" as const,
            code: "INTERNAL_ERROR" as const,
          });
        }
        return result.ok
          ? result.article
          : status(404, {
              status: "error" as const,
              code: "ARTICLE_NOT_FOUND" as const,
            });
      },
      { params: t.Object({ articleId: t.String({ format: "uuid" }) }) },
    )
    .post(
      "/admin/trash/articles/:articleId/restore",
      async ({ params, request, set, status }) => {
        const bindings = getBindings();
        set.headers["cache-control"] = "no-store";
        if (!(await administratorIsAuthenticated(bindings, request.headers)))
          return status(401, {
            status: "error" as const,
            code: "AUTHENTICATION_REQUIRED" as const,
          });

        let result: Awaited<ReturnType<typeof restoreTrashedArticle>>;
        try {
          result = await restoreTrashedArticle(bindings.DB, params.articleId);
        } catch {
          return status(500, {
            status: "error" as const,
            code: "INTERNAL_ERROR" as const,
          });
        }
        return result.ok
          ? result.article
          : status(404, {
              status: "error" as const,
              code: "TRASHED_ARTICLE_NOT_FOUND" as const,
            });
      },
      { params: t.Object({ articleId: t.String({ format: "uuid" }) }) },
    )
    .delete(
      "/admin/trash/articles/:articleId",
      async ({ body, params, request, set, status }) => {
        const bindings = getBindings();
        set.headers["cache-control"] = "no-store";
        if (!(await administratorIsAuthenticated(bindings, request.headers)))
          return status(401, {
            status: "error" as const,
            code: "AUTHENTICATION_REQUIRED" as const,
          });

        let result: Awaited<ReturnType<typeof purgeTrashedArticle>>;
        try {
          result = await purgeTrashedArticle(
            bindings.DB,
            params.articleId,
            body.confirmationArticleId,
          );
        } catch {
          return status(500, {
            status: "error" as const,
            code: "INTERNAL_ERROR" as const,
          });
        }
        if (result.ok) return result.article;
        return status(result.reason === "not-found" ? 404 : 409, {
          status: "error" as const,
          code:
            result.reason === "not-found"
              ? ("TRASHED_ARTICLE_NOT_FOUND" as const)
              : ("ARTICLE_PURGE_CONFIRMATION_REQUIRED" as const),
        });
      },
      {
        params: t.Object({ articleId: t.String({ format: "uuid" }) }),
        body: t.Object({
          confirmationArticleId: t.String({ format: "uuid" }),
        }),
      },
    )
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
      "/admin/video-embeds/recognize",
      async ({ body, request, set, status }) => {
        const bindings = getBindings();
        set.headers["cache-control"] = "no-store";
        if (!(await administratorIsAuthenticated(bindings, request.headers)))
          return status(401, {
            status: "error" as const,
            code: "AUTHENTICATION_REQUIRED" as const,
          });

        const recognized = recognizeVideoEmbed(body.input);
        return recognized
          ? recognized
          : status(400, {
              status: "error" as const,
              code: "VIDEO_EMBED_UNSUPPORTED" as const,
              message:
                "Use a supported YouTube or Bilibili URL or identifier; other providers can remain ordinary links.",
            });
      },
      { body: t.Object({ input: t.String({ maxLength: 2_048 }) }) },
    )
    .get("/admin/assets", async ({ request, set, status }) => {
      const bindings = getBindings();
      set.headers["cache-control"] = "no-store";
      if (!(await administratorIsAuthenticated(bindings, request.headers)))
        return status(401, {
          status: "error" as const,
          code: "AUTHENTICATION_REQUIRED" as const,
        });

      return { assets: await listAssets(bindings.DB) };
    })
    .post(
      "/admin/assets",
      async ({ body, request, set, status }) => {
        const bindings = getBindings();
        set.headers["cache-control"] = "no-store";
        if (!(await administratorIsAuthenticated(bindings, request.headers)))
          return status(401, {
            status: "error" as const,
            code: "AUTHENTICATION_REQUIRED" as const,
          });

        const result = await uploadAsset(
          bindings.DB,
          bindings.MEDIA_BUCKET,
          body.file,
        );
        if (result.ok) return status(201, result.asset);
        return result.reason === "invalid"
          ? status(400, {
              status: "error" as const,
              code: "ASSET_UPLOAD_INVALID" as const,
              issues: result.issues,
            })
          : status(503, {
              status: "error" as const,
              code: "ASSET_UPLOAD_FAILED" as const,
            });
      },
      { body: t.Object({ file: t.File() }) },
    )
    .delete(
      "/admin/assets/:assetId",
      async ({ params, request, set, status }) => {
        const bindings = getBindings();
        set.headers["cache-control"] = "no-store";
        if (!(await administratorIsAuthenticated(bindings, request.headers)))
          return status(401, {
            status: "error" as const,
            code: "AUTHENTICATION_REQUIRED" as const,
          });

        const result = await cleanupAsset(
          bindings.DB,
          bindings.MEDIA_BUCKET,
          params.assetId,
        );
        if (result.ok)
          return new Response(null, {
            status: 204,
            headers: { "cache-control": "no-store" },
          });
        if (!result.ok) {
          if (result.reason === "referenced") {
            return status(409, {
              status: "error" as const,
              code: "ASSET_CLEANUP_BLOCKED" as const,
              references: result.references,
            });
          }
          return status(503, {
            status: "error" as const,
            code: "ASSET_CLEANUP_RETRY_REQUIRED" as const,
            asset: result.asset,
          });
        }
      },
      { params: t.Object({ assetId: t.String({ format: "uuid" }) }) },
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
          {
            resolveAsset: (assetId) =>
              resolvePrivateAssetForRendering(
                bindings.DB,
                bindings.MEDIA_BUCKET,
                bindings.APP_ORIGIN,
                assetId,
              ),
          },
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
    .get(
      "/admin/articles/:articleId/publications",
      async ({ params, request, set, status }) => {
        const bindings = getBindings();
        set.headers["cache-control"] = "no-store";
        if (!(await administratorIsAuthenticated(bindings, request.headers)))
          return status(401, {
            status: "error" as const,
            code: "AUTHENTICATION_REQUIRED" as const,
          });

        const result = await listArticlePublicationHistory(
          bindings.DB,
          params.articleId,
        );
        return result.ok
          ? result.history
          : status(404, {
              status: "error" as const,
              code: "ARTICLE_NOT_FOUND" as const,
            });
      },
      { params: t.Object({ articleId: t.String({ format: "uuid" }) }) },
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
            bindings.MEDIA_BUCKET,
            bindings.APP_ORIGIN,
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
          code: "ARTICLE_DRAFT_VERSION_CONFLICT" as const,
        });
      },
      {
        params: t.Object({ articleId: t.String({ format: "uuid" }) }),
        body: t.Object({ draftVersion: t.Number({ minimum: 1 }) }),
      },
    )
    .post(
      "/admin/articles/:articleId/publications/:publicationId/restore",
      async ({ body, params, request, set, status }) => {
        const bindings = getBindings();
        set.headers["cache-control"] = "no-store";
        if (!(await administratorIsAuthenticated(bindings, request.headers)))
          return status(401, {
            status: "error" as const,
            code: "AUTHENTICATION_REQUIRED" as const,
          });

        let result: Awaited<ReturnType<typeof restoreArticlePublication>>;
        try {
          result = await restoreArticlePublication(
            bindings.DB,
            params.articleId,
            params.publicationId,
            body.draftVersion,
            body.confirmDiscardUnpublishedChanges,
          );
        } catch {
          return status(500, {
            status: "error" as const,
            code: "INTERNAL_ERROR" as const,
          });
        }
        if (result.ok) return result.article;
        if (result.reason === "invalid") {
          return status(400, {
            status: "error" as const,
            code: "PUBLICATION_RESTORE_INVALID" as const,
            issues: result.issues,
          });
        }
        if (result.reason === "article-not-found") {
          return status(404, {
            status: "error" as const,
            code: "ARTICLE_NOT_FOUND" as const,
          });
        }
        if (result.reason === "publication-not-found") {
          return status(404, {
            status: "error" as const,
            code: "PUBLICATION_NOT_FOUND" as const,
          });
        }
        return status(409, {
          status: "error" as const,
          code:
            result.reason === "confirmation-required"
              ? ("ARTICLE_DRAFT_RESTORE_CONFIRMATION_REQUIRED" as const)
              : ("ARTICLE_DRAFT_VERSION_CONFLICT" as const),
        });
      },
      {
        params: t.Object({
          articleId: t.String({ format: "uuid" }),
          publicationId: t.String({ format: "uuid" }),
        }),
        body: t.Object({
          draftVersion: t.Number({ minimum: 1 }),
          confirmDiscardUnpublishedChanges: t.Boolean(),
        }),
      },
    )
    .delete(
      "/admin/articles/:articleId/current-publication",
      async ({ params, request, set, status }) => {
        const bindings = getBindings();
        set.headers["cache-control"] = "no-store";
        if (!(await administratorIsAuthenticated(bindings, request.headers)))
          return status(401, {
            status: "error" as const,
            code: "AUTHENTICATION_REQUIRED" as const,
          });

        let result: Awaited<ReturnType<typeof unpublishArticle>>;
        try {
          result = await unpublishArticle(bindings.DB, params.articleId);
        } catch {
          return status(500, {
            status: "error" as const,
            code: "INTERNAL_ERROR" as const,
          });
        }
        if (result.ok) return result.article;
        if (result.reason === "not-found")
          return status(404, {
            status: "error" as const,
            code: "ARTICLE_NOT_FOUND" as const,
          });
      },
      { params: t.Object({ articleId: t.String({ format: "uuid" }) }) },
    )
    .get("/openapi.json", ({ request }) => publicOpenApiResponse(request))
    .get("/articles", ({ query, request }) =>
      publicArticleListResponse(getBindings().DB, request, query),
    )
    .head("/articles", ({ query, request }) =>
      publicArticleListResponse(getBindings().DB, request, query, true),
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
