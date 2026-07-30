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
): Promise<Response> {
  return SELF.fetch(
    `http://briefly.test/api/admin/articles/${articleId}/publications`,
    {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ draftVersion }),
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
      env.DB.prepare(
        "UPDATE installation SET state = 'uninitialized', initialized_at = NULL WHERE id = 1",
      ),
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
    const publicArticle = await published.json<{
      id: string;
      slug: string;
      publishedAt: string;
      updatedAt: string;
      html: string;
    }>();
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
       WHERE article_id = ?`,
    )
      .bind(articleId)
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
      renderer_version: 2,
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
      code: "ARTICLE_DRAFT_VERSION_CONFLICT",
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

  it.each([
    {
      name: "missing title",
      title: "",
      slug: "missing-title",
      text: "Substantive body",
      code: "TITLE_REQUIRED",
    },
    {
      name: "missing slug",
      title: "Missing slug",
      slug: null,
      text: "Substantive body",
      code: "SLUG_REQUIRED",
    },
    {
      name: "non-substantive body",
      title: "Whitespace body",
      slug: "whitespace-body",
      text: "  \n  ",
      code: "SUBSTANTIVE_BODY_REQUIRED",
    },
  ])(
    "rejects $name while preserving the saved Draft and private state",
    async ({ title, slug, text, code }) => {
      const cookie = await initializeAndSignIn();
      const articleId = await createArticle(cookie);
      const saved = await saveDraft(cookie, articleId, {
        title,
        slug,
        document: textDocument(text),
      });
      expect(saved.status).toBe(200);

      const rejected = await publish(cookie, articleId);

      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toMatchObject({
        status: "error",
        code: "PUBLICATION_INVALID",
        issues: [expect.objectContaining({ code })],
      });
      expect(
        await env.DB.prepare("SELECT id FROM publication WHERE article_id = ?")
          .bind(articleId)
          .first(),
      ).toBeNull();
      const preserved = await (
        await SELF.fetch(
          `http://briefly.test/api/admin/articles/${articleId}`,
          { headers: { cookie } },
        )
      ).json<{
        currentPublicationId: string | null;
        draft: { version: number };
      }>();
      expect(preserved).toMatchObject({
        currentPublicationId: null,
        draft: { version: 2 },
      });
    },
    20_000,
  );

  it("cleanly rejects publishing a valid cover-bearing Draft until public Asset delivery lands", async () => {
    const cookie = await initializeAndSignIn();
    const articleId = await createArticle(cookie);
    const coverAsset = await uploadOnePixelPngAsset(cookie, "cover.png");

    const saved = await saveDraft(cookie, articleId, {
      title: "No covers yet",
      slug: "no-covers-yet",
      cover: { assetId: coverAsset.id, alt: "Not public yet" },
      document: textDocument("Text body"),
    });
    expect(saved.status).toBe(200);

    const rejected = await publish(cookie, articleId);

    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({
      status: "error",
      code: "PUBLICATION_INVALID",
      issues: [
        expect.objectContaining({
          path: "cover",
          message: expect.stringContaining("cover"),
        }),
      ],
    });
    const preserved = await (
      await SELF.fetch(`http://briefly.test/api/admin/articles/${articleId}`, {
        headers: { cookie },
      })
    ).json<{ draft: { version: number; title: string } }>();
    expect(preserved).toMatchObject({
      currentPublicationId: null,
      draft: { version: 2, title: "No covers yet" },
    });
    expect(
      await env.DB.prepare("SELECT id FROM publication WHERE article_id = ?")
        .bind(articleId)
        .first(),
    ).toBeNull();
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

  it("rejects an invalid persisted Draft without creating partial public state", async () => {
    const cookie = await initializeAndSignIn();
    const articleId = await createArticle(cookie);
    const saved = await saveDraft(cookie, articleId, {
      title: "Persisted invalid Draft",
      slug: "persisted-invalid-draft",
    });
    expect(saved.status).toBe(200);
    await env.DB.prepare(
      "UPDATE article_draft SET document = ? WHERE article_id = ?",
    )
      .bind(
        JSON.stringify({
          documentSchemaVersion: 999,
          doc: { type: "doc", content: [{ type: "future-node" }] },
        }),
        articleId,
      )
      .run();

    const rejected = await publish(cookie, articleId);

    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({
      status: "error",
      code: "PUBLICATION_INVALID",
      issues: [
        {
          code: "INVALID_DOCUMENT",
          path: "document",
          message: "The saved Draft document is invalid or unsupported",
        },
      ],
    });
    expect(
      await env.DB.prepare("SELECT id FROM publication WHERE article_id = ?")
        .bind(articleId)
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT current_publication_id, published_at FROM article WHERE id = ?",
      )
        .bind(articleId)
        .first(),
    ).toEqual({ current_publication_id: null, published_at: null });
    expect(
      await env.DB.prepare(
        "SELECT was_published FROM article_slug WHERE slug_key = 'persisted-invalid-draft'",
      ).first(),
    ).toEqual({ was_published: 0 });
  }, 20_000);

  it("rolls back the slug claim and Current Publication when D1 rejects creation", async () => {
    const cookie = await initializeAndSignIn();
    const articleId = await createArticle(cookie);
    const saved = await saveDraft(cookie, articleId, {
      title: "Atomic publication",
      slug: "atomic-publication",
      document: textDocument("Atomic body"),
    });
    expect(saved.status).toBe(200);
    await env.DB.prepare(
      `CREATE TRIGGER reject_publication_insert
       BEFORE INSERT ON publication
       BEGIN
         SELECT RAISE(ABORT, 'forced publication failure');
       END`,
    ).run();

    let failed: Response;
    try {
      failed = await publish(cookie, articleId);
    } finally {
      await env.DB.prepare(
        "DROP TRIGGER IF EXISTS reject_publication_insert",
      ).run();
    }

    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({
      status: "error",
      code: "INTERNAL_ERROR",
    });
    expect(
      await env.DB.prepare("SELECT id FROM publication WHERE article_id = ?")
        .bind(articleId)
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT current_publication_id, published_at FROM article WHERE id = ?",
      )
        .bind(articleId)
        .first(),
    ).toEqual({ current_publication_id: null, published_at: null });
    expect(
      await env.DB.prepare(
        "SELECT was_published FROM article_slug WHERE slug_key = 'atomic-publication'",
      ).first(),
    ).toEqual({ was_published: 0 });
  }, 20_000);

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
    const expected = await published.json<Record<string, unknown>>();

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

  it("presents a deliberate publish action for a server-confirmed Draft", async () => {
    const cookie = await initializeAndSignIn();

    const response = await SELF.fetch("http://briefly.test/admin", {
      headers: { cookie },
    });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Publish saved Draft");
    expect(html).toContain(
      "Publishing is available only for a server-confirmed Draft Version",
    );
    expect(html).toContain("requires deliberate confirmation");
  }, 20_000);

  it("requires an Administrator session for the publish command", async () => {
    const articleId = "00000000-0000-4000-8000-000000000000";

    const response = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${articleId}/publications`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftVersion: 1 }),
      },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "error",
      code: "AUTHENTICATION_REQUIRED",
    });
  });

  it("does not turn the first-publication tracer into implicit republishing", async () => {
    const cookie = await initializeAndSignIn();
    const articleId = await createArticle(cookie);
    expect(
      (
        await saveDraft(cookie, articleId, {
          title: "First means first",
          slug: "first-means-first",
          document: textDocument("First body"),
        })
      ).status,
    ).toBe(200);
    const publishRequest = () => publish(cookie, articleId);
    expect((await publishRequest()).status).toBe(201);

    const repeated = await publishRequest();

    expect(repeated.status).toBe(409);
    expect(await repeated.json()).toEqual({
      status: "error",
      code: "ARTICLE_ALREADY_PUBLISHED",
    });
    const publications = await env.DB.prepare(
      "SELECT id, publication_number FROM publication WHERE article_id = ?",
    )
      .bind(articleId)
      .all();
    expect(publications.results).toHaveLength(1);
    expect(publications.results[0]).toMatchObject({ publication_number: 1 });
    expect(
      await env.DB.prepare(
        "SELECT current_publication_id FROM article WHERE id = ?",
      )
        .bind(articleId)
        .first(),
    ).toEqual({ current_publication_id: publications.results[0]?.id });
  }, 20_000);
});
