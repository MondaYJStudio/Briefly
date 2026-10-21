import { env } from "cloudflare:workers";
import { Elysia, status, t } from "elysia";

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
import {
  listArticlePublicationHistory,
  projectAdminArticles,
  restoreArticlePublication,
} from "../articles/publication-history.server";
import type { PublicationOutcome } from "../articles/publication-workflow";
import { publicationWorkflow } from "../articles/publication-workflow.server";
import {
  listPublicArticles,
  resolvePublicArticle,
  unpublishArticle,
} from "../articles/publications.server";
import {
  createArticleTranslation,
  linkArticleTranslation,
  listArticleTranslations,
  listTranslationCandidates,
  unlinkArticleTranslation,
} from "../articles/translation-groups.server";
import { recognizeVideoEmbed } from "../articles/video-embeds";
import { cleanupAsset, listAssets, uploadAsset } from "../assets/assets.server";
import {
  createChannel,
  deleteChannel,
  listChannels,
  updateChannelName,
} from "../channels/channels.server";
import { readAdministratorSession } from "../auth/administrator-session.server";
import {
  disconnectConnectedApp,
  listConnectedApps,
  readOAuthClient,
} from "../auth/connected-apps.server";
import {
  initializeAdministrator,
  installationIsInitialized,
} from "../auth/initialization.server";
import { secretsMatch } from "../auth/secret.server";
import { logPublicationWorkflowFailure } from "../env/logger.server";
import { applicationOriginForRequest } from "../env/origin.server";
import { requestIdFor } from "../env/request-id.server";
import {
  validateRuntimeBindings,
  type RuntimeBindings,
} from "../env/runtime.server";
import {
  localizedSiteSettings,
  readSiteSettings,
  updateSiteSettings,
} from "../site-settings/site-settings.server";
import { resolveSiteLocale } from "../site-settings/site-description-locales";
import { administratorGuard } from "./administrator-guard";
import { publicOpenApiDocument } from "./public-openapi";

// Elysia's dynamic validator cannot compile nullable unions or records of
// unions without TypeCompiler. The server/domain layer performs the closed
// runtime validation; these opaque fields preserve the Eden contract without
// requiring a compiler-only schema at request time.
const adminSiteSettingsContract = t.Object({
  siteName: t.String(),
  siteDescription: t.Any(),
  siteDescriptions: t.Any(),
  defaultByline: t.Object({
    name: t.String(),
    url: t.Any(),
  }),
  defaultLanguage: t.String(),
  publicSiteEnabled: t.Boolean(),
});
const siteSettingsInputContract = t.Object({
  siteName: t.String(),
  siteDescription: t.Optional(t.Any()),
  siteDescriptions: t.Optional(t.Any()),
  defaultByline: t.Object({
    name: t.String(),
    url: t.Any(),
  }),
  defaultLanguage: t.String(),
  publicSiteEnabled: t.Optional(t.Boolean()),
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
// Dynamic Elysia cannot execute a TypeBox nullable union without TypeCompiler.
// The handler performs the closed runtime check while this transform preserves
// the required string-or-null command field in the inferred Eden contract.
const publicationBaselineContract = t
  .Transform(t.Any())
  .Decode((value): string | null => value as string | null)
  .Encode((value) => value);

function publicationWorkflowFor(bindings: RuntimeBindings, request: Request) {
  return publicationWorkflow({
    database: bindings.DB,
    bucket: bindings.MEDIA_BUCKET,
    applicationOrigin: applicationOriginForRequest(bindings, request),
  });
}

/**
 * States how one Publication Workflow outcome is represented over HTTP.
 *
 * Preview and Publish share this mapping, so only their success status differs
 * and their refusals cannot drift apart.
 */
function publicationOutcomeResponse<const Code extends 200 | 201, Value>(
  operation: "preview" | "publish",
  request: Request,
  successStatus: Code,
  outcome: PublicationOutcome<Value>,
) {
  if (outcome.ok) return status(successStatus, outcome.value);
  switch (outcome.reason) {
    case "command-invalid":
      return status(400, {
        status: "error" as const,
        code: "REQUEST_INVALID" as const,
      });
    case "invalid":
      return status(400, {
        status: "error" as const,
        code: "PUBLICATION_INVALID" as const,
        issues: outcome.issues,
      });
    case "not-found":
      return status(404, {
        status: "error" as const,
        code: "ARTICLE_NOT_FOUND" as const,
      });
    case "conflict":
      return status(409, {
        status: "error" as const,
        code: "PUBLICATION_CONFLICT" as const,
      });
    case "failed": {
      const failureStatus =
        outcome.code === "PUBLICATION_NOT_COMPLETED" ? 503 : 500;
      logPublicationWorkflowFailure({
        requestId: requestIdFor(request),
        operation,
        status: failureStatus,
        code: outcome.code,
      });
      return status(failureStatus, {
        status: "error" as const,
        code: outcome.code,
      });
    }
  }
}

function getValidatedWorkerBindings() {
  const configuration = validateRuntimeBindings(env);
  if (!configuration.ok) {
    throw new Error("Validated Worker bindings are unavailable");
  }
  return configuration.bindings;
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
    headers?: HeadersInit;
  } = {},
): Promise<Response> {
  const headers = publicContentHeaders();
  if (options.headers) {
    for (const [name, value] of new Headers(options.headers)) {
      headers.set(name, value);
    }
  }
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

async function publicSiteSettingsResponse(
  database: D1Database,
  request: Request,
  head = false,
): Promise<Response> {
  const settings = await readSiteSettings(database);
  const locale = resolveSiteLocale(request);
  const localized = localizedSiteSettings(settings, locale);
  // Public Site Enabled is an administration gate, not public identity.
  const { publicSiteEnabled: _publicSiteEnabled, ...publicIdentity } =
    localized;
  return publicJsonResponse(request, publicIdentity, {
    head,
    etag: true,
    headers: {
      "content-language": localized.siteDescriptionLocale,
      // The selected representation can depend on either the browser's
      // Accept-Language header or the explicit locale preference cookie.
      vary: "Accept-Language, Cookie",
    },
  });
}

function adminSiteSettingsResponse(
  settings: Awaited<ReturnType<typeof readSiteSettings>>,
) {
  // The administration endpoint returns the complete map (updates may send a
  // partial patch) and therefore has no single negotiated description locale.
  // Public consumers receive the selected-locale projection from `/api/site`.
  return settings;
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
  // Translations change without the Current Publication changing, so the
  // validator must cover the whole representation.
  return publicJsonResponse(request, resolution.article, { head, etag: true });
}

function createApi(getBindings: () => RuntimeBindings) {
  return new Elysia({
    prefix: "/api",
    aot: false,
  })
    .use(administratorGuard(getBindings))
    .onError(({ code, request, status }) => {
      const pathname = new URL(request.url).pathname;
      if (
        (code === "VALIDATION" || code === "PARSE") &&
        /^\/api\/admin\/articles\/[^/]+\/(?:preview|publications)$/u.test(
          pathname,
        )
      ) {
        return status(400, {
          status: "error" as const,
          code: "REQUEST_INVALID" as const,
        });
      }
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
      // The endpoint the admin shell polls is the one place that extends the
      // Administrator Session, so it forwards Better Auth's renewal headers.
      const { administrator, headers } = await readAdministratorSession(
        getBindings(),
        request,
        { refresh: true },
      );
      headers.set("cache-control", "no-store");

      if (!administrator) {
        return Response.json(
          { status: "error", code: "AUTHENTICATION_REQUIRED" },
          { status: 401, headers },
        );
      }

      return Response.json(
        {
          authenticated: true,
          email: administrator.email,
          initials: administrator.initials,
        },
        { headers },
      );
    })
    .get(
      "/admin/site-settings",
      async () => {
        const bindings = getBindings();
        return adminSiteSettingsResponse(await readSiteSettings(bindings.DB));
      },
      {
        administrator: true,
        response: {
          200: adminSiteSettingsContract,
          401: authenticationRequiredContract,
        },
      },
    )
    .put(
      "/admin/site-settings",
      async ({ body, status }) => {
        const bindings = getBindings();
        const result = await updateSiteSettings(bindings.DB, body);
        if (!result.ok) {
          return status(400, {
            status: "error" as const,
            code: "SITE_SETTINGS_INVALID" as const,
            issues: result.issues,
          });
        }
        return adminSiteSettingsResponse(result.settings);
      },
      {
        administrator: true,
        body: siteSettingsInputContract,
        response: {
          200: adminSiteSettingsContract,
          400: siteSettingsInvalidContract,
          401: authenticationRequiredContract,
        },
      },
    )
    .get(
      "/admin/channels",
      async () => {
        const bindings = getBindings();
        return { channels: await listChannels(bindings.DB) };
      },
      { administrator: true },
    )
    .post(
      "/admin/channels",
      async ({ body, status }) => {
        const bindings = getBindings();
        const result = await createChannel(bindings.DB, body);
        if (result.ok) return status(201, result.channel);
        if (result.reason === "slug-conflict") {
          return status(409, {
            status: "error" as const,
            code: "CHANNEL_SLUG_CONFLICT" as const,
          });
        }
        return status(400, {
          status: "error" as const,
          code: "CHANNEL_INVALID" as const,
          issues: result.issues,
        });
      },
      {
        administrator: true,
        body: t.Object({
          slug: t.String(),
          name: t.String(),
        }),
      },
    )
    .put(
      "/admin/channels/:channelId",
      async ({ body, params, status }) => {
        const bindings = getBindings();
        const result = await updateChannelName(
          bindings.DB,
          params.channelId,
          body,
        );
        if (result.ok) return result.channel;
        if (result.reason === "not-found") {
          return status(404, {
            status: "error" as const,
            code: "CHANNEL_NOT_FOUND" as const,
          });
        }
        return status(400, {
          status: "error" as const,
          code: "CHANNEL_INVALID" as const,
          issues: result.issues,
        });
      },
      {
        administrator: true,
        params: t.Object({ channelId: t.String({ format: "uuid" }) }),
        body: t.Object({
          name: t.String(),
        }),
      },
    )
    .delete(
      "/admin/channels/:channelId",
      async ({ params, status }) => {
        const bindings = getBindings();
        const result = await deleteChannel(bindings.DB, params.channelId);
        if (result.ok) {
          return new Response(null, {
            status: 204,
            headers: { "cache-control": "no-store" },
          });
        }
        if (result.reason === "referenced") {
          return status(409, {
            status: "error" as const,
            code: "CHANNEL_IN_USE" as const,
            references: result.references,
          });
        }
        return status(404, {
          status: "error" as const,
          code: "CHANNEL_NOT_FOUND" as const,
        });
      },
      {
        administrator: true,
        params: t.Object({ channelId: t.String({ format: "uuid" }) }),
      },
    )
    .get(
      "/admin/connected-apps",
      async () => ({
        connectedApps: await listConnectedApps(getBindings().DB),
      }),
      { administrator: true },
    )
    .delete(
      "/admin/connected-apps/:clientId",
      async ({ params, status }) => {
        const removed = await disconnectConnectedApp(
          getBindings().DB,
          params.clientId,
        );
        if (removed) {
          return new Response(null, {
            status: 204,
            headers: { "cache-control": "no-store" },
          });
        }
        return status(404, {
          status: "error" as const,
          code: "CONNECTED_APP_NOT_FOUND" as const,
        });
      },
      {
        administrator: true,
        params: t.Object({
          clientId: t.String({ minLength: 1, maxLength: 200 }),
        }),
      },
    )
    .get(
      "/admin/oauth-clients/:clientId",
      async ({ params, status }) => {
        const client = await readOAuthClient(getBindings().DB, params.clientId);
        return (
          client ??
          status(404, {
            status: "error" as const,
            code: "OAUTH_CLIENT_NOT_FOUND" as const,
          })
        );
      },
      {
        administrator: true,
        params: t.Object({
          clientId: t.String({ minLength: 1, maxLength: 200 }),
        }),
      },
    )
    .post(
      "/admin/articles",
      async ({ status }) => {
        const bindings = getBindings();
        return status(201, await createArticle(bindings.DB));
      },
      { administrator: true },
    )
    .get(
      "/admin/articles",
      async ({ request }) => {
        const bindings = getBindings();
        const channel = new URL(request.url).searchParams.get("channel");
        return {
          articles: await projectAdminArticles(
            bindings.DB,
            await listArticles(bindings.DB, {
              channelSlug: channel && channel.length > 0 ? channel : undefined,
            }),
          ),
        };
      },
      { administrator: true },
    )
    .get(
      "/admin/trash/articles",
      async () => {
        const bindings = getBindings();
        return { articles: await listTrashedArticles(bindings.DB) };
      },
      { administrator: true },
    )
    .post(
      "/admin/articles/:articleId/trash",
      async ({ params, status }) => {
        const bindings = getBindings();
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
      {
        administrator: true,
        params: t.Object({ articleId: t.String({ format: "uuid" }) }),
      },
    )
    .post(
      "/admin/trash/articles/:articleId/restore",
      async ({ params, status }) => {
        const bindings = getBindings();
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
      {
        administrator: true,
        params: t.Object({ articleId: t.String({ format: "uuid" }) }),
      },
    )
    .delete(
      "/admin/trash/articles/:articleId",
      async ({ body, params, status }) => {
        const bindings = getBindings();
        let result: Awaited<ReturnType<typeof purgeTrashedArticle>>;
        try {
          result = await purgeTrashedArticle(
            bindings.DB,
            params.articleId,
            body.confirmationTitle,
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
        administrator: true,
        params: t.Object({ articleId: t.String({ format: "uuid" }) }),
        body: t.Object({
          confirmationTitle: t.String(),
        }),
      },
    )
    .get(
      "/admin/articles/:articleId",
      async ({ params, status }) => {
        const bindings = getBindings();
        const article = await readArticle(bindings.DB, params.articleId);
        return article
          ? article
          : status(404, {
              status: "error" as const,
              code: "ARTICLE_NOT_FOUND" as const,
            });
      },
      {
        administrator: true,
        params: t.Object({ articleId: t.String({ format: "uuid" }) }),
      },
    )
    .get(
      "/admin/articles/:articleId/translations",
      async ({ params, status }) => {
        const result = await listArticleTranslations(
          getBindings().DB,
          params.articleId,
        );
        return result.ok
          ? { translations: result.translations }
          : status(404, {
              status: "error" as const,
              code: "ARTICLE_NOT_FOUND" as const,
            });
      },
      {
        administrator: true,
        params: t.Object({ articleId: t.String({ format: "uuid" }) }),
      },
    )
    .get(
      "/admin/articles/:articleId/translation-candidates",
      async ({ params, status }) => {
        const result = await listTranslationCandidates(
          getBindings().DB,
          params.articleId,
        );
        return result.ok
          ? { candidates: result.translations }
          : status(404, {
              status: "error" as const,
              code: "ARTICLE_NOT_FOUND" as const,
            });
      },
      {
        administrator: true,
        params: t.Object({ articleId: t.String({ format: "uuid" }) }),
      },
    )
    .post(
      "/admin/articles/:articleId/translations",
      async ({ body, params, status }) => {
        const result = await createArticleTranslation(
          getBindings().DB,
          params.articleId,
          body,
        );
        if (result.ok) return status(201, result.article);
        switch (result.reason) {
          case "invalid":
            return status(400, {
              status: "error" as const,
              code: "ARTICLE_TRANSLATION_INVALID" as const,
              issues: result.issues,
            });
          case "not-found":
            return status(404, {
              status: "error" as const,
              code: "ARTICLE_NOT_FOUND" as const,
            });
          case "language-taken":
            return status(409, {
              status: "error" as const,
              code: "TRANSLATION_LANGUAGE_TAKEN" as const,
            });
          case "conflict":
            return status(409, {
              status: "error" as const,
              code: "TRANSLATION_GROUP_CONFLICT" as const,
            });
        }
      },
      {
        administrator: true,
        params: t.Object({ articleId: t.String({ format: "uuid" }) }),
        body: t.Any(),
      },
    )
    .put(
      "/admin/articles/:articleId/translations/:translationArticleId",
      async ({ params, status }) => {
        const result = await linkArticleTranslation(
          getBindings().DB,
          params.articleId,
          params.translationArticleId,
        );
        if (result.ok) return { translations: result.translations };
        switch (result.reason) {
          case "not-found":
            return status(404, {
              status: "error" as const,
              code: "ARTICLE_NOT_FOUND" as const,
            });
          case "translation-not-found":
            return status(404, {
              status: "error" as const,
              code: "TRANSLATION_ARTICLE_NOT_FOUND" as const,
            });
          case "self":
            return status(400, {
              status: "error" as const,
              code: "TRANSLATION_SELF_LINK" as const,
            });
          case "already-linked":
            return status(409, {
              status: "error" as const,
              code: "TRANSLATION_ALREADY_LINKED" as const,
            });
          case "language-taken":
            return status(409, {
              status: "error" as const,
              code: "TRANSLATION_LANGUAGE_TAKEN" as const,
            });
          case "conflict":
            return status(409, {
              status: "error" as const,
              code: "TRANSLATION_GROUP_CONFLICT" as const,
            });
        }
      },
      {
        administrator: true,
        params: t.Object({
          articleId: t.String({ format: "uuid" }),
          translationArticleId: t.String({ format: "uuid" }),
        }),
      },
    )
    .delete(
      "/admin/articles/:articleId/translation-group",
      async ({ params, status }) => {
        const result = await unlinkArticleTranslation(
          getBindings().DB,
          params.articleId,
        );
        return result.ok
          ? new Response(null, {
              status: 204,
              headers: { "cache-control": "no-store" },
            })
          : status(404, {
              status: "error" as const,
              code: "ARTICLE_NOT_FOUND" as const,
            });
      },
      {
        administrator: true,
        params: t.Object({ articleId: t.String({ format: "uuid" }) }),
      },
    )
    .put(
      "/admin/articles/:articleId/draft",
      async ({ body, params, status }) => {
        const bindings = getBindings();
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
        administrator: true,
        params: t.Object({ articleId: t.String({ format: "uuid" }) }),
        body: t.Any(),
      },
    )
    .post(
      "/admin/video-embeds/recognize",
      async ({ body, status }) => {
        const bindings = getBindings();
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
      {
        administrator: true,
        body: t.Object({ input: t.String({ maxLength: 2_048 }) }),
      },
    )
    .get(
      "/admin/assets",
      async () => {
        const bindings = getBindings();
        return { assets: await listAssets(bindings.DB) };
      },
      { administrator: true },
    )
    .post(
      "/admin/assets",
      async ({ body, status }) => {
        const bindings = getBindings();
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
      { administrator: true, body: t.Object({ file: t.File() }) },
    )
    .delete(
      "/admin/assets/:assetId",
      async ({ params, status }) => {
        const bindings = getBindings();
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
      {
        administrator: true,
        params: t.Object({ assetId: t.String({ format: "uuid" }) }),
      },
    )
    .post(
      "/admin/articles/:articleId/preview",
      async ({ body, params, request }) =>
        publicationOutcomeResponse(
          "preview",
          request,
          200,
          await publicationWorkflowFor(getBindings(), request).preview({
            articleId: params.articleId,
            draftVersion: body.draftVersion,
          }),
        ),
      {
        // A Draft rehearsal is private to the Administrator who asked for it.
        administrator: { cacheControl: "private, no-store" },
        params: t.Object({ articleId: t.String({ format: "uuid" }) }),
        body: t.Object({ draftVersion: t.Number({ minimum: 1 }) }),
      },
    )
    .get(
      "/admin/articles/:articleId/publications",
      async ({ params, status }) => {
        const bindings = getBindings();
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
      {
        administrator: true,
        params: t.Object({ articleId: t.String({ format: "uuid" }) }),
      },
    )
    .post(
      "/admin/articles/:articleId/publications",
      async ({ body, params, request }) =>
        publicationOutcomeResponse(
          "publish",
          request,
          201,
          await publicationWorkflowFor(getBindings(), request).publish({
            articleId: params.articleId,
            draftVersion: body.draftVersion,
            expectedCurrentPublicationId: body.expectedCurrentPublicationId,
          }),
        ),
      {
        administrator: true,
        params: t.Object({ articleId: t.String({ format: "uuid" }) }),
        body: t.Object({
          draftVersion: t.Number({ minimum: 1 }),
          expectedCurrentPublicationId: publicationBaselineContract,
        }),
      },
    )
    .post(
      "/admin/articles/:articleId/publications/:publicationId/restore",
      async ({ body, params, status }) => {
        const bindings = getBindings();
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
        administrator: true,
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
      async ({ params, status }) => {
        const bindings = getBindings();
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
      {
        administrator: true,
        params: t.Object({ articleId: t.String({ format: "uuid" }) }),
      },
    )
    .get("/openapi.json", ({ request }) => publicOpenApiResponse(request))
    .get("/site", ({ request }) =>
      publicSiteSettingsResponse(getBindings().DB, request),
    )
    .head("/site", ({ request }) =>
      publicSiteSettingsResponse(getBindings().DB, request, true),
    )
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
