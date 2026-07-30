import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { initializeAndSignIn } from "./administrator-fixture";
import { uploadOnePixelPngAsset } from "./asset-fixture";

async function createArticle(cookie: string): Promise<string> {
  const response = await SELF.fetch("http://briefly.test/api/admin/articles", {
    method: "POST",
    headers: { cookie },
  });
  expect(response.status).toBe(201);
  return (await response.json<{ id: string }>()).id;
}

function figureDocument(assetId: string) {
  return {
    documentSchemaVersion: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Published with media" }],
        },
        {
          type: "figure",
          attrs: {
            assetId,
            alt: "A contextual figure description",
            caption: "A usage-specific caption",
            decorative: false,
          },
        },
      ],
    },
  };
}

async function saveAssetBackedDraft(
  cookie: string,
  articleId: string,
  coverAssetId: string,
  figureAssetId: string,
): Promise<void> {
  const response = await SELF.fetch(
    `http://briefly.test/api/admin/articles/${articleId}/draft`,
    {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        title: "Public Asset delivery",
        slug: `public-asset-${articleId}`,
        summary: null,
        tags: [],
        byline: null,
        language: null,
        cover: {
          assetId: coverAssetId,
          alt: "A usage-specific cover description",
        },
        document: figureDocument(figureAssetId),
      }),
    },
  );
  expect(response.status).toBe(200);
}

async function publish(cookie: string, articleId: string): Promise<Response> {
  return SELF.fetch(
    `http://briefly.test/api/admin/articles/${articleId}/publications`,
    {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ draftVersion: 2 }),
    },
  );
}

describe("stable public Asset delivery", () => {
  beforeEach(async () => {
    const { results } = await env.DB.prepare(
      "SELECT object_key FROM asset",
    ).all<{ object_key: string }>();
    await Promise.all(
      results.map(({ object_key }) => env.MEDIA_BUCKET.delete(object_key)),
    );
    await env.DB.batch([
      env.DB.prepare("DROP TRIGGER IF EXISTS reject_asset_publication_pointer"),
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

  it("publishes figures and covers with permanent application-owned media URLs", async () => {
    const cookie = await initializeAndSignIn();
    const coverAsset = await uploadOnePixelPngAsset(cookie, "cover.png");
    const figureAsset = await uploadOnePixelPngAsset(cookie, "figure.png");
    const articleId = await createArticle(cookie);
    await saveAssetBackedDraft(
      cookie,
      articleId,
      coverAsset.id,
      figureAsset.id,
    );

    const response = await publish(cookie, articleId);

    expect(response.status).toBe(201);
    const body = await response.json<{
      cover: { url: string; width: number; height: number; alt: string };
      html: string;
    }>();
    expect(body.cover).toEqual({
      url: expect.stringMatching(
        /^http:\/\/briefly\.test\/media\/[0-9a-f-]{36}$/u,
      ),
      width: 1,
      height: 1,
      alt: "A usage-specific cover description",
    });
    expect(body.html).toMatch(
      /<figure><img src="http:\/\/briefly\.test\/media\/[0-9a-f-]{36}" width="1" height="1" alt="A contextual figure description"\/><figcaption>A usage-specific caption<\/figcaption><\/figure>/u,
    );

    const anonymousArticle = await SELF.fetch(
      `http://briefly.test/api/articles/public-asset-${articleId}`,
      { headers: { origin: "https://reader.example" } },
    );
    expect(anonymousArticle.status).toBe(200);
    expect(anonymousArticle.headers.get("access-control-allow-origin")).toBe(
      "*",
    );
    expect(await anonymousArticle.json()).toMatchObject({
      cover: body.cover,
      html: body.html,
    });

    const assets = await env.DB.prepare(
      `SELECT id, public_asset_id
       FROM asset
       WHERE id IN (?, ?)
       ORDER BY id`,
    )
      .bind(coverAsset.id, figureAsset.id)
      .all<{ id: string; public_asset_id: string | null }>();
    expect(assets.results).toHaveLength(2);
    expect(assets.results.every(({ public_asset_id }) => public_asset_id)).toBe(
      true,
    );

    const publicationReferences = await env.DB.prepare(
      `SELECT publication_asset_reference.asset_id
       FROM publication_asset_reference
       JOIN publication
         ON publication.id = publication_asset_reference.publication_id
       WHERE publication.article_id = ?
       ORDER BY publication_asset_reference.asset_id`,
    )
      .bind(articleId)
      .all<{ asset_id: string }>();
    expect(
      publicationReferences.results.map(({ asset_id }) => asset_id),
    ).toEqual([coverAsset.id, figureAsset.id].sort());

    const publicUrl = body.cover.url;
    const media = await SELF.fetch(publicUrl, {
      headers: {
        cookie: "better-auth.session_token=ignored",
        origin: "https://reader.example",
      },
    });
    expect(media.status).toBe(200);
    expect(media.headers.get("content-type")).toBe("image/png");
    expect(media.headers.get("x-content-type-options")).toBe("nosniff");
    expect(media.headers.get("access-control-allow-origin")).toBe("*");
    expect(media.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect((await media.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const head = await SELF.fetch(publicUrl, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("content-length")).toBe(
      media.headers.get("content-length"),
    );
  }, 20_000);

  it("keeps one public identity across Publications while private delivery stays authenticated", async () => {
    const cookie = await initializeAndSignIn();
    const asset = await uploadOnePixelPngAsset(cookie, "reused.png");
    const firstArticleId = await createArticle(cookie);
    await saveAssetBackedDraft(cookie, firstArticleId, asset.id, asset.id);
    const firstPublication = await publish(cookie, firstArticleId);
    expect(firstPublication.status).toBe(201);
    const firstBody = await firstPublication.json<{
      cover: { url: string };
      html: string;
    }>();
    const assigned = await env.DB.prepare(
      "SELECT public_asset_id FROM asset WHERE id = ?",
    )
      .bind(asset.id)
      .first<{ public_asset_id: string }>();
    expect(assigned?.public_asset_id).toBeTruthy();
    expect(firstBody.cover.url).toBe(
      `http://briefly.test/media/${assigned?.public_asset_id}`,
    );

    const internalIdentityRequest = await SELF.fetch(
      `http://briefly.test/media/${asset.id}`,
    );
    expect(internalIdentityRequest.status).toBe(404);
    expect(internalIdentityRequest.headers.get("cache-control")).toBe(
      "no-store",
    );
    expect(await internalIdentityRequest.json()).toEqual({
      status: "error",
      code: "ASSET_NOT_FOUND",
    });
    const missingHead = await SELF.fetch(
      `http://briefly.test/media/${asset.id}`,
      { method: "HEAD" },
    );
    expect(missingHead.status).toBe(404);
    expect(missingHead.headers.get("cache-control")).toBe("no-store");
    expect(await missingHead.text()).toBe("");
    const anonymousPrivateRequest = await SELF.fetch(
      `http://briefly.test/media/private/${asset.id}`,
    );
    expect(anonymousPrivateRequest.status).toBe(401);
    expect(anonymousPrivateRequest.headers.get("cache-control")).toBe(
      "private, no-store",
    );
    const authenticatedPrivateRequest = await SELF.fetch(
      `http://briefly.test/media/private/${asset.id}`,
      { headers: { cookie } },
    );
    expect(authenticatedPrivateRequest.status).toBe(200);
    expect(authenticatedPrivateRequest.headers.get("cache-control")).toBe(
      "private, no-store",
    );

    const revisedDraft = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${firstArticleId}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          version: 2,
          title: "Private revision without media",
          slug: `public-asset-${firstArticleId}`,
          summary: null,
          tags: [],
          byline: null,
          language: null,
          cover: null,
          document: {
            documentSchemaVersion: 1,
            doc: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Media removed privately" }],
                },
              ],
            },
          },
        }),
      },
    );
    expect(revisedDraft.status).toBe(200);
    expect(
      await env.DB.prepare(
        `SELECT publication_asset_reference.asset_id
         FROM publication_asset_reference
         JOIN publication
           ON publication.id = publication_asset_reference.publication_id
         WHERE publication.article_id = ?`,
      )
        .bind(firstArticleId)
        .all(),
    ).toMatchObject({ results: [{ asset_id: asset.id }] });

    const secondArticleId = await createArticle(cookie);
    await saveAssetBackedDraft(cookie, secondArticleId, asset.id, asset.id);
    const secondPublication = await publish(cookie, secondArticleId);
    expect(secondPublication.status).toBe(201);
    const secondBody = await secondPublication.json<{
      cover: { url: string };
      html: string;
    }>();
    expect(secondBody.cover.url).toBe(firstBody.cover.url);
    expect(secondBody.html).toContain(firstBody.cover.url);
    expect(
      await env.DB.prepare("SELECT public_asset_id FROM asset WHERE id = ?")
        .bind(asset.id)
        .first(),
    ).toEqual(assigned);

    const publicWithoutCookie = await SELF.fetch(firstBody.cover.url);
    const publicWithCookie = await SELF.fetch(firstBody.cover.url, {
      headers: { cookie },
    });
    expect(publicWithoutCookie.status).toBe(200);
    expect(publicWithCookie.status).toBe(200);
    expect(await publicWithCookie.arrayBuffer()).toEqual(
      await publicWithoutCookie.arrayBuffer(),
    );
  }, 20_000);

  it("warns that distributed public media cannot become private again", async () => {
    const cookie = await initializeAndSignIn();

    const response = await SELF.fetch("http://briefly.test/admin", {
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(
      "Published media URLs remain public permanently, including after the Article is unpublished.",
    );
  }, 20_000);

  it("reports every unavailable Asset without leaving partial public state", async () => {
    const cookie = await initializeAndSignIn();
    const coverAsset = await uploadOnePixelPngAsset(
      cookie,
      "missing-object.png",
    );
    const incompleteAsset = await uploadOnePixelPngAsset(
      cookie,
      "incomplete.png",
    );
    const invalidMediaAsset = await uploadOnePixelPngAsset(
      cookie,
      "invalid-media.png",
    );
    const removedAsset = await uploadOnePixelPngAsset(cookie, "removed.png");
    const articleId = await createArticle(cookie);
    const document = {
      documentSchemaVersion: 1,
      doc: {
        type: "doc",
        content: [incompleteAsset, invalidMediaAsset, removedAsset].map(
          ({ id }, index) => ({
            type: "figure",
            attrs: {
              assetId: id,
              alt: `Figure ${index + 1}`,
              caption: null,
              decorative: false,
            },
          }),
        ),
      },
    };
    const saved = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${articleId}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          title: "Unavailable public Assets",
          slug: "unavailable-public-assets",
          summary: null,
          tags: [],
          byline: null,
          language: null,
          cover: { assetId: coverAsset.id, alt: "Missing cover object" },
          document,
        }),
      },
    );
    expect(saved.status).toBe(200);

    const coverRow = await env.DB.prepare(
      "SELECT object_key FROM asset WHERE id = ?",
    )
      .bind(coverAsset.id)
      .first<{ object_key: string }>();
    if (!coverRow) throw new Error("Expected saved cover Asset");
    await env.MEDIA_BUCKET.delete(coverRow.object_key);
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE asset SET lifecycle_state = 'failed', failure_code = 'TEST' WHERE id = ?",
      ).bind(incompleteAsset.id),
      env.DB.prepare(
        "UPDATE asset SET mime_type = 'image/svg+xml' WHERE id = ?",
      ).bind(invalidMediaAsset.id),
    ]);
    const missingAssetId = crypto.randomUUID();
    const persistedDocument = structuredClone(document);
    persistedDocument.doc.content[2].attrs.assetId = missingAssetId;
    await env.DB.prepare(
      "UPDATE article_draft SET document = ? WHERE article_id = ?",
    )
      .bind(JSON.stringify(persistedDocument), articleId)
      .run();

    const response = await publish(cookie, articleId);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      status: "error",
      code: "PUBLICATION_INVALID",
      issues: [
        coverAsset.id,
        incompleteAsset.id,
        invalidMediaAsset.id,
        missingAssetId,
      ].map((assetId) => ({
        code: "ASSET_NOT_RESOLVED",
        path: `assets.${assetId}`,
        message: "Referenced Asset is unavailable for publication",
      })),
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
        "SELECT COUNT(*) AS count FROM publication_asset_reference",
      ).first(),
    ).toEqual({ count: 0 });
    expect(
      (
        await env.DB.prepare(
          "SELECT public_asset_id FROM asset ORDER BY id",
        ).all<{ public_asset_id: string | null }>()
      ).results.every(({ public_asset_id }) => public_asset_id === null),
    ).toBe(true);
    expect(
      await env.DB.prepare(
        "SELECT was_published FROM article_slug WHERE slug_key = ?",
      )
        .bind("unavailable-public-assets")
        .first(),
    ).toEqual({ was_published: 0 });
  }, 20_000);

  it("rolls back public identities and references when the D1 commit fails", async () => {
    const cookie = await initializeAndSignIn();
    const asset = await uploadOnePixelPngAsset(cookie, "rollback.png");
    const articleId = await createArticle(cookie);
    await saveAssetBackedDraft(cookie, articleId, asset.id, asset.id);
    await env.DB.prepare(
      `CREATE TRIGGER reject_asset_publication_pointer
       BEFORE UPDATE OF current_publication_id ON article
       WHEN NEW.current_publication_id IS NOT NULL
       BEGIN
         SELECT RAISE(ABORT, 'simulated publication pointer failure');
       END`,
    ).run();

    let response: Response;
    try {
      response = await publish(cookie, articleId);
    } finally {
      await env.DB.prepare(
        "DROP TRIGGER IF EXISTS reject_asset_publication_pointer",
      ).run();
    }

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      status: "error",
      code: "INTERNAL_ERROR",
    });
    expect(
      await env.DB.prepare("SELECT public_asset_id FROM asset WHERE id = ?")
        .bind(asset.id)
        .first(),
    ).toEqual({ public_asset_id: null });
    expect(
      await env.DB.prepare("SELECT id FROM publication WHERE article_id = ?")
        .bind(articleId)
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM publication_asset_reference",
      ).first(),
    ).toEqual({ count: 0 });
    expect(
      await env.DB.prepare(
        "SELECT current_publication_id, published_at FROM article WHERE id = ?",
      )
        .bind(articleId)
        .first(),
    ).toEqual({ current_publication_id: null, published_at: null });
    expect(
      await env.DB.prepare(
        "SELECT was_published FROM article_slug WHERE article_id = ?",
      )
        .bind(articleId)
        .first(),
    ).toEqual({ was_published: 0 });
  }, 20_000);
});
