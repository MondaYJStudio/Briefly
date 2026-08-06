import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { uploadOnePixelPngAsset } from "./asset-fixture";

const administrator = {
  email: "administrator@example.com",
  password: "correct horse battery staple",
};

async function initializeAndSignIn(): Promise<string> {
  const initialization = await SELF.fetch(
    "http://briefly.test/api/initialize",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        setupSecret: env.SETUP_SECRET,
        ...administrator,
      }),
    },
  );
  expect(initialization.status).toBe(201);

  const signIn = await SELF.fetch(
    "http://briefly.test/api/auth/sign-in/email",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://briefly.test",
      },
      body: JSON.stringify(administrator),
    },
  );
  expect(signIn.status).toBe(200);
  const setCookie = signIn.headers.get("set-cookie");
  if (!setCookie) throw new Error("Expected a session cookie");
  return setCookie.split(";", 1)[0];
}

function textDocument(text: string) {
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

interface DraftPayload {
  version: number;
  title: string;
  slug: string | null;
  summary: string | null;
  tags: string[];
  byline: { name: string; url: string | null } | null;
  language: string | null;
  document: unknown;
  cover?: { assetId: string; alt: string };
}

interface PublicationReceipt<Article> {
  publicationId: string;
  draftVersion: number;
  article: Article;
}

async function createArticle(cookie: string): Promise<string> {
  const response = await SELF.fetch("http://briefly.test/api/admin/articles", {
    method: "POST",
    headers: { cookie },
  });
  expect(response.status).toBe(201);
  return (await response.json<{ id: string }>()).id;
}

function saveDraft(
  cookie: string,
  articleId: string,
  overrides: Partial<DraftPayload> = {},
): Promise<Response> {
  const payload: DraftPayload = {
    version: 1,
    title: "Publication candidate",
    slug: "publication-candidate",
    summary: null,
    tags: [],
    byline: null,
    language: null,
    document: textDocument("Substantive body"),
    ...overrides,
  };
  return SELF.fetch(
    `http://briefly.test/api/admin/articles/${articleId}/draft`,
    {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

function publish(
  cookie: string,
  articleId: string,
  draftVersion = 2,
  expectedCurrentPublicationId: string | null = null,
): Promise<Response> {
  return SELF.fetch(
    `http://briefly.test/api/admin/articles/${articleId}/publications`,
    {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ draftVersion, expectedCurrentPublicationId }),
    },
  );
}

describe("first immutable Publication", () => {
  beforeEach(async () => {
    const { results } = await env.DB.prepare(
      "SELECT object_key FROM asset",
    ).all<{ object_key: string }>();
    await Promise.all(
      results.map(({ object_key }) => env.MEDIA_BUCKET.delete(object_key)),
    );
    await env.DB.batch([
      env.DB.prepare("DROP TRIGGER IF EXISTS reject_publication_insert"),
      env.DB.prepare("UPDATE article SET current_publication_id = NULL"),
      env.DB.prepare("DELETE FROM publication"),
      env.DB.prepare("DELETE FROM article_draft"),
      env.DB.prepare("DELETE FROM article"),
      env.DB.prepare("DELETE FROM asset"),
      env.DB.prepare("DELETE FROM auth_session"),
      env.DB.prepare("DELETE FROM auth_account"),
      env.DB.prepare("DELETE FROM auth_user"),
      env.DB.prepare("DELETE FROM auth_rate_limit"),
    ]);
  });

  it("publishes a saved text Draft and makes its stored HTML immediately public", async () => {
    const cookie = await initializeAndSignIn();
    const articleId = await createArticle(cookie);
    const document = {
      documentSchemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Hello " },
              {
                type: "text",
                text: "immutable world",
                marks: [{ type: "bold" }],
              },
            ],
          },
        ],
      },
    };
    const saved = await saveDraft(cookie, articleId, {
      title: "First Publication",
      slug: "first-publication",
      tags: ["release", "immutable"],
      document,
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      draft: { version: 2, document },
    });

    const published = await publish(cookie, articleId);

    expect(published.status).toBe(201);
    expect(published.headers.get("cache-control")).toBe("no-store");
    const receipt = await published.json<
      PublicationReceipt<{
        id: string;
        slug: string;
        publishedAt: string;
        updatedAt: string;
        html: string;
      }>
    >();
    expect(receipt).toMatchObject({
      publicationId: expect.any(String),
      draftVersion: 2,
    });
    const publicArticle = receipt.article;
    expect(publicArticle).toMatchObject({
      id: articleId,
      slug: "first-publication",
      title: "First Publication",
      summary: null,
      tags: ["release", "immutable"],
      byline: { name: "Briefly", url: null },
      language: "en",
      cover: null,
      html: "<p>Hello <strong>immutable world</strong></p>",
    });
    expect(publicArticle.publishedAt).toBe(publicArticle.updatedAt);

    const firstAnonymousRead = await SELF.fetch(
      "http://briefly.test/api/articles/first-publication",
      {
        headers: {
          cookie: "better-auth.session_token=must-be-ignored",
          origin: "https://reader.example",
        },
      },
    );

    expect(firstAnonymousRead.status).toBe(200);
    expect(firstAnonymousRead.headers.get("access-control-allow-origin")).toBe(
      "*",
    );
    expect(firstAnonymousRead.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(firstAnonymousRead.headers.get("etag")).toMatch(/^"[^"]+"$/);
    expect(await firstAnonymousRead.json()).toEqual(publicArticle);

    const stored = await env.DB.prepare(
      `SELECT publication_number, title, slug, summary, tags, byline, language,
              cover, document_schema_version, document, renderer_version,
              html, published_at
       FROM publication
       WHERE id = ? AND article_id = ?`,
    )
      .bind(receipt.publicationId, articleId)
      .first<Record<string, unknown>>();
    expect(stored).toMatchObject({
      publication_number: 1,
      title: "First Publication",
      slug: "first-publication",
      summary: null,
      tags: JSON.stringify(["release", "immutable"]),
      byline: JSON.stringify({ name: "Briefly", url: null }),
      language: "en",
      cover: null,
      document_schema_version: 1,
      document: JSON.stringify(document),
      renderer_version: 3,
      html: "<p>Hello <strong>immutable world</strong></p>",
    });
    expect(stored?.published_at).toBeTypeOf("number");
  }, 20_000);

  it("rejects a stale Draft Version without creating any public state", async () => {
    const cookie = await initializeAndSignIn();
    const articleId = await createArticle(cookie);
    const saved = await saveDraft(cookie, articleId, {
      title: "Confirmed Draft",
      slug: "confirmed-draft",
      document: textDocument("Saved body"),
    });
    expect(saved.status).toBe(200);

    const stale = await publish(cookie, articleId, 1);

    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      status: "error",
      code: "PUBLICATION_CONFLICT",
    });
    expect(
      await env.DB.prepare("SELECT id FROM publication WHERE article_id = ?")
        .bind(articleId)
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT current_publication_id FROM article WHERE id = ?",
      )
        .bind(articleId)
        .first(),
    ).toEqual({ current_publication_id: null });
    expect(
      await env.DB.prepare(
        "SELECT was_published FROM article_slug WHERE slug_key = 'confirmed-draft'",
      ).first(),
    ).toEqual({ was_published: 0 });
    expect(
      (await SELF.fetch("http://briefly.test/api/articles/confirmed-draft"))
        .status,
    ).toBe(404);
  }, 20_000);

  it("publishes a valid cover-bearing Draft through public Asset delivery", async () => {
    const cookie = await initializeAndSignIn();
    const articleId = await createArticle(cookie);
    const coverAsset = await uploadOnePixelPngAsset(cookie, "cover.png");

    const saved = await saveDraft(cookie, articleId, {
      title: "Public cover",
      slug: "public-cover",
      cover: { assetId: coverAsset.id, alt: "Published cover" },
      document: textDocument("Text body"),
    });
    expect(saved.status).toBe(200);

    const published = await publish(cookie, articleId);

    expect(published.status).toBe(201);
    expect(await published.json()).toMatchObject({
      draftVersion: 2,
      article: {
        cover: {
          url: expect.stringMatching(/^http:\/\/briefly\.test\/media\//u),
          width: 1,
          height: 1,
          alt: "Published cover",
        },
      },
    });
    expect(
      await env.DB.prepare("SELECT id FROM publication WHERE article_id = ?")
        .bind(articleId)
        .first(),
    ).not.toBeNull();
  }, 20_000);

  it.each([
    {
      name: "unsupported schema version",
      document: {
        documentSchemaVersion: 999,
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Future body" }],
            },
          ],
        },
      },
    },
    {
      name: "unknown node",
      document: {
        documentSchemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "rawHtml",
              content: [{ type: "text", text: "<script>unsafe</script>" }],
            },
          ],
        },
      },
    },
    {
      name: "figure",
      document: {
        documentSchemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Text before media" }],
            },
            {
              type: "figure",
              attrs: {
                assetId: "private-asset",
                alt: "Unavailable figure",
                decorative: false,
                caption: null,
              },
            },
          ],
        },
      },
    },
  ])(
    "rejects a $name before it can become a saved Publication candidate",
    async ({ document }) => {
      const cookie = await initializeAndSignIn();
      const articleId = await createArticle(cookie);
      const saved = await saveDraft(cookie, articleId, {
        title: "Unsupported content",
        slug: "unsupported-content",
        document,
      });
      expect(saved.status).toBe(400);
      expect(await saved.json()).toMatchObject({
        status: "error",
        code: "ARTICLE_DRAFT_INVALID",
        issues: expect.any(Array),
      });
      expect(
        await env.DB.prepare(
          "SELECT id, html FROM publication WHERE article_id = ?",
        )
          .bind(articleId)
          .first(),
      ).toBeNull();
      expect(
        await (
          await SELF.fetch(
            `http://briefly.test/api/admin/articles/${articleId}`,
            { headers: { cookie } },
          )
        ).json(),
      ).toMatchObject({
        currentPublicationId: null,
        draft: { version: 1, title: "", slug: null },
      });
    },
    20_000,
  );

  it("serves only the stored artifact with cookie-independent CORS, HEAD, and conditional semantics", async () => {
    const cookie = await initializeAndSignIn();
    const articleId = await createArticle(cookie);
    const document = {
      documentSchemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Stored public body" }],
          },
        ],
      },
    };
    expect(
      (
        await saveDraft(cookie, articleId, {
          title: "Stored public title",
          slug: "stored-publication",
          summary: "Authored summary",
          tags: ["public"],
          byline: { name: "Public Byline", url: null },
          language: "zh-Hans",
          document,
        })
      ).status,
    ).toBe(200);
    const published = await publish(cookie, articleId);
    expect(published.status).toBe(201);
    const expected = (
      await published.json<PublicationReceipt<Record<string, unknown>>>()
    ).article;

    expect(
      (
        await saveDraft(cookie, articleId, {
          version: 2,
          title: "Private revised title",
          slug: "private-revision",
          summary: "Private revised summary",
          tags: ["private"],
          document: textDocument("Private revised body"),
        })
      ).status,
    ).toBe(200);
    await env.DB.prepare(
      "UPDATE publication SET document = ?, renderer_version = 999 WHERE article_id = ?",
    )
      .bind(
        JSON.stringify({
          documentSchemaVersion: 999,
          doc: { type: "private-source-must-not-be-rendered" },
        }),
        articleId,
      )
      .run();

    const anonymous = await SELF.fetch(
      "http://briefly.test/api/articles/stored-publication",
      { headers: { origin: "https://reader-one.example" } },
    );
    const authenticated = await SELF.fetch(
      "http://briefly.test/api/articles/stored-publication",
      {
        headers: {
          cookie,
          origin: "https://reader-two.example",
        },
      },
    );
    expect(anonymous.status).toBe(200);
    expect(authenticated.status).toBe(200);
    expect(await anonymous.clone().json()).toEqual(expected);
    expect(await authenticated.clone().json()).toEqual(expected);
    expect(Object.keys(expected).sort()).toEqual(
      [
        "byline",
        "cover",
        "html",
        "id",
        "language",
        "publishedAt",
        "slug",
        "summary",
        "tags",
        "title",
        "updatedAt",
      ].sort(),
    );
    expect(JSON.stringify(expected)).not.toContain("Private revised");
    for (const response of [anonymous, authenticated]) {
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("cache-control")).toBe(
        "public, max-age=0, must-revalidate",
      );
    }
    expect(authenticated.headers.get("etag")).toBe(
      anonymous.headers.get("etag"),
    );

    const etag = anonymous.headers.get("etag");
    if (!etag) throw new Error("Expected an ETag");
    const conditional = await SELF.fetch(
      "http://briefly.test/api/articles/stored-publication",
      {
        headers: {
          "if-none-match": `W/${etag}`,
          origin: "https://reader.example",
        },
      },
    );
    expect(conditional.status).toBe(304);
    expect(await conditional.text()).toBe("");
    expect(conditional.headers.get("etag")).toBe(etag);
    expect(conditional.headers.get("access-control-allow-origin")).toBe("*");

    const head = await SELF.fetch(
      "http://briefly.test/api/articles/stored-publication",
      { method: "HEAD", headers: { origin: "https://reader.example" } },
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("etag")).toBe(etag);
    expect(head.headers.get("access-control-allow-origin")).toBe("*");

    for (const slug of ["private-revision", "unknown-publication"]) {
      const missing = await SELF.fetch(
        `http://briefly.test/api/articles/${slug}`,
        { headers: { origin: "https://reader.example" } },
      );
      expect(missing.status).toBe(404);
      expect(missing.headers.get("access-control-allow-origin")).toBe("*");
      expect(await missing.json()).toEqual({
        status: "error",
        code: "ARTICLE_NOT_FOUND",
      });
    }
  }, 20_000);

  it("serves the Article editor route while client-side publish controls load", async () => {
    const cookie = await initializeAndSignIn();
    const articleId = await createArticle(cookie);

    const response = await SELF.fetch(
      `http://briefly.test/admin/articles/${articleId}`,
      { headers: { cookie } },
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(html).toContain("Loading Article editor");
  }, 20_000);

  it("requires an Administrator session for the publish command", async () => {
    const articleId = "00000000-0000-4000-8000-000000000000";

    const response = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${articleId}/publications`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          draftVersion: 1,
          expectedCurrentPublicationId: null,
        }),
      },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "error",
      code: "AUTHENTICATION_REQUIRED",
    });
  });

  it("republishes a saved revision while preserving the first snapshot and first-published ordering", async () => {
    const cookie = await initializeAndSignIn();
    const articleId = await createArticle(cookie);
    expect(
      (
        await saveDraft(cookie, articleId, {
          title: "Original public title",
          slug: "original-publication",
          summary: "Original public summary",
          tags: ["original"],
          document: textDocument("Original public body"),
        })
      ).status,
    ).toBe(200);
    const firstPublished = await publish(cookie, articleId);
    expect(firstPublished.status).toBe(201);
    const firstReceipt = await firstPublished.json<
      PublicationReceipt<{
        publishedAt: string;
        updatedAt: string;
      }>
    >();
    let firstPublicArticle = firstReceipt.article;

    const laterArticleId = await createArticle(cookie);
    expect(
      (
        await saveDraft(cookie, laterArticleId, {
          title: "Later first publication",
          slug: "later-first-publication",
          document: textDocument("Later public body"),
        })
      ).status,
    ).toBe(200);
    const laterPublished = await publish(cookie, laterArticleId);
    expect(laterPublished.status).toBe(201);
    const laterPublicArticle = (
      await laterPublished.json<
        PublicationReceipt<{
          id: string;
          publishedAt: string;
        }>
      >()
    ).article;

    const revised = await saveDraft(cookie, articleId, {
      version: 2,
      title: "Revised public title",
      slug: "revised-publication",
      summary: "Revised public summary",
      tags: ["revised"],
      document: textDocument("Revised public body"),
    });
    expect(revised.status).toBe(200);

    const privateRevision = await SELF.fetch(
      "http://briefly.test/api/articles/original-publication",
    );
    expect(privateRevision.status).toBe(200);
    expect(await privateRevision.json()).toMatchObject({
      title: "Original public title",
      html: "<p>Original public body</p>",
    });
    const privateRevisionList = await SELF.fetch(
      "http://briefly.test/api/articles",
    );
    expect(privateRevisionList.status).toBe(200);
    expect(
      (
        await privateRevisionList.json<{
          items: Array<Record<string, unknown>>;
        }>()
      ).items.find((item) => item.id === articleId),
    ).toMatchObject({
      slug: "original-publication",
      title: "Original public title",
      summary: "Original public summary",
      tags: ["original"],
    });

    const stale = await publish(
      cookie,
      articleId,
      2,
      firstReceipt.publicationId,
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      status: "error",
      code: "PUBLICATION_CONFLICT",
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM publication WHERE article_id = ?",
      )
        .bind(articleId)
        .first(),
    ).toEqual({ count: 1 });

    const previousPublicationTime = Date.now() + 60_000;
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE publication SET published_at = ? WHERE id = ?",
      ).bind(previousPublicationTime, firstReceipt.publicationId),
      env.DB.prepare("UPDATE article SET published_at = ? WHERE id = ?").bind(
        previousPublicationTime,
        articleId,
      ),
    ]);
    const previousCurrent = await SELF.fetch(
      "http://briefly.test/api/articles/original-publication",
    );
    expect(previousCurrent.status).toBe(200);
    const previousCurrentArticle = await previousCurrent.json<{
      publishedAt: string;
      updatedAt: string;
    }>();
    expect(Date.parse(previousCurrentArticle.updatedAt)).toBe(
      previousPublicationTime,
    );
    firstPublicArticle = previousCurrentArticle;
    const firstSnapshot = await env.DB.prepare(
      `SELECT id, publication_number, title, slug, summary, tags, byline,
              language, cover, document_schema_version, document,
              renderer_version, provider_facts, html, published_at, created_at
       FROM publication
       WHERE article_id = ? AND publication_number = 1`,
    )
      .bind(articleId)
      .first<Record<string, unknown>>();
    expect(firstSnapshot).not.toBeNull();

    const republished = await publish(
      cookie,
      articleId,
      3,
      firstReceipt.publicationId,
    );

    expect(republished.status).toBe(201);
    const republishedReceipt = await republished.json<
      PublicationReceipt<{
        id: string;
        slug: string;
        title: string;
        summary: string | null;
        tags: string[];
        publishedAt: string;
        updatedAt: string;
        html: string;
      }>
    >();
    expect(republishedReceipt.draftVersion).toBe(3);
    const republishedArticle = republishedReceipt.article;
    expect(republishedArticle).toMatchObject({
      id: articleId,
      slug: "revised-publication",
      title: "Revised public title",
      summary: "Revised public summary",
      tags: ["revised"],
      publishedAt: firstPublicArticle.publishedAt,
      html: "<p>Revised public body</p>",
    });
    expect(Date.parse(republishedArticle.updatedAt)).toBeGreaterThan(
      Date.parse(previousCurrentArticle.updatedAt),
    );

    const firstSnapshotAfterRepublish = await env.DB.prepare(
      `SELECT id, publication_number, title, slug, summary, tags, byline,
              language, cover, document_schema_version, document,
              renderer_version, provider_facts, html, published_at, created_at
       FROM publication
       WHERE article_id = ? AND publication_number = 1`,
    )
      .bind(articleId)
      .first<Record<string, unknown>>();
    expect(firstSnapshotAfterRepublish).toEqual(firstSnapshot);

    const history = await env.DB.prepare(
      `SELECT id, publication_number, title, slug, document, html, published_at
       FROM publication
       WHERE article_id = ?
       ORDER BY publication_number`,
    )
      .bind(articleId)
      .all<{
        id: string;
        publication_number: number;
        title: string;
        slug: string;
        document: string;
        html: string;
        published_at: number;
      }>();
    expect(history.results).toMatchObject([
      {
        publication_number: 1,
        title: "Original public title",
        slug: "original-publication",
        html: "<p>Original public body</p>",
      },
      {
        publication_number: 2,
        title: "Revised public title",
        slug: "revised-publication",
        html: "<p>Revised public body</p>",
      },
    ]);

    const current = await env.DB.prepare(
      "SELECT current_publication_id, published_at, updated_at FROM article WHERE id = ?",
    )
      .bind(articleId)
      .first<{
        current_publication_id: string;
        published_at: number;
        updated_at: number;
      }>();
    expect(current).toEqual({
      current_publication_id: republishedReceipt.publicationId,
      published_at: history.results[0]?.published_at,
      updated_at: history.results[1]?.published_at,
    });
    expect(history.results[1]?.id).toBe(republishedReceipt.publicationId);

    const visibleRevision = await SELF.fetch(
      "http://briefly.test/api/articles/revised-publication",
    );
    expect(visibleRevision.status).toBe(200);
    expect(await visibleRevision.json()).toEqual(republishedArticle);

    for (const method of ["GET", "HEAD"] as const) {
      const formerLocator = await SELF.fetch(
        "http://briefly.test/api/articles/original-publication",
        {
          method,
          redirect: "manual",
          headers: { origin: "https://reader.example" },
        },
      );
      expect(formerLocator.status).toBe(308);
      expect(formerLocator.headers.get("location")).toBe(
        "/api/articles/revised-publication",
      );
      expect(formerLocator.headers.get("access-control-allow-origin")).toBe(
        "*",
      );
      expect(formerLocator.headers.get("cache-control")).toBe(
        "public, max-age=0, must-revalidate",
      );
      expect(await formerLocator.text()).toBe("");
    }

    const list = await SELF.fetch("http://briefly.test/api/articles");
    expect(list.status).toBe(200);
    const expectedOrder = [
      { id: articleId, publishedAt: firstPublicArticle.publishedAt },
      {
        id: laterArticleId,
        publishedAt: laterPublicArticle.publishedAt,
      },
    ]
      .sort(
        (left, right) =>
          right.publishedAt.localeCompare(left.publishedAt) ||
          left.id.localeCompare(right.id),
      )
      .map(({ id }) => id);
    expect(
      (await list.json<{ items: Array<{ id: string }> }>()).items.map(
        ({ id }) => id,
      ),
    ).toEqual(expectedOrder);
  }, 20_000);

  it("redirects normalization-equivalent former locators directly to the exact current canonical slug", async () => {
    const cookie = await initializeAndSignIn();
    const articleId = await createArticle(cookie);
    expect(
      (
        await saveDraft(cookie, articleId, {
          title: "First canonical spelling",
          slug: "Café",
          document: textDocument("First canonical body"),
        })
      ).status,
    ).toBe(200);
    const firstPublished = await publish(cookie, articleId);
    expect(firstPublished.status).toBe(201);
    const firstReceipt = await firstPublished.json<{
      publicationId: string;
    }>();

    expect(
      (
        await saveDraft(cookie, articleId, {
          version: 2,
          title: "Current canonical spelling",
          slug: "CAFÉ",
          document: textDocument("Current canonical body"),
        })
      ).status,
    ).toBe(200);
    expect(
      (await publish(cookie, articleId, 3, firstReceipt.publicationId)).status,
    ).toBe(201);

    for (const formerPath of ["Caf%C3%A9", "CAFE%CC%81"]) {
      const redirected = await SELF.fetch(
        `http://briefly.test/api/articles/${formerPath}`,
        {
          redirect: "manual",
          headers: { "if-none-match": "*" },
        },
      );
      expect(redirected.status).toBe(308);
      expect(redirected.headers.get("location")).toBe(
        "/api/articles/CAF%C3%89",
      );
      expect(redirected.headers.get("etag")).toBeNull();
    }

    const canonical = await SELF.fetch(
      "http://briefly.test/api/articles/CAF%C3%89",
    );
    expect(canonical.status).toBe(200);
    expect(await canonical.json()).toMatchObject({
      id: articleId,
      slug: "CAFÉ",
      title: "Current canonical spelling",
      html: "<p>Current canonical body</p>",
    });
    expect(
      await env.DB.prepare(
        `SELECT slug_key, article_id, was_published
         FROM article_slug
         WHERE article_id = ?`,
      )
        .bind(articleId)
        .all(),
    ).toMatchObject({
      results: [{ slug_key: "café", article_id: articleId, was_published: 1 }],
    });
  }, 20_000);
});
