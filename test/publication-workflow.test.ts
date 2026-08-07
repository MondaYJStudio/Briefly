import {
  SELF,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import worker from "../src/server";
import { initializeAndSignIn } from "./administrator-fixture";
import { uploadOnePixelPngAsset } from "./asset-fixture";

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

async function createSavedArticle(
  cookie: string,
  slug: string,
): Promise<{ id: string; draftVersion: number }> {
  const article = await (
    await SELF.fetch("http://briefly.test/api/admin/articles", {
      method: "POST",
      headers: { cookie },
    })
  ).json<{ id: string }>();
  const saved = await SELF.fetch(
    `http://briefly.test/api/admin/articles/${article.id}/draft`,
    {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        title: `Article ${slug}`,
        slug,
        summary: null,
        tags: [],
        byline: null,
        language: null,
        document: textDocument(`Body ${slug}`),
      }),
    },
  );
  expect(saved.status).toBe(200);
  return { id: article.id, draftVersion: 2 };
}

function publish(
  cookie: string,
  articleId: string,
  draftVersion: number,
  expectedCurrentPublicationId: string | null,
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

function preview(
  cookie: string,
  articleId: string,
  draftVersion: number,
): Promise<Response> {
  return SELF.fetch(
    `http://briefly.test/api/admin/articles/${articleId}/preview`,
    {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ draftVersion }),
    },
  );
}

async function fetchThroughWorker(
  input: string,
  init: RequestInit,
  overrides: Partial<typeof env>,
): Promise<Response> {
  const context = createExecutionContext();
  const response = await worker.fetch(
    new Request(input, init) as Request<unknown, IncomingRequestCfProperties>,
    { ...env, ...overrides },
    context,
  );
  await waitOnExecutionContext(context);
  return response;
}

function databaseWithBatch(batch: D1Database["batch"]): D1Database {
  return {
    prepare: env.DB.prepare.bind(env.DB),
    batch,
    exec: env.DB.exec.bind(env.DB),
    dump: env.DB.dump.bind(env.DB),
  } as D1Database;
}

describe("Publication Workflow", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DROP TRIGGER IF EXISTS reject_publication_insert"),
      env.DB.prepare("UPDATE article SET current_publication_id = NULL"),
      env.DB.prepare("DELETE FROM publication"),
      env.DB.prepare("DELETE FROM article_draft"),
      env.DB.prepare("DELETE FROM article"),
      env.DB.prepare("DELETE FROM auth_session"),
      env.DB.prepare("DELETE FROM auth_account"),
      env.DB.prepare("DELETE FROM auth_user"),
      env.DB.prepare("DELETE FROM auth_rate_limit"),
      env.DB.prepare(
        `UPDATE site_settings
         SET site_name = 'Briefly',
             site_description = 'A modern, self-hosted content engine with editable drafts and an immutable version history.',
             site_descriptions = json_object('en', 'A modern, self-hosted content engine with editable drafts and an immutable version history.'),
             default_byline_name = 'Briefly', default_byline_url = NULL,
             default_language = 'en'
         WHERE id = 1`,
      ),
    ]);
  });

  it("reports the same complete canonical issues for Preview and Publish", async () => {
    const cookie = await initializeAndSignIn();
    const article = await (
      await SELF.fetch("http://briefly.test/api/admin/articles", {
        method: "POST",
        headers: { cookie },
      })
    ).json<{ id: string }>();

    const [preview, publish] = await Promise.all([
      SELF.fetch(
        `http://briefly.test/api/admin/articles/${article.id}/preview`,
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ draftVersion: 1 }),
        },
      ),
      SELF.fetch(
        `http://briefly.test/api/admin/articles/${article.id}/publications`,
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({
            draftVersion: 1,
            expectedCurrentPublicationId: null,
          }),
        },
      ),
    ]);

    const expected = {
      status: "error",
      code: "PUBLICATION_INVALID",
      issues: [
        {
          code: "BODY_REQUIRED",
          path: "draft.document.doc",
          message: "Substantive body content is required for publication.",
        },
        {
          code: "SLUG_REQUIRED",
          path: "draft.slug",
          message: "A slug is required for publication.",
        },
        {
          code: "TITLE_REQUIRED",
          path: "draft.title",
          message: "A title is required for publication.",
        },
      ],
    };
    expect(preview.status).toBe(400);
    expect(publish.status).toBe(400);
    expect(await preview.json()).toEqual(expected);
    expect(await publish.json()).toEqual(expected);
  }, 20_000);

  it("keeps persisted, Document, cover, Asset, and Renderer issue parity", async () => {
    const cookie = await initializeAndSignIn();
    const unavailableAssetId = "00000000-0000-4000-8000-000000000099";
    const cases: Array<{
      name: string;
      mutate: (articleId: string) => Promise<unknown>;
      issues: Array<{ code: string; path: string; message: string }>;
    }> = [
      {
        name: "corrupted persisted Document envelope",
        mutate: (articleId) =>
          env.DB.prepare(
            "UPDATE article_draft SET document = ? WHERE article_id = ?",
          )
            .bind('{"privateDraft":', articleId)
            .run(),
        issues: [
          {
            code: "PERSISTED_FIELD_INVALID",
            path: "draft.document",
            message: "The saved Draft document is invalid.",
          },
        ],
      },
      {
        name: "corrupted persisted Byline",
        mutate: (articleId) =>
          env.DB.prepare(
            "UPDATE article_draft SET byline = ? WHERE article_id = ?",
          )
            .bind(JSON.stringify({ name: "", url: null }), articleId)
            .run(),
        issues: [
          {
            code: "PERSISTED_FIELD_INVALID",
            path: "draft.byline",
            message: "The saved Draft byline is invalid.",
          },
        ],
      },
      {
        name: "unsafe link",
        mutate: (articleId) =>
          env.DB.prepare(
            "UPDATE article_draft SET document = ? WHERE article_id = ?",
          )
            .bind(
              JSON.stringify({
                documentSchemaVersion: 1,
                doc: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: "Unsafe link",
                          marks: [
                            {
                              type: "link",
                              attrs: { href: "javascript:private()" },
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              }),
              articleId,
            )
            .run(),
        issues: [
          {
            code: "UNSAFE_LINK",
            path: "draft.document.doc.content.0.content.0.marks.0.attrs.href",
            message: "The saved Draft contains an unsafe link.",
          },
        ],
      },
      {
        name: "unsupported node",
        mutate: (articleId) =>
          env.DB.prepare(
            "UPDATE article_draft SET document = ? WHERE article_id = ?",
          )
            .bind(
              JSON.stringify({
                documentSchemaVersion: 1,
                doc: {
                  type: "doc",
                  content: [
                    {
                      type: "rawHtml",
                      content: [{ type: "text", text: "Unsupported" }],
                    },
                  ],
                },
              }),
              articleId,
            )
            .run(),
        issues: [
          {
            code: "UNSUPPORTED_NODE",
            path: "draft.document.doc.content.0.type",
            message: "The saved Draft contains an unsupported Document node.",
          },
        ],
      },
      {
        name: "invalid cover",
        mutate: (articleId) =>
          env.DB.prepare(
            "UPDATE article_draft SET cover = ? WHERE article_id = ?",
          )
            .bind(JSON.stringify({ assetId: "invalid", alt: "" }), articleId)
            .run(),
        issues: [
          {
            code: "PERSISTED_FIELD_INVALID",
            path: "draft.cover",
            message: "The saved Draft cover is invalid.",
          },
        ],
      },
      {
        name: "unavailable Asset",
        mutate: (articleId) =>
          env.DB.prepare(
            "UPDATE article_draft SET document = ? WHERE article_id = ?",
          )
            .bind(
              JSON.stringify({
                documentSchemaVersion: 1,
                doc: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Asset body" }],
                    },
                    {
                      type: "figure",
                      attrs: {
                        assetId: unavailableAssetId,
                        alt: "Unavailable",
                        decorative: false,
                        caption: null,
                      },
                    },
                  ],
                },
              }),
              articleId,
            )
            .run(),
        issues: [
          {
            code: "ASSET_NOT_RESOLVED",
            path: `draft.assets.${unavailableAssetId}`,
            message: "A referenced Asset is unavailable for publication.",
          },
        ],
      },
      {
        name: "invalid Renderer structure",
        mutate: (articleId) =>
          env.DB.prepare(
            "UPDATE article_draft SET document = ? WHERE article_id = ?",
          )
            .bind(
              JSON.stringify({
                documentSchemaVersion: 1,
                doc: {
                  type: "doc",
                  content: [
                    {
                      type: "bulletList",
                      content: [
                        {
                          type: "listItem",
                          content: [
                            {
                              type: "heading",
                              attrs: { level: 2 },
                              content: [
                                { type: "text", text: "Invalid nesting" },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              }),
              articleId,
            )
            .run(),
        issues: [
          {
            code: "INVALID_DOCUMENT_STRUCTURE",
            path: "draft.document.doc",
            message: "The saved Draft Document structure is invalid.",
          },
        ],
      },
    ];

    for (const fixture of cases) {
      const article = await createSavedArticle(
        cookie,
        `parity-${fixture.name.toLowerCase().replaceAll(/[^a-z]+/gu, "-")}`,
      );
      await fixture.mutate(article.id);
      const [previewResponse, publishResponse] = await Promise.all([
        preview(cookie, article.id, article.draftVersion),
        publish(cookie, article.id, article.draftVersion, null),
      ]);
      const expected = {
        status: "error",
        code: "PUBLICATION_INVALID",
        issues: fixture.issues,
      };
      expect(previewResponse.status, fixture.name).toBe(400);
      expect(publishResponse.status, fixture.name).toBe(400);
      const previewText = await previewResponse.text();
      const publishText = await publishResponse.text();
      expect(JSON.parse(previewText), fixture.name).toEqual(expected);
      expect(JSON.parse(publishText), fixture.name).toEqual(expected);
      expect(previewText, fixture.name).not.toContain("html");
      expect(publishText, fixture.name).not.toContain("html");
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) AS count FROM publication WHERE article_id = ?",
        )
          .bind(article.id)
          .first(),
        fixture.name,
      ).toEqual({ count: 0 });
    }
  }, 30_000);

  it("resolves only the publication settings defaults that the saved Draft needs", async () => {
    const cookie = await initializeAndSignIn();
    const overridden = await createSavedArticle(cookie, "settings-overrides");
    const overrideSave = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${overridden.id}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          version: overridden.draftVersion,
          title: "Settings overrides",
          slug: "settings-overrides",
          summary: null,
          tags: [],
          byline: { name: "Guest Writer", url: "https://guest.example/" },
          language: "fr-CA",
          document: textDocument("Override body"),
        }),
      },
    );
    expect(overrideSave.status).toBe(200);
    await env.DB.prepare(
      `UPDATE site_settings
       SET site_name = '', site_description = ?, site_descriptions = NULL, default_byline_name = '',
           default_byline_url = 'javascript:private()', default_language = '!'
       WHERE id = 1`,
    )
      .bind("x".repeat(600))
      .run();
    const [overridePreview, overridePublish] = await Promise.all([
      preview(cookie, overridden.id, 3),
      publish(cookie, overridden.id, 3, null),
    ]);
    expect(overridePreview.status).toBe(200);
    expect(overridePublish.status).toBe(201);
    expect(await overridePreview.json()).toMatchObject({
      metadata: {
        byline: { name: "Guest Writer", url: "https://guest.example/" },
        language: "fr-CA",
      },
    });

    await env.DB.prepare(
      `UPDATE site_settings
       SET site_name = '', site_description = ?, site_descriptions = NULL,
           default_byline_name = 'Briefly', default_byline_url = NULL,
           default_language = 'en'
       WHERE id = 1`,
    )
      .bind("x".repeat(600))
      .run();
    const irrelevant = await createSavedArticle(
      cookie,
      "irrelevant-damaged-settings",
    );
    const [irrelevantPreview, irrelevantPublish] = await Promise.all([
      preview(cookie, irrelevant.id, irrelevant.draftVersion),
      publish(cookie, irrelevant.id, irrelevant.draftVersion, null),
    ]);
    expect(irrelevantPreview.status).toBe(200);
    expect(irrelevantPublish.status).toBe(201);

    await env.DB.prepare(
      `UPDATE site_settings
       SET site_name = 'Briefly',
           site_description = 'A modern, self-hosted content engine with editable drafts and an immutable version history.',
           site_descriptions = json_object('en', 'A modern, self-hosted content engine with editable drafts and an immutable version history.'),
           default_byline_name = '', default_byline_url = NULL,
           default_language = '!'
       WHERE id = 1`,
    ).run();
    const defaults = await createSavedArticle(cookie, "damaged-used-defaults");
    const [defaultsPreview, defaultsPublish] = await Promise.all([
      preview(cookie, defaults.id, defaults.draftVersion),
      publish(cookie, defaults.id, defaults.draftVersion, null),
    ]);
    const expected = {
      status: "error",
      code: "PUBLICATION_INVALID",
      issues: [
        {
          code: "BYLINE_INVALID",
          path: "draft.byline",
          message: "A valid Byline is required for publication.",
        },
        {
          code: "LANGUAGE_INVALID",
          path: "draft.language",
          message: "A valid language is required for publication.",
        },
      ],
    };
    expect(defaultsPreview.status).toBe(400);
    expect(defaultsPublish.status).toBe(400);
    expect(await defaultsPreview.json()).toEqual(expected);
    expect(await defaultsPublish.json()).toEqual(expected);
  }, 30_000);

  it("applies identical persisted-to-R2 Asset fact verification to Preview and Publish", async () => {
    const cookie = await initializeAndSignIn();
    const article = await createSavedArticle(cookie, "asset-fact-parity");
    const asset = await uploadOnePixelPngAsset(cookie, "fact-parity.png");
    const saved = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${article.id}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          version: article.draftVersion,
          title: "Asset fact parity",
          slug: "asset-fact-parity",
          summary: null,
          tags: [],
          byline: null,
          language: null,
          document: {
            documentSchemaVersion: 1,
            doc: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Asset body" }],
                },
                {
                  type: "figure",
                  attrs: {
                    assetId: asset.id,
                    alt: "Verified Asset",
                    decorative: false,
                    caption: null,
                  },
                },
              ],
            },
          },
        }),
      },
    );
    expect(saved.status).toBe(200);
    await env.DB.prepare(
      "UPDATE asset SET byte_size = byte_size + 1 WHERE id = ?",
    )
      .bind(asset.id)
      .run();

    const [previewResponse, publishResponse] = await Promise.all([
      preview(cookie, article.id, 3),
      publish(cookie, article.id, 3, null),
    ]);
    const expected = {
      status: "error",
      code: "PUBLICATION_INVALID",
      issues: [
        {
          code: "ASSET_NOT_RESOLVED",
          path: `draft.assets.${asset.id}`,
          message: "A referenced Asset is unavailable for publication.",
        },
      ],
    };
    expect(previewResponse.status).toBe(400);
    expect(publishResponse.status).toBe(400);
    expect(await previewResponse.json()).toEqual(expected);
    expect(await publishResponse.json()).toEqual(expected);
    expect(
      await env.DB.prepare("SELECT public_asset_id FROM asset WHERE id = ?")
        .bind(asset.id)
        .first(),
    ).toEqual({ public_asset_id: null });
  }, 20_000);

  it("reports the same unsafe issue for corrupted persisted Asset delivery facts", async () => {
    const cookie = await initializeAndSignIn();
    const article = await createSavedArticle(cookie, "unsafe-asset-facts");
    const asset = await uploadOnePixelPngAsset(cookie, "unsafe-facts.png");
    const saved = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${article.id}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          version: article.draftVersion,
          title: "Unsafe Asset facts",
          slug: "unsafe-asset-facts",
          summary: null,
          tags: [],
          byline: null,
          language: null,
          document: {
            documentSchemaVersion: 1,
            doc: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Asset body" }],
                },
                {
                  type: "figure",
                  attrs: {
                    assetId: asset.id,
                    alt: "Unsafe Asset facts",
                    decorative: false,
                    caption: null,
                  },
                },
              ],
            },
          },
        }),
      },
    );
    expect(saved.status).toBe(200);
    await env.DB.prepare("UPDATE asset SET width = 9000 WHERE id = ?")
      .bind(asset.id)
      .run();

    const [previewResponse, publishResponse] = await Promise.all([
      preview(cookie, article.id, 3),
      publish(cookie, article.id, 3, null),
    ]);
    const expected = {
      status: "error",
      code: "PUBLICATION_INVALID",
      issues: [
        {
          code: "INVALID_ASSET_RESOLUTION",
          path: `draft.assets.${asset.id}`,
          message: "A referenced Asset has unsafe delivery facts.",
        },
      ],
    };
    expect(previewResponse.status).toBe(400);
    expect(publishResponse.status).toBe(400);
    expect(await previewResponse.json()).toEqual(expected);
    expect(await publishResponse.json()).toEqual(expected);
    expect(
      await env.DB.prepare("SELECT public_asset_id FROM asset WHERE id = ?")
        .bind(asset.id)
        .first(),
    ).toEqual({ public_asset_id: null });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM publication WHERE article_id = ?",
      )
        .bind(article.id)
        .first(),
    ).toEqual({ count: 0 });

    const stored = await env.DB.prepare(
      "SELECT object_key FROM asset WHERE id = ?",
    )
      .bind(asset.id)
      .first<{ object_key: string }>();
    await env.MEDIA_BUCKET.delete(stored!.object_key);
    const [missingPreview, missingPublish] = await Promise.all([
      preview(cookie, article.id, 3),
      publish(cookie, article.id, 3, null),
    ]);
    const unavailable = {
      status: "error",
      code: "PUBLICATION_INVALID",
      issues: [
        {
          code: "ASSET_NOT_RESOLVED",
          path: `draft.assets.${asset.id}`,
          message: "A referenced Asset is unavailable for publication.",
        },
      ],
    };
    expect(missingPreview.status).toBe(400);
    expect(missingPublish.status).toBe(400);
    expect(await missingPreview.json()).toEqual(unavailable);
    expect(await missingPublish.json()).toEqual(unavailable);
  }, 20_000);

  it("returns a confirmed receipt whose Public Article matches the first anonymous read", async () => {
    const cookie = await initializeAndSignIn();
    const article = await (
      await SELF.fetch("http://briefly.test/api/admin/articles", {
        method: "POST",
        headers: { cookie },
      })
    ).json<{ id: string }>();
    const saved = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${article.id}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          title: "Confirmed receipt",
          slug: "confirmed-receipt",
          summary: "One public projection",
          tags: ["Workflow"],
          byline: null,
          language: null,
          document: {
            documentSchemaVersion: 1,
            doc: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Confirmed body" }],
                },
              ],
            },
          },
        }),
      },
    );
    expect(saved.status).toBe(200);

    const published = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${article.id}/publications`,
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
    const receipt = await published.json<{
      publicationId: string;
      draftVersion: number;
      article: Record<string, unknown>;
    }>();
    expect(receipt).toMatchObject({
      publicationId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      ),
      draftVersion: 2,
      article: {
        id: article.id,
        slug: "confirmed-receipt",
        title: "Confirmed receipt",
        summary: "One public projection",
        tags: ["workflow"],
        byline: { name: "Briefly", url: null },
        language: "en",
        cover: null,
        html: "<p>Confirmed body</p>",
      },
    });
    const anonymous = await SELF.fetch(
      "http://briefly.test/api/articles/confirmed-receipt",
    );
    expect(anonymous.status).toBe(200);
    expect(await anonymous.json()).toEqual(receipt.article);
  }, 20_000);

  it("uses endpoint-scoped request validation before Publication preparation", async () => {
    const cookie = await initializeAndSignIn();
    const article = await (
      await SELF.fetch("http://briefly.test/api/admin/articles", {
        method: "POST",
        headers: { cookie },
      })
    ).json<{ id: string }>();
    const requests = [
      SELF.fetch(
        `http://briefly.test/api/admin/articles/${article.id}/preview`,
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ draftVersion: 1.5 }),
        },
      ),
      SELF.fetch(
        `http://briefly.test/api/admin/articles/${article.id}/publications`,
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({
            draftVersion: 1,
            expectedCurrentPublicationId: "not-a-publication-id",
          }),
        },
      ),
      SELF.fetch(
        "http://briefly.test/api/admin/articles/not-an-article-id/preview",
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ draftVersion: 1 }),
        },
      ),
    ];

    for (const request of requests) {
      const response = await request;
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        status: "error",
        code: "REQUEST_INVALID",
      });
    }
  }, 20_000);

  it("conflicts against a stale Current Publication baseline even when the Draft is unchanged", async () => {
    const cookie = await initializeAndSignIn();
    const article = await createSavedArticle(cookie, "stale-public-baseline");
    const first = await publish(cookie, article.id, article.draftVersion, null);
    expect(first.status).toBe(201);
    const receipt = await first.json<{ publicationId: string }>();

    const stale = await publish(cookie, article.id, article.draftVersion, null);

    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      status: "error",
      code: "PUBLICATION_CONFLICT",
    });
    expect(
      await env.DB.prepare(
        "SELECT id FROM publication WHERE article_id = ? ORDER BY publication_number",
      )
        .bind(article.id)
        .all(),
    ).toEqual({
      results: [{ id: receipt.publicationId }],
      success: true,
      meta: expect.any(Object),
    });
  }, 20_000);

  it("gives exactly one winner to simultaneous first-Publish and Republish commands", async () => {
    const cookie = await initializeAndSignIn();
    const article = await createSavedArticle(cookie, "concurrent-publication");

    const firstPair = await Promise.all([
      publish(cookie, article.id, article.draftVersion, null),
      publish(cookie, article.id, article.draftVersion, null),
    ]);
    expect(firstPair.map(({ status }) => status).sort()).toEqual([201, 409]);
    const firstWinner = firstPair.find(({ status }) => status === 201)!;
    const firstReceipt = await firstWinner.json<{ publicationId: string }>();
    expect(
      await firstPair.find(({ status }) => status === 409)!.json(),
    ).toEqual({ status: "error", code: "PUBLICATION_CONFLICT" });

    const revised = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${article.id}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          version: article.draftVersion,
          title: "Concurrent replacement",
          slug: "concurrent-replacement",
          summary: null,
          tags: [],
          byline: null,
          language: null,
          document: textDocument("Concurrent replacement body"),
        }),
      },
    );
    expect(revised.status).toBe(200);

    const republishPair = await Promise.all([
      publish(cookie, article.id, 3, firstReceipt.publicationId),
      publish(cookie, article.id, 3, firstReceipt.publicationId),
    ]);
    expect(republishPair.map(({ status }) => status).sort()).toEqual([
      201, 409,
    ]);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM publication WHERE article_id = ?",
      )
        .bind(article.id)
        .first(),
    ).toEqual({ count: 2 });
  }, 20_000);

  it("leaves no Publication side effects when the Draft or Article lifecycle changes during preparation", async () => {
    const cookie = await initializeAndSignIn();
    const cases = [
      {
        slug: "draft-changed-during-preparation",
        mutate: (articleId: string) =>
          env.DB.prepare(
            "UPDATE article_draft SET version = version + 1 WHERE article_id = ?",
          )
            .bind(articleId)
            .run(),
        status: 409,
        code: "PUBLICATION_CONFLICT",
      },
      {
        slug: "trashed-during-preparation",
        mutate: (articleId: string) =>
          env.DB.prepare("UPDATE article SET trashed_at = ? WHERE id = ?")
            .bind(Date.now(), articleId)
            .run(),
        status: 404,
        code: "ARTICLE_NOT_FOUND",
      },
    ];

    for (const fixture of cases) {
      const article = await createSavedArticle(cookie, fixture.slug);
      const database = databaseWithBatch((async (statements) => {
        await fixture.mutate(article.id);
        return env.DB.batch(statements);
      }) as D1Database["batch"]);

      const response = await fetchThroughWorker(
        `http://briefly.test/api/admin/articles/${article.id}/publications`,
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({
            draftVersion: article.draftVersion,
            expectedCurrentPublicationId: null,
          }),
        },
        { DB: database },
      );

      expect(response.status, fixture.slug).toBe(fixture.status);
      expect(await response.json(), fixture.slug).toEqual({
        status: "error",
        code: fixture.code,
      });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) AS count FROM publication WHERE article_id = ?",
        )
          .bind(article.id)
          .first(),
        fixture.slug,
      ).toEqual({ count: 0 });
      expect(
        await env.DB.prepare(
          "SELECT was_published FROM article_slug WHERE article_id = ?",
        )
          .bind(article.id)
          .first(),
        fixture.slug,
      ).toEqual({ was_published: 0 });
      expect(
        await env.DB.prepare(
          "SELECT current_publication_id FROM article WHERE id = ?",
        )
          .bind(article.id)
          .first(),
        fixture.slug,
      ).toEqual({ current_publication_id: null });
    }
  }, 20_000);

  it("classifies Asset adapter exceptions as not completed without exposing private values", async () => {
    const cookie = await initializeAndSignIn();
    const article = await createSavedArticle(cookie, "asset-adapter-failure");
    const asset = await uploadOnePixelPngAsset(cookie, "private-object.png");
    const privateBody = "private Draft content must stay private";
    const saved = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${article.id}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          version: article.draftVersion,
          title: "Asset adapter failure",
          slug: "asset-adapter-failure",
          summary: null,
          tags: [],
          byline: null,
          language: null,
          document: {
            documentSchemaVersion: 1,
            doc: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: privateBody }],
                },
                {
                  type: "figure",
                  attrs: {
                    assetId: asset.id,
                    alt: "Private figure",
                    decorative: false,
                    caption: null,
                  },
                },
              ],
            },
          },
        }),
      },
    );
    expect(saved.status).toBe(200);
    const privateDependencyValue = "private-object-key-and-r2-cause";
    const dependencyFailure = new Error(privateDependencyValue);
    dependencyFailure.name = privateDependencyValue;
    const bucket = Object.create(env.MEDIA_BUCKET) as R2Bucket;
    Object.defineProperty(bucket, "head", {
      value: () => Promise.reject(dependencyFailure),
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const [preview, attemptedPublish] = await Promise.all([
      fetchThroughWorker(
        `http://briefly.test/api/admin/articles/${article.id}/preview`,
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ draftVersion: 3 }),
        },
        { MEDIA_BUCKET: bucket },
      ),
      fetchThroughWorker(
        `http://briefly.test/api/admin/articles/${article.id}/publications`,
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({
            draftVersion: 3,
            expectedCurrentPublicationId: null,
          }),
        },
        { MEDIA_BUCKET: bucket },
      ),
    ]);

    for (const response of [preview, attemptedPublish]) {
      expect(response.status).toBe(503);
      const text = await response.text();
      expect(JSON.parse(text)).toMatchObject({
        status: "error",
        code: "PUBLICATION_NOT_COMPLETED",
      });
      expect(text).not.toContain(privateDependencyValue);
      expect(text).not.toContain(privateBody);
      expect(text).not.toContain(cookie);
    }
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain(
      privateDependencyValue,
    );
    const failureLogs = consoleError.mock.calls.map(([entry]) =>
      JSON.parse(String(entry)),
    ) as Array<Record<string, unknown>>;
    expect(failureLogs.map((log) => log.operation).sort()).toEqual([
      "publication.preview",
      "publication.publish",
    ]);
    for (const log of failureLogs) {
      expect(Object.keys(log).sort()).toEqual(
        [
          "code",
          "event",
          "method",
          "operation",
          "requestId",
          "status",
          "timestamp",
        ].sort(),
      );
      expect(log).toMatchObject({
        timestamp: expect.any(String),
        event: "publication.workflow.failed",
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
        method: "POST",
        status: 503,
        code: "PUBLICATION_NOT_COMPLETED",
      });
    }
    consoleError.mockRestore();
  }, 20_000);

  it("reports a confirmed atomic D1 rollback as not completed", async () => {
    const cookie = await initializeAndSignIn();
    const article = await createSavedArticle(cookie, "confirmed-rollback");
    await env.DB.prepare(
      `CREATE TRIGGER reject_publication_insert
       BEFORE INSERT ON publication
       BEGIN
         SELECT RAISE(ABORT, 'private forced publication failure');
       END`,
    ).run();

    let response: Response;
    try {
      response = await publish(cookie, article.id, article.draftVersion, null);
    } finally {
      await env.DB.prepare(
        "DROP TRIGGER IF EXISTS reject_publication_insert",
      ).run();
    }

    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({
      status: "error",
      code: "PUBLICATION_NOT_COMPLETED",
    });
    expect(text).not.toContain("private forced publication failure");
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM publication WHERE article_id = ?",
      )
        .bind(article.id)
        .first(),
    ).toEqual({ count: 0 });
    expect(
      await env.DB.prepare(
        "SELECT was_published FROM article_slug WHERE article_id = ?",
      )
        .bind(article.id)
        .first(),
    ).toEqual({ was_published: 0 });
  }, 20_000);

  it("reports a reconciled rollback as not completed when the batch result falsely reports success", async () => {
    const cookie = await initializeAndSignIn();
    const article = await createSavedArticle(cookie, "false-success-result");
    const database = databaseWithBatch((async (statements) =>
      statements.map(
        () => ({ meta: { changes: 1 } }) as D1Result<unknown>,
      )) as D1Database["batch"]);

    const response = await fetchThroughWorker(
      `http://briefly.test/api/admin/articles/${article.id}/publications`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          draftVersion: article.draftVersion,
          expectedCurrentPublicationId: null,
        }),
      },
      { DB: database },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "error",
      code: "PUBLICATION_NOT_COMPLETED",
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM publication WHERE article_id = ?",
      )
        .bind(article.id)
        .first(),
    ).toEqual({ count: 0 });
  }, 20_000);

  it("does not misclassify an unexecuted command with a false guard-miss result as a Conflict", async () => {
    const cookie = await initializeAndSignIn();
    const article = await createSavedArticle(cookie, "false-guard-miss");
    const database = databaseWithBatch((async (statements) =>
      statements.map(
        () => ({ meta: { changes: 0 } }) as D1Result<unknown>,
      )) as D1Database["batch"]);

    const response = await fetchThroughWorker(
      `http://briefly.test/api/admin/articles/${article.id}/publications`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          draftVersion: article.draftVersion,
          expectedCurrentPublicationId: null,
        }),
      },
      { DB: database },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "error",
      code: "PUBLICATION_NOT_COMPLETED",
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM publication WHERE article_id = ?",
      )
        .bind(article.id)
        .first(),
    ).toEqual({ count: 0 });
  }, 20_000);

  it("recovers a confirmed Publication after its committed batch result is lost", async () => {
    const cookie = await initializeAndSignIn();
    const article = await createSavedArticle(cookie, "lost-batch-result");
    const database = databaseWithBatch((async (statements) => {
      await env.DB.batch(statements);
      return [];
    }) as D1Database["batch"]);

    const response = await fetchThroughWorker(
      `http://briefly.test/api/admin/articles/${article.id}/publications`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          draftVersion: article.draftVersion,
          expectedCurrentPublicationId: null,
        }),
      },
      { DB: database },
    );

    expect(response.status).toBe(201);
    const receipt = await response.json<{
      publicationId: string;
      draftVersion: number;
      article: unknown;
    }>();
    expect(receipt).toMatchObject({
      draftVersion: article.draftVersion,
      article: { id: article.id, slug: "lost-batch-result" },
    });
    const anonymous = await SELF.fetch(
      "http://briefly.test/api/articles/lost-batch-result",
    );
    expect(anonymous.status).toBe(200);
    expect(await anonymous.json()).toEqual(receipt.article);
  }, 20_000);

  it("recovers a confirmed Publication when its committed batch result falsely reports a guard miss", async () => {
    const cookie = await initializeAndSignIn();
    const article = await createSavedArticle(cookie, "altered-batch-result");
    const database = databaseWithBatch((async (statements) => {
      const results = await env.DB.batch(statements);
      return results.map((result) => ({
        ...result,
        meta: { ...result.meta, changes: 0 },
      }));
    }) as D1Database["batch"]);

    const response = await fetchThroughWorker(
      `http://briefly.test/api/admin/articles/${article.id}/publications`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          draftVersion: article.draftVersion,
          expectedCurrentPublicationId: null,
        }),
      },
      { DB: database },
    );

    expect(response.status).toBe(201);
    const receipt = await response.json<{
      publicationId: string;
      draftVersion: number;
      article: unknown;
    }>();
    expect(receipt).toMatchObject({
      draftVersion: article.draftVersion,
      article: { id: article.id, slug: "altered-batch-result" },
    });
    expect(
      await env.DB.prepare(
        "SELECT current_publication_id FROM article WHERE id = ?",
      )
        .bind(article.id)
        .first(),
    ).toEqual({ current_publication_id: receipt.publicationId });
  }, 20_000);

  it("reports a committed but undecodable public state as unconfirmed", async () => {
    const cookie = await initializeAndSignIn();
    const article = await createSavedArticle(cookie, "unconfirmed-state");
    const privateCorruption = "private-corrupted-publication-value";
    const database = databaseWithBatch((async (statements) => {
      const results = await env.DB.batch(statements);
      const current = await env.DB.prepare(
        "SELECT current_publication_id FROM article WHERE id = ?",
      )
        .bind(article.id)
        .first<{ current_publication_id: string | null }>();
      expect(current?.current_publication_id).not.toBeNull();
      await env.DB.prepare("UPDATE publication SET byline = ? WHERE id = ?")
        .bind(privateCorruption, current!.current_publication_id)
        .run();
      return results;
    }) as D1Database["batch"]);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const response = await fetchThroughWorker(
      `http://briefly.test/api/admin/articles/${article.id}/publications`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          draftVersion: article.draftVersion,
          expectedCurrentPublicationId: null,
        }),
      },
      { DB: database },
    );

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({
      status: "error",
      code: "PUBLICATION_STATE_UNCONFIRMED",
    });
    expect(text).not.toContain(privateCorruption);
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain(
      privateCorruption,
    );
    consoleError.mockRestore();
    expect(
      await env.DB.prepare(
        "SELECT current_publication_id FROM article WHERE id = ?",
      )
        .bind(article.id)
        .first(),
    ).toMatchObject({ current_publication_id: expect.any(String) });
  }, 20_000);
});
