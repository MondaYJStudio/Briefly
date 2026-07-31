import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { initializeAndSignIn } from "./administrator-fixture";
import { uploadOnePixelPngAsset } from "./asset-fixture";

function textDocument(text: string) {
  return {
    documentSchemaVersion: 1,
    doc: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    },
  };
}

async function createArticle(cookie: string) {
  const created = await SELF.fetch("http://briefly.test/api/admin/articles", {
    method: "POST",
    headers: { cookie },
  });
  expect(created.status).toBe(201);
  return created.json<{ id: string }>();
}

async function saveDraft(
  cookie: string,
  articleId: string,
  version: number,
  slug: string,
  title: string,
) {
  const saved = await SELF.fetch(
    `http://briefly.test/api/admin/articles/${articleId}/draft`,
    {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        version,
        title,
        slug,
        summary: "Private summary",
        tags: ["private-tag"],
        byline: { name: "Private Byline", url: null },
        language: "en",
        cover: null,
        document: textDocument(`${title} private body`),
      }),
    },
  );
  expect(saved.status).toBe(200);
}

async function publish(
  cookie: string,
  articleId: string,
  draftVersion: number,
) {
  const published = await SELF.fetch(
    `http://briefly.test/api/admin/articles/${articleId}/publications`,
    {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ draftVersion }),
    },
  );
  expect(published.status).toBe(201);
}

describe("Article purge", () => {
  beforeEach(async () => {
    const { results } = await env.DB.prepare(
      "SELECT object_key FROM asset",
    ).all<{ object_key: string }>();
    await Promise.all(
      results.map(({ object_key }) => env.MEDIA_BUCKET.delete(object_key)),
    );
    await env.DB.batch([
      env.DB.prepare("DROP TRIGGER IF EXISTS reject_article_purge"),
      env.DB.prepare("UPDATE article SET current_publication_id = NULL"),
      env.DB.prepare("DELETE FROM publication"),
      env.DB.prepare("DELETE FROM article_draft"),
      env.DB.prepare("DELETE FROM article"),
      env.DB.prepare("DELETE FROM purged_article_slug"),
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

  it("returns 410 for every formerly public slug without exposing a never-published Draft slug", async () => {
    const cookie = await initializeAndSignIn();
    const article = await createArticle(cookie);
    await saveDraft(cookie, article.id, 1, "First-Caf\u00e9", "First title");
    await publish(cookie, article.id, 2);
    await saveDraft(cookie, article.id, 2, "second-slug", "Second title");
    await publish(cookie, article.id, 3);
    await saveDraft(cookie, article.id, 3, "never-public", "Private revision");
    expect(
      (
        await SELF.fetch(
          `http://briefly.test/api/admin/articles/${article.id}/trash`,
          { method: "POST", headers: { cookie } },
        )
      ).status,
    ).toBe(200);

    const purged = await SELF.fetch(
      `http://briefly.test/api/admin/trash/articles/${article.id}`,
      {
        method: "DELETE",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ confirmationArticleId: article.id }),
      },
    );
    expect(purged.status).toBe(200);
    expect(await purged.json()).toEqual({ id: article.id, purged: true });

    for (const path of ["First-Caf%C3%A9", "FIRST-CAFE%CC%81", "second-slug"]) {
      for (const method of ["GET", "HEAD"]) {
        const response = await SELF.fetch(
          `http://briefly.test/api/articles/${path}`,
          { method },
        );
        expect(response.status).toBe(410);
        expect(response.headers.get("cache-control")).toBe(
          "public, max-age=0, must-revalidate",
        );
        expect(response.headers.get("etag")).toBeNull();
        if (method === "GET") {
          expect(await response.json()).toEqual({
            status: "error",
            code: "ARTICLE_GONE",
          });
        } else {
          expect(await response.text()).toBe("");
        }
      }
    }

    const privateDraftSlug = await SELF.fetch(
      "http://briefly.test/api/articles/never-public",
    );
    expect(privateDraftSlug.status).toBe(404);
    expect(await privateDraftSlug.json()).toEqual({
      status: "error",
      code: "ARTICLE_NOT_FOUND",
    });

    const contract = await (
      await SELF.fetch("http://briefly.test/api/openapi.json")
    ).json<{
      paths: Record<
        string,
        Record<string, { responses: Record<string, { description: string }> }>
      >;
      components: { schemas: Record<string, unknown> };
    }>();
    for (const method of ["get", "head"]) {
      expect(
        contract.paths["/api/articles/{slug}"]?.[method]?.responses[410]
          ?.description,
      ).toBe(
        "The normalized slug is permanently reserved because its Article was purged.",
      );
    }
    expect(contract.components.schemas.ArticleGoneError).toMatchObject({
      required: ["status", "code"],
      properties: {
        code: { type: "string", enum: ["ARTICLE_GONE"] },
      },
    });
  }, 30_000);

  it("requires authentication, Trash state, and an exact Article identity confirmation", async () => {
    const cookie = await initializeAndSignIn();
    const article = await createArticle(cookie);
    const endpoint = `http://briefly.test/api/admin/trash/articles/${article.id}`;
    const request = (
      headers: Record<string, string>,
      confirmationArticleId: string,
    ) =>
      SELF.fetch(endpoint, {
        method: "DELETE",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ confirmationArticleId }),
      });

    const anonymous = await request({}, article.id);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("cache-control")).toBe("no-store");
    expect(await anonymous.json()).toEqual({
      status: "error",
      code: "AUTHENTICATION_REQUIRED",
    });

    const notTrashed = await request({ cookie }, article.id);
    expect(notTrashed.status).toBe(404);
    expect(await notTrashed.json()).toEqual({
      status: "error",
      code: "TRASHED_ARTICLE_NOT_FOUND",
    });

    expect(
      (
        await SELF.fetch(
          `http://briefly.test/api/admin/articles/${article.id}/trash`,
          { method: "POST", headers: { cookie } },
        )
      ).status,
    ).toBe(200);
    const wrongConfirmation = await request(
      { cookie },
      "00000000-0000-4000-8000-000000000000",
    );
    expect(wrongConfirmation.status).toBe(409);
    expect(await wrongConfirmation.json()).toEqual({
      status: "error",
      code: "ARTICLE_PURGE_CONFIRMATION_REQUIRED",
    });
    expect(
      (
        await SELF.fetch("http://briefly.test/api/admin/trash/articles", {
          headers: { cookie },
        })
      ).status,
    ).toBe(200);
  }, 30_000);

  it("removes all content and references while retaining only minimal tombstones and the R2 object", async () => {
    const cookie = await initializeAndSignIn();
    const asset = await uploadOnePixelPngAsset(cookie, "purge-retained.png");
    const objectKey = await env.DB.prepare(
      "SELECT object_key FROM asset WHERE id = ?",
    )
      .bind(asset.id)
      .first<string>("object_key");
    if (!objectKey) throw new Error("Expected uploaded R2 object key");
    const article = await createArticle(cookie);
    const saveWithAsset = async (
      version: number,
      slug: string,
      title: string,
    ) => {
      const saved = await SELF.fetch(
        `http://briefly.test/api/admin/articles/${article.id}/draft`,
        {
          method: "PUT",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({
            version,
            title,
            slug,
            summary: "Secret summary",
            tags: ["secret-tag"],
            byline: { name: "Secret Writer", url: null },
            language: "zh-CN",
            cover: { assetId: asset.id, alt: "Secret cover alt" },
            document: {
              documentSchemaVersion: 1,
              doc: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Secret body" }],
                  },
                  {
                    type: "figure",
                    attrs: {
                      assetId: asset.id,
                      alt: "Secret figure alt",
                      caption: "Secret caption",
                      decorative: false,
                    },
                  },
                ],
              },
            },
          }),
        },
      );
      expect(saved.status).toBe(200);
    };
    await saveWithAsset(1, "retained-one", "Secret title one");
    await publish(cookie, article.id, 2);
    await saveWithAsset(2, "retained-two", "Secret title two");
    await publish(cookie, article.id, 3);
    expect(
      (
        await SELF.fetch(
          `http://briefly.test/api/admin/articles/${article.id}/trash`,
          { method: "POST", headers: { cookie } },
        )
      ).status,
    ).toBe(200);

    const purged = await SELF.fetch(
      `http://briefly.test/api/admin/trash/articles/${article.id}`,
      {
        method: "DELETE",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ confirmationArticleId: article.id }),
      },
    );
    expect(purged.status).toBe(200);

    for (const table of [
      "article",
      "article_draft",
      "publication",
      "article_slug",
      "article_draft_asset_reference",
      "publication_asset_reference",
    ]) {
      expect(
        await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first(),
      ).toEqual({ count: 0 });
    }
    expect(
      await env.DB.prepare("PRAGMA table_info(purged_article_slug)").all(),
    ).toMatchObject({
      results: [
        expect.objectContaining({ name: "slug_key" }),
        expect.objectContaining({ name: "purged_at" }),
      ],
    });
    const tombstones = await env.DB.prepare(
      "SELECT * FROM purged_article_slug ORDER BY slug_key",
    ).all<Record<string, unknown>>();
    expect(tombstones.results).toEqual([
      { slug_key: "retained-one", purged_at: expect.any(Number) },
      { slug_key: "retained-two", purged_at: expect.any(Number) },
    ]);
    expect(await env.MEDIA_BUCKET.head(objectKey)).not.toBeNull();

    const library = await SELF.fetch("http://briefly.test/api/admin/assets", {
      headers: { cookie },
    });
    expect(await library.json()).toMatchObject({
      assets: [
        expect.objectContaining({
          id: asset.id,
          references: { currentDrafts: 0, retainedPublications: 0 },
        }),
      ],
    });
  }, 30_000);

  it("rolls back tombstones and content on failure, then remains safely retryable", async () => {
    const cookie = await initializeAndSignIn();
    const article = await createArticle(cookie);
    await saveDraft(cookie, article.id, 1, "atomic-purge", "Atomic title");
    await publish(cookie, article.id, 2);
    expect(
      (
        await SELF.fetch(
          `http://briefly.test/api/admin/articles/${article.id}/trash`,
          { method: "POST", headers: { cookie } },
        )
      ).status,
    ).toBe(200);
    await env.DB.prepare(
      `CREATE TRIGGER reject_article_purge
       BEFORE DELETE ON article
       BEGIN
         SELECT RAISE(ABORT, 'forced purge failure');
       END`,
    ).run();

    const purge = () =>
      SELF.fetch(`http://briefly.test/api/admin/trash/articles/${article.id}`, {
        method: "DELETE",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ confirmationArticleId: article.id }),
      });
    const failed = await purge();
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      status: "error",
      code: "INTERNAL_ERROR",
    });
    expect(
      await env.DB.prepare(
        "SELECT slug_key FROM purged_article_slug WHERE slug_key = 'atomic-purge'",
      ).first(),
    ).toBeNull();
    expect(
      await env.DB.prepare("SELECT id FROM article WHERE id = ?")
        .bind(article.id)
        .first(),
    ).toEqual({ id: article.id });
    expect(
      await env.DB.prepare(
        "SELECT title, html FROM publication WHERE article_id = ?",
      )
        .bind(article.id)
        .first(),
    ).toEqual({
      title: "Atomic title",
      html: "<p>Atomic title private body</p>",
    });

    await env.DB.prepare("DROP TRIGGER reject_article_purge").run();
    expect((await purge()).status).toBe(200);
    expect(
      await env.DB.prepare("SELECT id FROM article WHERE id = ?")
        .bind(article.id)
        .first(),
    ).toBeNull();
  }, 30_000);

  it("permanently rejects normalized slug variants after purge", async () => {
    const cookie = await initializeAndSignIn();
    const original = await createArticle(cookie);
    await saveDraft(cookie, original.id, 1, "Caf\u00e9", "Original");
    await publish(cookie, original.id, 2);
    expect(
      (
        await SELF.fetch(
          `http://briefly.test/api/admin/articles/${original.id}/trash`,
          { method: "POST", headers: { cookie } },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await SELF.fetch(
          `http://briefly.test/api/admin/trash/articles/${original.id}`,
          {
            method: "DELETE",
            headers: { cookie, "content-type": "application/json" },
            body: JSON.stringify({ confirmationArticleId: original.id }),
          },
        )
      ).status,
    ).toBe(200);

    const attempts = await Promise.all(
      ["CAFE\u0301", "caf\u00e9"].map(async (slug) => {
        const article = await createArticle(cookie);
        return SELF.fetch(
          `http://briefly.test/api/admin/articles/${article.id}/draft`,
          {
            method: "PUT",
            headers: { cookie, "content-type": "application/json" },
            body: JSON.stringify({
              version: 1,
              title: "Cannot reclaim",
              slug,
              summary: null,
              tags: [],
              byline: null,
              language: null,
              cover: null,
              document: textDocument("Cannot reclaim"),
            }),
          },
        );
      }),
    );
    for (const response of attempts) {
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        status: "error",
        code: "ARTICLE_SLUG_CONFLICT",
      });
    }
  }, 30_000);

  it("presents an accessible destructive confirmation distinct from reversible Trash", async () => {
    const cookie = await initializeAndSignIn();
    const response = await SELF.fetch("http://briefly.test/admin", {
      headers: { cookie },
    });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Permanently purge this Article?");
    expect(html).toContain("identifies the Article ID");
    expect(html).toContain("Draft and Publication history cannot be restored");
    expect(html).toContain("visually separate from reversible Trash");
    expect(html).toContain("Restore this Article from Trash?");
  }, 30_000);
});
