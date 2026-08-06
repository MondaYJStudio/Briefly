import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { initializeAndSignIn } from "./administrator-fixture";

interface PublicationReceipt<Article> {
  publicationId: string;
  draftVersion: number;
  article: Article;
}

describe("structured video embeds", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("UPDATE article SET current_publication_id = NULL"),
      env.DB.prepare("DELETE FROM publication"),
      env.DB.prepare("DELETE FROM article_draft"),
      env.DB.prepare("DELETE FROM article"),
      env.DB.prepare("DELETE FROM auth_session"),
      env.DB.prepare("DELETE FROM auth_account"),
      env.DB.prepare("DELETE FROM auth_user"),
      env.DB.prepare("DELETE FROM auth_rate_limit"),
    ]);
  });

  it("recognizes a representative YouTube URL as normalized provider facts", async () => {
    const cookie = await initializeAndSignIn();

    const response = await SELF.fetch(
      "http://briefly.test/api/admin/video-embeds/recognize",
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          input: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=43s",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      provider: "youtube",
      id: "dQw4w9WgXcQ",
    });
  });

  it.each([
    ["dQw4w9WgXcQ", { provider: "youtube", id: "dQw4w9WgXcQ" }],
    [
      "https://youtu.be/dQw4w9WgXcQ?si=discarded",
      { provider: "youtube", id: "dQw4w9WgXcQ" },
    ],
    ["BV1xx411c7mD", { provider: "bilibili", id: "BV1xx411c7mD" }],
    [
      "https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=discarded",
      { provider: "bilibili", id: "BV1xx411c7mD" },
    ],
    [
      "https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&page=3",
      { provider: "bilibili", id: "BV1xx411c7mD" },
    ],
  ])("recognizes supported input %s", async (input, expected) => {
    const cookie = await initializeAndSignIn();
    const response = await SELF.fetch(
      "http://briefly.test/api/admin/video-embeds/recognize",
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ input }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected);
  });

  it.each([
    "https://videos.example/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ%26onload%3Dalert(1)",
    "https://www.youtube.com/embed/%64Qw4w9WgXcQ",
    "javascript:https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>',
  ])("rejects unsupported or hostile input %s", async (input) => {
    const cookie = await initializeAndSignIn();
    const response = await SELF.fetch(
      "http://briefly.test/api/admin/video-embeds/recognize",
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ input }),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      status: "error",
      code: "VIDEO_EMBED_UNSUPPORTED",
      message:
        "Use a supported YouTube or Bilibili URL or identifier; other providers can remain ordinary links.",
    });
  });

  it("previews and publishes the same safe portable video artifact with immutable provider facts", async () => {
    const cookie = await initializeAndSignIn();
    const created = await SELF.fetch("http://briefly.test/api/admin/articles", {
      method: "POST",
      headers: { cookie },
    });
    expect(created.status).toBe(201);
    const articleId = (await created.json<{ id: string }>()).id;
    const document = {
      documentSchemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "videoEmbed",
            attrs: {
              provider: "youtube",
              id: "dQw4w9WgXcQ",
              title: "A safe YouTube demonstration",
            },
          },
          {
            type: "videoEmbed",
            attrs: {
              provider: "bilibili",
              id: "BV1xx411c7mD",
              title: "A safe Bilibili demonstration",
            },
          },
        ],
      },
    };
    const saved = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${articleId}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          title: "Portable video embeds",
          slug: "portable-video-embeds",
          summary: null,
          tags: [],
          byline: null,
          language: null,
          document,
        }),
      },
    );
    expect(saved.status).toBe(200);

    const preview = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${articleId}/preview`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ draftVersion: 2 }),
      },
    );
    expect(preview.status).toBe(200);
    const previewed = await preview.json<{ html: string }>();
    expect(previewed.html).toBe(
      '<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" title="A safe YouTube demonstration" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen=""></iframe><iframe src="https://player.bilibili.com/player.html?bvid=BV1xx411c7mD" title="A safe Bilibili demonstration" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="fullscreen" allowfullscreen=""></iframe>',
    );

    const published = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${articleId}/publications`,
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
    const firstReceipt =
      await published.json<PublicationReceipt<{ html: string }>>();
    expect(firstReceipt).toMatchObject({
      draftVersion: 2,
      article: { html: previewed.html },
    });

    const publicRead = await SELF.fetch(
      "http://briefly.test/api/articles/portable-video-embeds",
    );
    expect(publicRead.status).toBe(200);
    expect(await publicRead.json()).toMatchObject({ html: previewed.html });

    const stored = await env.DB.prepare(
      `SELECT document_schema_version, document, renderer_version,
              provider_facts, html
       FROM publication WHERE article_id = ?`,
    )
      .bind(articleId)
      .first<Record<string, unknown>>();
    expect(stored).toEqual({
      document_schema_version: 1,
      document: JSON.stringify(document),
      renderer_version: 3,
      provider_facts: JSON.stringify([
        { provider: "youtube", id: "dQw4w9WgXcQ" },
        { provider: "bilibili", id: "BV1xx411c7mD" },
      ]),
      html: previewed.html,
    });

    const revisedDocument = {
      documentSchemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "videoEmbed",
            attrs: {
              provider: "youtube",
              id: "9bZkp7q19f0",
              title: "A private revision",
            },
          },
        ],
      },
    };
    const revised = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${articleId}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          version: 2,
          title: "Private revised video",
          slug: "private-revised-video",
          summary: null,
          tags: [],
          byline: null,
          language: null,
          document: revisedDocument,
        }),
      },
    );
    expect(revised.status).toBe(200);
    const stillPublic = await SELF.fetch(
      "http://briefly.test/api/articles/portable-video-embeds",
    );
    expect(await stillPublic.json()).toMatchObject({ html: previewed.html });
    expect(
      await env.DB.prepare(
        "SELECT document, provider_facts, html FROM publication WHERE article_id = ?",
      )
        .bind(articleId)
        .first(),
    ).toEqual({
      document: JSON.stringify(document),
      provider_facts: JSON.stringify([
        { provider: "youtube", id: "dQw4w9WgXcQ" },
        { provider: "bilibili", id: "BV1xx411c7mD" },
      ]),
      html: previewed.html,
    });

    const republished = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${articleId}/publications`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          draftVersion: 3,
          expectedCurrentPublicationId: firstReceipt.publicationId,
        }),
      },
    );
    expect(republished.status).toBe(201);
    const republishedReceipt =
      await republished.json<PublicationReceipt<{ html: string }>>();
    const republishedArticle = republishedReceipt.article;
    expect(republishedArticle.html).toBe(
      '<iframe src="https://www.youtube-nocookie.com/embed/9bZkp7q19f0" title="A private revision" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen=""></iframe>',
    );

    const visibleRevision = await SELF.fetch(
      "http://briefly.test/api/articles/private-revised-video",
    );
    expect(visibleRevision.status).toBe(200);
    expect(await visibleRevision.json()).toMatchObject(republishedArticle);

    expect(
      await env.DB.prepare(
        `SELECT document_schema_version, document, renderer_version,
                provider_facts, html
         FROM publication
         WHERE article_id = ? AND publication_number = 1`,
      )
        .bind(articleId)
        .first(),
    ).toEqual(stored);
    expect(
      await env.DB.prepare(
        `SELECT publication_number, document_schema_version, document,
                renderer_version, provider_facts, html
         FROM publication
         WHERE article_id = ? AND publication_number = 2`,
      )
        .bind(articleId)
        .first(),
    ).toEqual({
      publication_number: 2,
      document_schema_version: 1,
      document: JSON.stringify(revisedDocument),
      renderer_version: 3,
      provider_facts: JSON.stringify([
        { provider: "youtube", id: "9bZkp7q19f0" },
      ]),
      html: republishedArticle.html,
    });
  }, 20_000);

  it.each([
    {
      label: "a malformed YouTube identifier",
      attrs: {
        provider: "youtube",
        id: "too-short",
        title: "Malformed identifier",
      },
    },
    {
      label: "a malformed Bilibili identifier",
      attrs: {
        provider: "bilibili",
        id: "av170001",
        title: "Malformed identifier",
      },
    },
    {
      label: "a missing accessible title",
      attrs: { provider: "youtube", id: "dQw4w9WgXcQ", title: "   " },
    },
    {
      label: "author-controlled iframe data",
      attrs: {
        provider: "youtube",
        id: "dQw4w9WgXcQ",
        title: "Injected privileges",
        src: "javascript:alert(1)",
        srcdoc: "<script>alert(1)</script>",
        allow: "camera; microphone",
        onload: "alert(1)",
      },
    },
  ])("rejects $label without advancing the saved Draft", async ({ attrs }) => {
    const cookie = await initializeAndSignIn();
    const created = await SELF.fetch("http://briefly.test/api/admin/articles", {
      method: "POST",
      headers: { cookie },
    });
    const articleId = (await created.json<{ id: string }>()).id;

    const rejected = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${articleId}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          title: "Must remain private",
          slug: "must-remain-private",
          summary: null,
          tags: [],
          byline: null,
          language: null,
          document: {
            documentSchemaVersion: 1,
            doc: { type: "doc", content: [{ type: "videoEmbed", attrs }] },
          },
        }),
      },
    );

    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({
      status: "error",
      code: "ARTICLE_DRAFT_INVALID",
      issues: [
        expect.objectContaining({ path: expect.stringContaining("document") }),
      ],
    });
    const preserved = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${articleId}`,
      { headers: { cookie } },
    );
    expect(await preserved.json()).toMatchObject({
      currentPublicationId: null,
      draft: {
        version: 1,
        title: "",
        document: {
          documentSchemaVersion: 1,
          doc: { type: "doc", content: [{ type: "paragraph" }] },
        },
      },
    });
  });

  it("requires an Administrator session for provider recognition", async () => {
    const response = await SELF.fetch(
      "http://briefly.test/api/admin/video-embeds/recognize",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "dQw4w9WgXcQ" }),
      },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "error",
      code: "AUTHENTICATION_REQUIRED",
    });
  });

  it("serves the Article editor route while client-side video controls load", async () => {
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
  }, 15_000);
});
