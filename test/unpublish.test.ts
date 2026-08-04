import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import type {
  ArticleDocument,
  ArticleDraftUpdate,
} from "../src/articles/articles";
import { initializeAndSignIn } from "./administrator-fixture";
import { uploadOnePixelPngAsset } from "./asset-fixture";

function textDocument(text: string): ArticleDocument {
  return {
    documentSchemaVersion: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text }],
        },
      ],
    },
  };
}

function figureDocument(assetId: string): ArticleDocument {
  return {
    documentSchemaVersion: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Retained media body" }],
        },
        {
          type: "figure",
          attrs: {
            assetId,
            alt: "Retained figure",
            caption: "Retained caption",
            decorative: false,
          },
        },
      ],
    },
  };
}

async function createPublishedArticle(
  cookie: string,
  options: Partial<Omit<ArticleDraftUpdate, "version">> = {},
): Promise<{ id: string; publication: Response }> {
  const {
    title = "Article to withdraw",
    slug = "withdrawn-article",
    summary = "Public until explicitly withdrawn",
    tags = ["lifecycle"],
    byline = null,
    language = null,
    cover = null,
    document = textDocument("Retained Draft body"),
  } = options;
  const created = await SELF.fetch("http://briefly.test/api/admin/articles", {
    method: "POST",
    headers: { cookie },
  });
  expect(created.status).toBe(201);
  const { id } = await created.json<{ id: string }>();

  const saved = await SELF.fetch(
    `http://briefly.test/api/admin/articles/${id}/draft`,
    {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        title,
        slug,
        summary,
        tags,
        byline,
        language,
        cover,
        document,
      }),
    },
  );
  expect(saved.status).toBe(200);

  const published = await SELF.fetch(
    `http://briefly.test/api/admin/articles/${id}/publications`,
    {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        draftVersion: 2,
        expectedCurrentPublicationId: null,
      }),
    },
  );
  expect(published.status).toBe(201);
  return { id, publication: published };
}

describe("Article unpublish", () => {
  beforeEach(async () => {
    const { results } = await env.DB.prepare(
      "SELECT object_key FROM asset",
    ).all<{ object_key: string }>();
    await Promise.all(
      results.map(({ object_key }) => env.MEDIA_BUCKET.delete(object_key)),
    );
    await env.DB.batch([
      env.DB.prepare("DROP TRIGGER IF EXISTS reject_article_unpublish"),
      env.DB.prepare("UPDATE article SET current_publication_id = NULL"),
      env.DB.prepare("DELETE FROM publication"),
      env.DB.prepare("DELETE FROM article_draft"),
      env.DB.prepare("DELETE FROM article"),
      env.DB.prepare("DELETE FROM asset"),
      env.DB.prepare("DELETE FROM auth_session"),
      env.DB.prepare("DELETE FROM auth_account"),
      env.DB.prepare("DELETE FROM auth_user"),
      env.DB.prepare("DELETE FROM auth_rate_limit"),
      env.DB.prepare(
        "UPDATE installation SET state = 'uninitialized', initialized_at = NULL WHERE id = 1",
      ),
    ]);
  });

  it("requires an Administrator session", async () => {
    const articleId = "00000000-0000-4000-8000-000000000000";

    const response = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${articleId}/current-publication`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "error",
      code: "AUTHENTICATION_REQUIRED",
    });
  });

  it("withdraws the Current Publication from anonymous list and detail reads immediately", async () => {
    const cookie = await initializeAndSignIn();
    const { id: articleId } = await createPublishedArticle(cookie);
    const publicList = await SELF.fetch("http://briefly.test/api/articles");
    const publicDetail = await SELF.fetch(
      "http://briefly.test/api/articles/withdrawn-article",
    );
    const listEtag = publicList.headers.get("etag");
    const detailEtag = publicDetail.headers.get("etag");
    expect(publicList.status).toBe(200);
    expect(publicDetail.status).toBe(200);
    expect(listEtag).toBeTruthy();
    expect(detailEtag).toBeTruthy();

    const unpublished = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${articleId}/current-publication`,
      { method: "DELETE", headers: { cookie } },
    );

    expect(unpublished.status).toBe(200);
    expect(unpublished.headers.get("cache-control")).toBe("no-store");
    expect(await unpublished.json()).toEqual({
      id: articleId,
      currentPublicationId: null,
    });

    const firstListRead = await SELF.fetch("http://briefly.test/api/articles", {
      headers: { "if-none-match": listEtag! },
    });
    expect(firstListRead.status).toBe(200);
    expect(firstListRead.headers.get("etag")).not.toBe(listEtag);
    expect(await firstListRead.json()).toEqual({
      items: [],
      nextCursor: null,
    });

    const detailRequests = await Promise.all([
      SELF.fetch("http://briefly.test/api/articles/withdrawn-article", {
        headers: { "if-none-match": detailEtag! },
      }),
      SELF.fetch("http://briefly.test/api/articles/withdrawn-article", {
        method: "HEAD",
        headers: { "if-none-match": detailEtag! },
      }),
    ]);
    for (const response of detailRequests) {
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe(
        "public, max-age=0, must-revalidate",
      );
      expect(response.headers.get("etag")).toBeNull();
    }
    expect(await detailRequests[0].json()).toEqual({
      status: "error",
      code: "ARTICLE_NOT_FOUND",
    });
    expect(await detailRequests[1].text()).toBe("");

    const privateRead = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${articleId}`,
      { headers: { cookie } },
    );
    expect(privateRead.status).toBe(200);
    expect(await privateRead.json()).toMatchObject({
      id: articleId,
      currentPublicationId: null,
      draft: { title: "Article to withdraw" },
    });
  }, 30_000);

  it("leaves the Current Publication visible when D1 rejects the command", async () => {
    const cookie = await initializeAndSignIn();
    const { id: articleId } = await createPublishedArticle(cookie, {
      slug: "atomic-withdrawal",
    });
    const before = await SELF.fetch(
      "http://briefly.test/api/articles/atomic-withdrawal",
    );
    const beforeBody = await before.json();
    const currentPublicationId = await env.DB.prepare(
      "SELECT current_publication_id FROM article WHERE id = ?",
    )
      .bind(articleId)
      .first<string>("current_publication_id");
    expect(currentPublicationId).toBeTruthy();
    await env.DB.prepare(
      `CREATE TRIGGER reject_article_unpublish
       BEFORE UPDATE OF current_publication_id ON article
       WHEN OLD.current_publication_id IS NOT NULL
         AND NEW.current_publication_id IS NULL
       BEGIN
         SELECT RAISE(ABORT, 'forced unpublish failure');
       END`,
    ).run();

    let failed: Response;
    try {
      failed = await SELF.fetch(
        `http://briefly.test/api/admin/articles/${articleId}/current-publication`,
        { method: "DELETE", headers: { cookie } },
      );
    } finally {
      await env.DB.prepare(
        "DROP TRIGGER IF EXISTS reject_article_unpublish",
      ).run();
    }

    expect(failed.status).toBe(500);
    expect(failed.headers.get("cache-control")).toBe("no-store");
    expect(await failed.json()).toEqual({
      status: "error",
      code: "INTERNAL_ERROR",
    });
    expect(
      await env.DB.prepare(
        "SELECT current_publication_id FROM article WHERE id = ?",
      )
        .bind(articleId)
        .first(),
    ).toEqual({ current_publication_id: currentPublicationId });

    const stillPublic = await SELF.fetch(
      "http://briefly.test/api/articles/atomic-withdrawal",
    );
    expect(stillPublic.status).toBe(200);
    expect(await stillPublic.json()).toEqual(beforeBody);
  }, 30_000);

  it("is idempotent when a successful command is retried", async () => {
    const cookie = await initializeAndSignIn();
    const { id: articleId } = await createPublishedArticle(cookie, {
      slug: "retry-withdrawal",
    });
    const request = () =>
      SELF.fetch(
        `http://briefly.test/api/admin/articles/${articleId}/current-publication`,
        { method: "DELETE", headers: { cookie } },
      );

    expect((await request()).status).toBe(200);
    const retried = await request();

    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual({
      id: articleId,
      currentPublicationId: null,
    });
  }, 30_000);

  it("does not disclose whether an unavailable slug is unknown, Draft-only, or unpublished", async () => {
    const cookie = await initializeAndSignIn();
    const { id: unpublishedId } = await createPublishedArticle(cookie, {
      slug: "private-after-withdrawal",
    });
    expect(
      (
        await SELF.fetch(
          `http://briefly.test/api/admin/articles/${unpublishedId}/current-publication`,
          { method: "DELETE", headers: { cookie } },
        )
      ).status,
    ).toBe(200);

    const draftOnly = await SELF.fetch(
      "http://briefly.test/api/admin/articles",
      { method: "POST", headers: { cookie } },
    );
    const { id: draftOnlyId } = await draftOnly.json<{ id: string }>();
    const savedDraftOnly = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${draftOnlyId}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          title: "Private Draft",
          slug: "draft-only-private",
          summary: null,
          tags: [],
          byline: null,
          language: null,
          cover: null,
          document: textDocument("Never published body"),
        }),
      },
    );
    expect(savedDraftOnly.status).toBe(200);

    const slugs = [
      "private-after-withdrawal",
      "draft-only-private",
      "unknown-private",
    ];
    const getResponses = await Promise.all(
      slugs.map((slug) =>
        SELF.fetch(`http://briefly.test/api/articles/${slug}`),
      ),
    );
    for (const response of getResponses) {
      expect(response.status).toBe(404);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("cache-control")).toBe(
        "public, max-age=0, must-revalidate",
      );
      expect(response.headers.get("etag")).toBeNull();
      expect(await response.json()).toEqual({
        status: "error",
        code: "ARTICLE_NOT_FOUND",
      });
    }

    const headResponses = await Promise.all(
      slugs.map((slug) =>
        SELF.fetch(`http://briefly.test/api/articles/${slug}`, {
          method: "HEAD",
        }),
      ),
    );
    for (const response of headResponses) {
      expect(response.status).toBe(404);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("cache-control")).toBe(
        "public, max-age=0, must-revalidate",
      );
      expect(response.headers.get("etag")).toBeNull();
      expect(await response.text()).toBe("");
    }
  }, 30_000);

  it("retains Draft, Publication, slug, Asset references, and immutable public media", async () => {
    const cookie = await initializeAndSignIn();
    const asset = await uploadOnePixelPngAsset(cookie, "retained.png");
    const { id: articleId, publication } = await createPublishedArticle(
      cookie,
      {
        title: "Retained asset-backed Article",
        slug: "retained-asset-backed-article",
        summary: null,
        tags: [],
        cover: { assetId: asset.id, alt: "Retained cover" },
        document: figureDocument(asset.id),
      },
    );
    const { article: publicArticle } = await publication.json<{
      article: { cover: { url: string } };
    }>();
    const publicMediaBefore = await SELF.fetch(publicArticle.cover.url);
    expect(publicMediaBefore.status).toBe(200);
    const mediaBytes = await publicMediaBefore.arrayBuffer();

    const articleBefore = await env.DB.prepare(
      "SELECT * FROM article WHERE id = ?",
    )
      .bind(articleId)
      .first<Record<string, unknown>>();
    const draftBefore = await env.DB.prepare(
      "SELECT * FROM article_draft WHERE article_id = ?",
    )
      .bind(articleId)
      .first<Record<string, unknown>>();
    const publicationsBefore = (
      await env.DB.prepare(
        "SELECT * FROM publication WHERE article_id = ? ORDER BY publication_number",
      )
        .bind(articleId)
        .all<Record<string, unknown>>()
    ).results;
    const slugsBefore = (
      await env.DB.prepare(
        "SELECT * FROM article_slug WHERE article_id = ? ORDER BY slug_key",
      )
        .bind(articleId)
        .all<Record<string, unknown>>()
    ).results;
    const assetBefore = await env.DB.prepare("SELECT * FROM asset WHERE id = ?")
      .bind(asset.id)
      .first<Record<string, unknown>>();
    const draftReferencesBefore = (
      await env.DB.prepare(
        "SELECT * FROM article_draft_asset_reference WHERE article_id = ? ORDER BY asset_id",
      )
        .bind(articleId)
        .all<Record<string, unknown>>()
    ).results;
    const publicationReferencesBefore = (
      await env.DB.prepare(
        `SELECT publication_asset_reference.*
         FROM publication_asset_reference
         JOIN publication
           ON publication.id = publication_asset_reference.publication_id
         WHERE publication.article_id = ?
         ORDER BY publication_asset_reference.asset_id`,
      )
        .bind(articleId)
        .all<Record<string, unknown>>()
    ).results;

    const unpublished = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${articleId}/current-publication`,
      { method: "DELETE", headers: { cookie } },
    );
    expect(unpublished.status).toBe(200);

    const articleAfter = await env.DB.prepare(
      "SELECT * FROM article WHERE id = ?",
    )
      .bind(articleId)
      .first<Record<string, unknown>>();
    expect(articleAfter).toEqual({
      ...articleBefore,
      current_publication_id: null,
    });
    expect(
      await env.DB.prepare("SELECT * FROM article_draft WHERE article_id = ?")
        .bind(articleId)
        .first(),
    ).toEqual(draftBefore);
    expect(
      (
        await env.DB.prepare(
          "SELECT * FROM publication WHERE article_id = ? ORDER BY publication_number",
        )
          .bind(articleId)
          .all()
      ).results,
    ).toEqual(publicationsBefore);
    expect(
      (
        await env.DB.prepare(
          "SELECT * FROM article_slug WHERE article_id = ? ORDER BY slug_key",
        )
          .bind(articleId)
          .all()
      ).results,
    ).toEqual(slugsBefore);
    expect(
      await env.DB.prepare("SELECT * FROM asset WHERE id = ?")
        .bind(asset.id)
        .first(),
    ).toEqual(assetBefore);
    expect(
      (
        await env.DB.prepare(
          "SELECT * FROM article_draft_asset_reference WHERE article_id = ? ORDER BY asset_id",
        )
          .bind(articleId)
          .all()
      ).results,
    ).toEqual(draftReferencesBefore);
    expect(
      (
        await env.DB.prepare(
          `SELECT publication_asset_reference.*
           FROM publication_asset_reference
           JOIN publication
             ON publication.id = publication_asset_reference.publication_id
           WHERE publication.article_id = ?
           ORDER BY publication_asset_reference.asset_id`,
        )
          .bind(articleId)
          .all()
      ).results,
    ).toEqual(publicationReferencesBefore);

    const publicMediaAfter = await SELF.fetch(publicArticle.cover.url);
    expect(publicMediaAfter.status).toBe(200);
    expect(publicMediaAfter.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(await publicMediaAfter.arrayBuffer()).toEqual(mediaBytes);
  }, 30_000);

  it("can publish a later immutable snapshot after withdrawal", async () => {
    const cookie = await initializeAndSignIn();
    const { id: articleId } = await createPublishedArticle(cookie, {
      slug: "before-withdrawal",
    });
    const firstPublic = await (
      await SELF.fetch("http://briefly.test/api/articles/before-withdrawal")
    ).json<{ publishedAt: string; updatedAt: string }>();
    const firstSnapshot = await env.DB.prepare(
      `SELECT * FROM publication
       WHERE article_id = ? AND publication_number = 1`,
    )
      .bind(articleId)
      .first<Record<string, unknown>>();
    expect(firstSnapshot).not.toBeNull();
    expect(
      (
        await SELF.fetch(
          `http://briefly.test/api/admin/articles/${articleId}/current-publication`,
          { method: "DELETE", headers: { cookie } },
        )
      ).status,
    ).toBe(200);

    const revised = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${articleId}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          version: 2,
          title: "Published again after withdrawal",
          slug: "after-withdrawal",
          summary: "A later immutable snapshot",
          tags: ["lifecycle", "restored"],
          byline: null,
          language: null,
          cover: null,
          document: textDocument("Later public body"),
        }),
      },
    );
    expect(revised.status).toBe(200);
    expect(await revised.json()).toMatchObject({
      currentPublicationId: null,
      draft: { version: 3, title: "Published again after withdrawal" },
    });

    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 5));
    const publishedAgain = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${articleId}/publications`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          draftVersion: 3,
          expectedCurrentPublicationId: null,
        }),
      },
    );

    expect(publishedAgain.status).toBe(201);
    const { article: laterPublic } = await publishedAgain.json<{
      article: {
        slug: string;
        title: string;
        publishedAt: string;
        updatedAt: string;
        html: string;
      };
    }>();
    expect(laterPublic).toMatchObject({
      slug: "after-withdrawal",
      title: "Published again after withdrawal",
      publishedAt: firstPublic.publishedAt,
      html: "<p>Later public body</p>",
    });
    expect(laterPublic.updatedAt).not.toBe(firstPublic.updatedAt);
    expect(
      await env.DB.prepare(
        `SELECT * FROM publication
         WHERE article_id = ? AND publication_number = 1`,
      )
        .bind(articleId)
        .first(),
    ).toEqual(firstSnapshot);

    const history = await env.DB.prepare(
      `SELECT id, publication_number, slug, published_at
       FROM publication
       WHERE article_id = ?
       ORDER BY publication_number`,
    )
      .bind(articleId)
      .all<{
        id: string;
        publication_number: number;
        slug: string;
        published_at: number;
      }>();
    expect(history.results).toMatchObject([
      { publication_number: 1, slug: "before-withdrawal" },
      { publication_number: 2, slug: "after-withdrawal" },
    ]);
    expect(
      await env.DB.prepare(
        "SELECT current_publication_id, published_at, updated_at FROM article WHERE id = ?",
      )
        .bind(articleId)
        .first(),
    ).toEqual({
      current_publication_id: history.results[1]?.id,
      published_at: history.results[0]?.published_at,
      updated_at: history.results[1]?.published_at,
    });

    const publicRead = await SELF.fetch(
      "http://briefly.test/api/articles/after-withdrawal",
    );
    expect(publicRead.status).toBe(200);
    expect(await publicRead.json()).toEqual(laterPublic);

    const formerLocator = await SELF.fetch(
      "http://briefly.test/api/articles/before-withdrawal",
      { redirect: "manual" },
    );
    expect(formerLocator.status).toBe(308);
    expect(formerLocator.headers.get("location")).toBe(
      "/api/articles/after-withdrawal",
    );

    expect(
      (
        await SELF.fetch(
          `http://briefly.test/api/admin/articles/${articleId}/current-publication`,
          { method: "DELETE", headers: { cookie } },
        )
      ).status,
    ).toBe(200);
    for (const slug of ["before-withdrawal", "after-withdrawal"]) {
      for (const method of ["GET", "HEAD"] as const) {
        const unavailable = await SELF.fetch(
          `http://briefly.test/api/articles/${slug}`,
          { method, redirect: "manual" },
        );
        expect(unavailable.status).toBe(404);
        expect(unavailable.headers.get("location")).toBeNull();
        expect(unavailable.headers.get("etag")).toBeNull();
        if (method === "GET") {
          expect(await unavailable.json()).toEqual({
            status: "error",
            code: "ARTICLE_NOT_FOUND",
          });
        } else {
          expect(await unavailable.text()).toBe("");
        }
      }

      const claimant = await SELF.fetch(
        "http://briefly.test/api/admin/articles",
        { method: "POST", headers: { cookie } },
      );
      expect(claimant.status).toBe(201);
      const { id: claimantId } = await claimant.json<{ id: string }>();
      const conflictingClaim = await SELF.fetch(
        `http://briefly.test/api/admin/articles/${claimantId}/draft`,
        {
          method: "PUT",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({
            version: 1,
            title: "Must not inherit a public locator",
            slug,
            summary: null,
            tags: [],
            byline: null,
            language: null,
            cover: null,
            document: textDocument("Conflicting claim"),
          }),
        },
      );
      expect(conflictingClaim.status).toBe(409);
      expect(await conflictingClaim.json()).toEqual({
        status: "error",
        code: "ARTICLE_SLUG_CONFLICT",
      });
    }
  }, 30_000);

  it("serves the Article editor route while client-side unpublish controls load", async () => {
    const cookie = await initializeAndSignIn();
    const article = await (
      await SELF.fetch("http://briefly.test/api/admin/articles", {
        method: "POST",
        headers: { cookie },
      })
    ).json<{ id: string }>();

    const response = await SELF.fetch(
      `http://briefly.test/admin/articles/${article.id}`,
      { headers: { cookie } },
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(html).toContain("Loading Article editor");
  }, 30_000);
});
