import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

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

describe("Article Draft administration", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM article_draft"),
      env.DB.prepare("DELETE FROM article"),
      env.DB.prepare("DELETE FROM auth_session"),
      env.DB.prepare("DELETE FROM auth_account"),
      env.DB.prepare("DELETE FROM auth_user"),
      env.DB.prepare("DELETE FROM auth_rate_limit"),
      env.DB.prepare(
        "UPDATE installation SET state = 'uninitialized', initialized_at = NULL WHERE id = 1",
      ),
    ]);
  });

  it("creates an incomplete Article with an opaque identity and valid initial Draft", async () => {
    const cookie = await initializeAndSignIn();

    const response = await SELF.fetch(
      "http://briefly.test/api/admin/articles",
      { method: "POST", headers: { cookie } },
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const article = await response.json<{
      id: string;
      currentPublicationId: string | null;
      draft: unknown;
    }>();
    expect(article.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(article).toMatchObject({
      currentPublicationId: null,
      draft: {
        version: 1,
        title: "",
        slug: null,
        summary: null,
        tags: [],
        byline: null,
        language: null,
        document: {
          documentSchemaVersion: 1,
          doc: { type: "doc", content: [{ type: "paragraph" }] },
        },
      },
    });
    expect(JSON.stringify(article)).not.toContain(administrator.email);
  }, 15_000);

  it("saves normalized metadata, preserves null summary, then lists and loads the Draft", async () => {
    const cookie = await initializeAndSignIn();
    const created = await (
      await SELF.fetch("http://briefly.test/api/admin/articles", {
        method: "POST",
        headers: { cookie },
      })
    ).json<{ id: string }>();

    const update = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${created.id}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          title: "  第一篇文章  ",
          slug: " cafe\u0301-札记 ",
          summary: null,
          tags: [" TypeScript ", "typescript", "Cloud   Workers", "云 计算"],
          byline: { name: " Guest Writer ", url: "https://example.com/me" },
          language: "ZH-hans",
        }),
      },
    );

    expect(update.status).toBe(200);
    const expected = expect.objectContaining({
      id: created.id,
      draft: expect.objectContaining({
        version: 2,
        title: "第一篇文章",
        slug: "café-札记",
        summary: null,
        tags: ["typescript", "cloud workers", "云 计算"],
        byline: {
          name: "Guest Writer",
          url: "https://example.com/me",
        },
        language: "zh-Hans",
      }),
    });
    expect(await update.json()).toEqual(expected);

    const loaded = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${created.id}`,
      { headers: { cookie } },
    );
    expect(loaded.status).toBe(200);
    expect(await loaded.json()).toEqual(expected);

    const listed = await SELF.fetch("http://briefly.test/api/admin/articles", {
      headers: { cookie },
    });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ articles: [expected] });
  }, 15_000);

  it("persists a supported text-rich document with metadata in one versioned save", async () => {
    const cookie = await initializeAndSignIn();
    const created = await (
      await SELF.fetch("http://briefly.test/api/admin/articles", {
        method: "POST",
        headers: { cookie },
      })
    ).json<{ id: string }>();
    const document = {
      documentSchemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "A durable Draft" }],
          },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Rich ", marks: [{ type: "bold" }] },
              {
                type: "text",
                text: "content",
                marks: [
                  {
                    type: "link",
                    attrs: { href: "https://example.com/reference" },
                  },
                ],
              },
              { type: "hardBreak" },
              { type: "text", text: "survives." },
            ],
          },
          {
            type: "codeBlock",
            attrs: { language: "typescript" },
            content: [{ type: "text", text: "const durable = true;" }],
          },
          {
            type: "heading",
            attrs: { level: 3 },
            content: [{ type: "text", text: "Lists" }],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: "Bullet",
                        marks: [{ type: "italic" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: "orderedList",
            attrs: { start: 1 },
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: "Ordered",
                        marks: [{ type: "strike" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: "heading",
            attrs: { level: 4 },
            content: [{ type: "text", text: "Quote" }],
          },
          {
            type: "blockquote",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Inline code",
                    marks: [{ type: "code" }],
                  },
                ],
              },
            ],
          },
          { type: "horizontalRule" },
        ],
      },
    };

    const response = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${created.id}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          title: "Saved together",
          slug: null,
          summary: null,
          tags: [],
          byline: null,
          language: null,
          document,
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      draft: { version: 2, title: "Saved together", document },
    });
    const loaded = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${created.id}`,
      { headers: { cookie } },
    );
    expect(await loaded.json()).toMatchObject({
      draft: { version: 2, title: "Saved together", document },
    });
  }, 15_000);

  it.each([
    [
      "raw HTML",
      {
        documentSchemaVersion: 1,
        doc: { type: "doc", content: [{ type: "html", content: [] }] },
      },
    ],
    [
      "an h1 body heading",
      {
        documentSchemaVersion: 1,
        doc: {
          type: "doc",
          content: [{ type: "heading", attrs: { level: 1 } }],
        },
      },
    ],
    [
      "arbitrary iframe data",
      {
        documentSchemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "iframe",
              attrs: { src: "https://attacker.example/embed" },
            },
          ],
        },
      },
    ],
    [
      "an unknown node",
      {
        documentSchemaVersion: 1,
        doc: { type: "doc", content: [{ type: "table" }] },
      },
    ],
    [
      "an executable link",
      {
        documentSchemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "unsafe",
                  marks: [
                    { type: "link", attrs: { href: "javascript:alert(1)" } },
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
    [
      "an unsupported schema version",
      {
        documentSchemaVersion: 2,
        doc: { type: "doc", content: [{ type: "paragraph" }] },
      },
    ],
  ])(
    "rejects %s without advancing the saved Draft",
    async (_description, document) => {
      const cookie = await initializeAndSignIn();
      const created = await (
        await SELF.fetch("http://briefly.test/api/admin/articles", {
          method: "POST",
          headers: { cookie },
        })
      ).json<{ id: string }>();

      const rejected = await SELF.fetch(
        `http://briefly.test/api/admin/articles/${created.id}/draft`,
        {
          method: "PUT",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({
            version: 1,
            title: "Must not persist",
            slug: null,
            summary: null,
            tags: [],
            byline: null,
            language: null,
            document,
          }),
        },
      );

      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toMatchObject({
        status: "error",
        code: "ARTICLE_DRAFT_INVALID",
        issues: [
          expect.objectContaining({
            path: expect.stringMatching(/^document\./),
          }),
        ],
      });
      const preserved = await SELF.fetch(
        `http://briefly.test/api/admin/articles/${created.id}`,
        { headers: { cookie } },
      );
      expect(await preserved.json()).toMatchObject({
        draft: {
          version: 1,
          title: "",
          document: {
            documentSchemaVersion: 1,
            doc: { type: "doc", content: [{ type: "paragraph" }] },
          },
        },
      });
    },
    15_000,
  );

  it("rejects a stale Draft Version without mutating the newer saved Draft", async () => {
    const cookie = await initializeAndSignIn();
    const created = await (
      await SELF.fetch("http://briefly.test/api/admin/articles", {
        method: "POST",
        headers: { cookie },
      })
    ).json<{ id: string }>();
    const firstTab = {
      version: 1,
      title: "Saved from the first tab",
      slug: "first-tab",
      summary: "Durable",
      tags: ["saved"],
      byline: null,
      language: null,
      document: {
        documentSchemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Saved from the first tab" }],
            },
          ],
        },
      },
    };
    expect(
      (
        await SELF.fetch(
          `http://briefly.test/api/admin/articles/${created.id}/draft`,
          {
            method: "PUT",
            headers: { cookie, "content-type": "application/json" },
            body: JSON.stringify(firstTab),
          },
        )
      ).status,
    ).toBe(200);

    const stale = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${created.id}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          ...firstTab,
          title: "Silently overwritten",
          slug: "stale-tab",
          document: {
            documentSchemaVersion: 1,
            doc: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Stale local body" }],
                },
              ],
            },
          },
        }),
      },
    );

    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      status: "error",
      code: "ARTICLE_DRAFT_VERSION_CONFLICT",
    });
    const preserved = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${created.id}`,
      { headers: { cookie } },
    );
    expect(await preserved.json()).toMatchObject({
      draft: {
        version: 2,
        title: "Saved from the first tab",
        slug: "first-tab",
        summary: "Durable",
        tags: ["saved"],
        document: firstTab.document,
      },
    });
    expect(
      await env.DB.prepare(
        "SELECT article_id FROM article_slug WHERE slug_key = 'stale-tab'",
      ).first(),
    ).toBeNull();
  }, 15_000);

  it("rejects Unicode-equivalent slug collisions and preserves both Drafts", async () => {
    const cookie = await initializeAndSignIn();
    const create = () =>
      SELF.fetch("http://briefly.test/api/admin/articles", {
        method: "POST",
        headers: { cookie },
      }).then((response) => response.json<{ id: string }>());
    const first = await create();
    const second = await create();
    const metadata = {
      version: 1,
      title: "Unicode",
      summary: null,
      tags: [],
      byline: null,
      language: null,
    };
    expect(
      (
        await SELF.fetch(
          `http://briefly.test/api/admin/articles/${first.id}/draft`,
          {
            method: "PUT",
            headers: { cookie, "content-type": "application/json" },
            body: JSON.stringify({ ...metadata, slug: "café" }),
          },
        )
      ).status,
    ).toBe(200);

    const collision = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${second.id}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ ...metadata, slug: "CAFE\u0301" }),
      },
    );

    expect(collision.status).toBe(409);
    expect(await collision.json()).toEqual({
      status: "error",
      code: "ARTICLE_SLUG_CONFLICT",
    });
    const secondDraft = await (
      await SELF.fetch(`http://briefly.test/api/admin/articles/${second.id}`, {
        headers: { cookie },
      })
    ).json<{ draft: { version: number; slug: string | null } }>();
    expect(secondDraft.draft).toMatchObject({ version: 1, slug: null });
  }, 15_000);

  it("reserves the Current Publication locator and constrains its Article reference", async () => {
    const cookie = await initializeAndSignIn();
    const create = () =>
      SELF.fetch("http://briefly.test/api/admin/articles", {
        method: "POST",
        headers: { cookie },
      }).then((response) => response.json<{ id: string }>());
    const first = await create();
    const second = await create();
    const metadata = {
      title: "Publication locator",
      summary: null,
      tags: [],
      byline: null,
      language: null,
    };
    expect(
      (
        await SELF.fetch(
          `http://briefly.test/api/admin/articles/${first.id}/draft`,
          {
            method: "PUT",
            headers: { cookie, "content-type": "application/json" },
            body: JSON.stringify({
              ...metadata,
              version: 1,
              slug: "public-locator",
            }),
          },
        )
      ).status,
    ).toBe(200);
    const publicationId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE article_slug SET was_published = 1
         WHERE slug_key = 'public-locator' AND article_id = ?`,
      ).bind(first.id),
      env.DB.prepare(
        `INSERT INTO publication (id, article_id, slug, slug_key, created_at)
         VALUES (?, ?, 'public-locator', 'public-locator', ?)`,
      ).bind(publicationId, first.id, Date.now()),
      env.DB.prepare(
        "UPDATE article SET current_publication_id = ? WHERE id = ?",
      ).bind(publicationId, first.id),
    ]);
    const repeatedPublicationId = crypto.randomUUID();
    await expect(
      env.DB.prepare(
        `INSERT INTO publication (id, article_id, slug, slug_key, created_at)
         VALUES (?, ?, 'public-locator', 'public-locator', ?)`,
      )
        .bind(repeatedPublicationId, first.id, Date.now())
        .run(),
    ).resolves.toBeDefined();
    expect(
      (
        await SELF.fetch(
          `http://briefly.test/api/admin/articles/${first.id}/draft`,
          {
            method: "PUT",
            headers: { cookie, "content-type": "application/json" },
            body: JSON.stringify({
              ...metadata,
              version: 2,
              slug: "new-draft-locator",
            }),
          },
        )
      ).status,
    ).toBe(200);

    const collision = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${second.id}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          ...metadata,
          version: 1,
          slug: "public-locator",
        }),
      },
    );
    expect(collision.status).toBe(409);
    expect(await collision.json()).toEqual({
      status: "error",
      code: "ARTICLE_SLUG_CONFLICT",
    });

    expect(
      (
        await SELF.fetch(
          `http://briefly.test/api/admin/articles/${second.id}/draft`,
          {
            method: "PUT",
            headers: { cookie, "content-type": "application/json" },
            body: JSON.stringify({
              ...metadata,
              version: 1,
              slug: "draft-owned",
            }),
          },
        )
      ).status,
    ).toBe(200);
    await expect(
      env.DB.prepare(
        `INSERT INTO publication (id, article_id, slug, slug_key, created_at)
         VALUES (?, ?, 'draft-owned', 'draft-owned', ?)`,
      )
        .bind(crypto.randomUUID(), first.id, Date.now())
        .run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        `UPDATE publication
         SET slug = 'draft-owned', slug_key = 'draft-owned'
         WHERE id = ?`,
      )
        .bind(repeatedPublicationId)
        .run(),
    ).rejects.toThrow();

    await expect(
      env.DB.prepare(
        "UPDATE article SET current_publication_id = ? WHERE id = ?",
      )
        .bind(publicationId, second.id)
        .run(),
    ).rejects.toThrow();
  }, 15_000);

  it.each([
    "unsafe/path",
    "query?value",
    "fragment#value",
    "percent%2F",
    "control\u0000value",
  ])(
    "rejects the unsafe slug %j with a private validation issue",
    async (slug) => {
      const cookie = await initializeAndSignIn();
      const created = await (
        await SELF.fetch("http://briefly.test/api/admin/articles", {
          method: "POST",
          headers: { cookie },
        })
      ).json<{ id: string }>();

      const response = await SELF.fetch(
        `http://briefly.test/api/admin/articles/${created.id}/draft`,
        {
          method: "PUT",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({
            version: 1,
            title: "Unsafe",
            slug,
            summary: null,
            tags: [],
            byline: null,
            language: null,
          }),
        },
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        status: "error",
        code: "ARTICLE_DRAFT_INVALID",
        issues: [expect.objectContaining({ path: "slug" })],
      });
    },
    15_000,
  );

  it("independently requires authentication for create, list, load, and save", async () => {
    const articleId = "00000000-0000-4000-8000-000000000000";
    const requests = [
      SELF.fetch("http://briefly.test/api/admin/articles", { method: "POST" }),
      SELF.fetch("http://briefly.test/api/admin/articles"),
      SELF.fetch(`http://briefly.test/api/admin/articles/${articleId}`),
      SELF.fetch(`http://briefly.test/api/admin/articles/${articleId}/draft`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    ];

    for (const response of await Promise.all(requests)) {
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        status: "error",
        code: "AUTHENTICATION_REQUIRED",
      });
    }
  });

  it("presents the route-local Article Draft creation and loading surface", async () => {
    const cookie = await initializeAndSignIn();

    const response = await SELF.fetch("http://briefly.test/admin", {
      headers: { cookie },
    });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Article Drafts");
    expect(html).toContain("Create Article Draft");
    expect(html).toContain("Loading Article Drafts");
    expect(html).toContain(
      "Create incomplete Articles and autosave complete versioned Drafts.",
    );
    expect(html).toContain("The text-rich editor loads after hydration");
  }, 15_000);

  it("rejects a malformed persisted Draft envelope instead of trusting stored JSON", async () => {
    const cookie = await initializeAndSignIn();
    const created = await (
      await SELF.fetch("http://briefly.test/api/admin/articles", {
        method: "POST",
        headers: { cookie },
      })
    ).json<{ id: string }>();
    await env.DB.prepare(
      "UPDATE article_draft SET tags = '{}' WHERE article_id = ?",
    )
      .bind(created.id)
      .run();

    const response = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${created.id}`,
      { headers: { cookie } },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual([
      expect.objectContaining({
        path: ["tags"],
        message: "Invalid persisted tags",
      }),
    ]);
  }, 15_000);
});
