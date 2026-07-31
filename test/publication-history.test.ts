import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import type { Article } from "../src/articles/articles";
import { initializeAndSignIn } from "./administrator-fixture";
import { uploadOnePixelPngAsset } from "./asset-fixture";

interface DraftPayload {
  version: number;
  title: string;
  slug: string;
  summary: string | null;
  tags: string[];
  byline: { name: string; url: string | null } | null;
  language: string | null;
  cover: { assetId: string; alt: string } | null;
  document: unknown;
}

interface PublicationHistoryEntry {
  id: string;
  publicationNumber: number;
  title: string;
  slug: string;
  publishedAt: string;
  isCurrent: boolean;
}

interface PublicationHistory {
  publications: PublicationHistoryEntry[];
  hasUnpublishedChanges: boolean;
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

function figureDocument(text: string, assetId: string) {
  return {
    documentSchemaVersion: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text }],
        },
        {
          type: "figure",
          attrs: {
            assetId,
            alt: "Historical figure alternative text",
            caption: "Historical figure caption",
            decorative: false,
          },
        },
      ],
    },
  };
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
  payload: DraftPayload,
): Promise<Response> {
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
  draftVersion: number,
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

function listHistory(cookie: string, articleId: string): Promise<Response> {
  return SELF.fetch(
    `http://briefly.test/api/admin/articles/${articleId}/publications`,
    { headers: { cookie } },
  );
}

function restorePublication(
  cookie: string,
  articleId: string,
  publicationId: string,
  draftVersion: number,
  confirmDiscardUnpublishedChanges: boolean,
): Promise<Response> {
  return SELF.fetch(
    `http://briefly.test/api/admin/articles/${articleId}/publications/${publicationId}/restore`,
    {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        draftVersion,
        confirmDiscardUnpublishedChanges,
      }),
    },
  );
}

async function readPrivateArticle(
  cookie: string,
  articleId: string,
): Promise<Article> {
  const response = await SELF.fetch(
    `http://briefly.test/api/admin/articles/${articleId}`,
    { headers: { cookie } },
  );
  expect(response.status).toBe(200);
  return response.json<Article>();
}

async function publicationSnapshot(
  articleId: string,
  publicationNumber: number,
): Promise<Record<string, unknown> | null> {
  return env.DB.prepare(
    `SELECT id, article_id, slug, slug_key, publication_number, title,
            summary, tags, byline, language, cover, document_schema_version,
            document, renderer_version, provider_facts, html, published_at,
            created_at
     FROM publication
     WHERE article_id = ? AND publication_number = ?`,
  )
    .bind(articleId, publicationNumber)
    .first<Record<string, unknown>>();
}

async function publicationReferences(publicationId: string) {
  const { results } = await env.DB.prepare(
    `SELECT asset_id, public_asset_id, asset_lifecycle_state
     FROM publication_asset_reference
     WHERE publication_id = ?
     ORDER BY asset_id`,
  )
    .bind(publicationId)
    .all<Record<string, unknown>>();
  return results;
}

describe("Publication history and restore", () => {
  beforeEach(async () => {
    const { results } = await env.DB.prepare(
      "SELECT object_key FROM asset",
    ).all<{ object_key: string }>();
    await Promise.all(
      results.map(({ object_key }) => env.MEDIA_BUCKET.delete(object_key)),
    );
    await env.DB.batch([
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
      env.DB.prepare(
        `UPDATE site_settings
         SET site_name = 'Briefly', site_description = NULL,
             default_byline_name = 'Briefly', default_byline_url = NULL,
             default_language = 'en'
         WHERE id = 1`,
      ),
    ]);
  });

  it("lists every retained Publication in deterministic newest-first order without autosaves", async () => {
    const cookie = await initializeAndSignIn();
    const articleId = await createArticle(cookie);

    const firstSave = await saveDraft(cookie, articleId, {
      version: 1,
      title: "First retained Publication",
      slug: "first-retained-publication",
      summary: null,
      tags: ["history"],
      byline: null,
      language: null,
      cover: null,
      document: textDocument("First retained body"),
    });
    expect(firstSave.status).toBe(200);
    expect((await publish(cookie, articleId, 2)).status).toBe(201);

    const autosave = await saveDraft(cookie, articleId, {
      version: 2,
      title: "Autosave only",
      slug: "autosave-only",
      summary: "This is not a Publication",
      tags: ["private"],
      byline: null,
      language: null,
      cover: null,
      document: textDocument("Private autosave body"),
    });
    expect(autosave.status).toBe(200);
    const secondSave = await saveDraft(cookie, articleId, {
      version: 3,
      title: "Second retained Publication",
      slug: "second-retained-publication",
      summary: "Second summary",
      tags: ["history", "second"],
      byline: null,
      language: null,
      cover: null,
      document: textDocument("Second retained body"),
    });
    expect(secondSave.status).toBe(200);
    expect((await publish(cookie, articleId, 4)).status).toBe(201);

    const response = await listHistory(cookie, articleId);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const history = await response.json<PublicationHistory>();
    expect(history.hasUnpublishedChanges).toBe(false);
    expect(history.publications).toHaveLength(2);
    expect(history.publications).toMatchObject([
      {
        publicationNumber: 2,
        title: "Second retained Publication",
        slug: "second-retained-publication",
        publishedAt: expect.any(String),
        isCurrent: true,
      },
      {
        publicationNumber: 1,
        title: "First retained Publication",
        slug: "first-retained-publication",
        publishedAt: expect.any(String),
        isCurrent: false,
      },
    ]);
    expect(history.publications.every(({ id }) => id.length > 0)).toBe(true);
    expect(JSON.stringify(history)).not.toContain("Autosave only");
    expect(JSON.stringify(history)).not.toContain("Private autosave body");
  }, 20_000);

  it("restores one immutable source completely, preserves public output, and republishes as the next Publication", async () => {
    const cookie = await initializeAndSignIn();
    const articleId = await createArticle(cookie);
    const historicalCover = await uploadOnePixelPngAsset(
      cookie,
      "historical-cover.png",
    );
    const historicalFigure = await uploadOnePixelPngAsset(
      cookie,
      "historical-figure.png",
    );
    const currentAsset = await uploadOnePixelPngAsset(cookie, "current.png");
    const historicalDocument = figureDocument(
      "Historical body",
      historicalFigure.id,
    );
    const historicalCoverUsage = {
      assetId: historicalCover.id,
      alt: "Historical cover alternative text",
    };

    expect(
      (
        await saveDraft(cookie, articleId, {
          version: 1,
          title: "Historical title",
          slug: "historical-slug",
          summary: null,
          tags: ["history", "original"],
          byline: {
            name: "Historical Writer",
            url: "https://example.com/writers/historical",
          },
          language: "zh-Hans",
          cover: historicalCoverUsage,
          document: historicalDocument,
        })
      ).status,
    ).toBe(200);
    const firstPublish = await publish(cookie, articleId, 2);
    expect(firstPublish.status).toBe(201);
    const firstPublic = await firstPublish.json<{
      publishedAt: string;
      updatedAt: string;
    }>();

    expect(
      (
        await saveDraft(cookie, articleId, {
          version: 2,
          title: "Current public title",
          slug: "current-public-slug",
          summary: "Current public summary",
          tags: ["current"],
          byline: {
            name: "Current Writer",
            url: null,
          },
          language: "en-GB",
          cover: {
            assetId: currentAsset.id,
            alt: "Current cover alternative text",
          },
          document: textDocument("Current public body"),
        })
      ).status,
    ).toBe(200);
    expect((await publish(cookie, articleId, 3)).status).toBe(201);

    const historyResponse = await listHistory(cookie, articleId);
    expect(historyResponse.status).toBe(200);
    const historyBefore = await historyResponse.json<PublicationHistory>();
    const historical = historyBefore.publications.find(
      ({ publicationNumber }) => publicationNumber === 1,
    );
    const formerlyCurrent = historyBefore.publications.find(
      ({ publicationNumber }) => publicationNumber === 2,
    );
    if (!historical || !formerlyCurrent)
      throw new Error("Expected two Publications");
    const firstSnapshot = await publicationSnapshot(articleId, 1);
    const secondSnapshot = await publicationSnapshot(articleId, 2);
    const firstReferences = await publicationReferences(historical.id);
    const secondReferences = await publicationReferences(formerlyCurrent.id);

    const privateSave = await saveDraft(cookie, articleId, {
      version: 3,
      title: "Unpublished replacement",
      slug: "unpublished-replacement",
      summary: "Must require confirmation",
      tags: ["private"],
      byline: null,
      language: null,
      cover: {
        assetId: currentAsset.id,
        alt: "Private cover alternative text",
      },
      document: textDocument("Unpublished replacement body"),
    });
    expect(privateSave.status).toBe(200);
    const beforeRestore = await readPrivateArticle(cookie, articleId);
    expect(beforeRestore.draft.version).toBe(4);

    const publicDetailBefore = await SELF.fetch(
      "http://briefly.test/api/articles/current-public-slug",
    );
    const publicDetailBeforeJson = await publicDetailBefore.clone().json();
    const publicListBefore = await (
      await SELF.fetch("http://briefly.test/api/articles")
    ).json();

    const stale = await restorePublication(
      cookie,
      articleId,
      historical.id,
      3,
      true,
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      status: "error",
      code: "ARTICLE_DRAFT_VERSION_CONFLICT",
    });

    const unconfirmed = await restorePublication(
      cookie,
      articleId,
      historical.id,
      4,
      false,
    );
    expect(unconfirmed.status).toBe(409);
    expect(await unconfirmed.json()).toEqual({
      status: "error",
      code: "ARTICLE_DRAFT_RESTORE_CONFIRMATION_REQUIRED",
    });
    expect(await readPrivateArticle(cookie, articleId)).toEqual(beforeRestore);

    const restoredResponse = await restorePublication(
      cookie,
      articleId,
      historical.id,
      4,
      true,
    );

    expect(restoredResponse.status).toBe(200);
    expect(restoredResponse.headers.get("cache-control")).toBe("no-store");
    const restored = await restoredResponse.json<Article>();
    expect(restored).toMatchObject({
      id: articleId,
      currentPublicationId: beforeRestore.currentPublicationId,
      createdAt: beforeRestore.createdAt,
      updatedAt: beforeRestore.updatedAt,
      draft: {
        version: 5,
        title: "Historical title",
        slug: "historical-slug",
        summary: null,
        tags: ["history", "original"],
        byline: {
          name: "Historical Writer",
          url: "https://example.com/writers/historical",
        },
        language: "zh-Hans",
        cover: historicalCoverUsage,
        document: historicalDocument,
      },
    });

    const publicDetailAfter = await SELF.fetch(
      "http://briefly.test/api/articles/current-public-slug",
    );
    expect(await publicDetailAfter.json()).toEqual(publicDetailBeforeJson);
    expect(
      await (await SELF.fetch("http://briefly.test/api/articles")).json(),
    ).toEqual(publicListBefore);

    const restoredDraftReferences = await env.DB.prepare(
      `SELECT asset_id
       FROM article_draft_asset_reference
       WHERE article_id = ?
       ORDER BY asset_id`,
    )
      .bind(articleId)
      .all<{ asset_id: string }>();
    expect(
      restoredDraftReferences.results.map(({ asset_id }) => asset_id),
    ).toEqual([historicalCover.id, historicalFigure.id].sort());

    const preview = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${articleId}/preview`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ version: 5 }),
      },
    );
    expect(preview.status).toBe(200);
    const previewText = await preview.text();
    expect(previewText).toContain("Historical body");
    expect(previewText).toContain(`/media/private/${historicalCover.id}`);
    expect(previewText).toContain(`/media/private/${historicalFigure.id}`);

    const historyAfterRestore = await (
      await listHistory(cookie, articleId)
    ).json<PublicationHistory>();
    expect(historyAfterRestore.publications).toEqual(
      historyBefore.publications,
    );
    expect(historyAfterRestore.hasUnpublishedChanges).toBe(true);

    const republished = await publish(cookie, articleId, 5);
    expect(republished.status).toBe(201);
    expect(await republished.json()).toMatchObject({
      title: "Historical title",
      slug: "historical-slug",
      summary: null,
      tags: ["history", "original"],
      byline: {
        name: "Historical Writer",
        url: "https://example.com/writers/historical",
      },
      language: "zh-Hans",
      publishedAt: firstPublic.publishedAt,
      html: expect.stringContaining("Historical body"),
    });
    const historyAfterRepublish = await (
      await listHistory(cookie, articleId)
    ).json<PublicationHistory>();
    expect(
      historyAfterRepublish.publications.map(
        ({ publicationNumber }) => publicationNumber,
      ),
    ).toEqual([3, 2, 1]);
    expect(historyAfterRepublish.hasUnpublishedChanges).toBe(false);
    expect(await publicationSnapshot(articleId, 1)).toEqual(firstSnapshot);
    expect(await publicationSnapshot(articleId, 2)).toEqual(secondSnapshot);
    expect(await publicationReferences(historical.id)).toEqual(firstReferences);
    expect(await publicationReferences(formerlyCurrent.id)).toEqual(
      secondReferences,
    );
  }, 30_000);

  it("reports a structured conversion issue without changing the Draft", async () => {
    const cookie = await initializeAndSignIn();
    const articleId = await createArticle(cookie);
    expect(
      (
        await saveDraft(cookie, articleId, {
          version: 1,
          title: "Unsupported historical source",
          slug: "unsupported-historical-source",
          summary: null,
          tags: [],
          byline: null,
          language: null,
          cover: null,
          document: textDocument("Safe stored HTML"),
        })
      ).status,
    ).toBe(200);
    expect((await publish(cookie, articleId, 2)).status).toBe(201);
    const history = await (
      await listHistory(cookie, articleId)
    ).json<PublicationHistory>();
    const source = history.publications[0];
    if (!source) throw new Error("Expected a Publication");
    await env.DB.prepare(
      `UPDATE publication
       SET document_schema_version = 999, document = ?
       WHERE id = ?`,
    )
      .bind(
        JSON.stringify({
          documentSchemaVersion: 999,
          doc: {
            type: "doc",
            content: [{ type: "futurePrivateNode", secret: "do not expose" }],
          },
        }),
        source.id,
      )
      .run();
    const before = await readPrivateArticle(cookie, articleId);

    const response = await restorePublication(
      cookie,
      articleId,
      source.id,
      2,
      true,
    );

    expect(response.status).toBe(400);
    const responseText = await response.text();
    expect(JSON.parse(responseText)).toEqual({
      status: "error",
      code: "PUBLICATION_RESTORE_INVALID",
      issues: [
        {
          code: "UNSUPPORTED_DOCUMENT_SCHEMA_VERSION",
          path: "document.documentSchemaVersion",
          message:
            "Publication Document Schema Version 999 cannot be migrated safely",
        },
      ],
    });
    expect(responseText).not.toContain("do not expose");
    expect(await readPrivateArticle(cookie, articleId)).toEqual(before);
    expect((await listHistory(cookie, articleId)).status).toBe(200);
    expect(
      (
        await SELF.fetch(
          "http://briefly.test/api/articles/unsupported-historical-source",
        )
      ).status,
    ).toBe(200);
  }, 20_000);

  it("requires an Administrator session for both history operations", async () => {
    const articleId = "00000000-0000-4000-8000-000000000000";
    const publicationId = "00000000-0000-4000-8000-000000000001";

    const history = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${articleId}/publications`,
    );
    const restore = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${articleId}/publications/${publicationId}/restore`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          draftVersion: 1,
          confirmDiscardUnpublishedChanges: true,
        }),
      },
    );

    for (const response of [history, restore]) {
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        status: "error",
        code: "AUTHENTICATION_REQUIRED",
      });
    }
  });

  it("presents a route-local destructive warning and explicit restore confirmation", async () => {
    const cookie = await initializeAndSignIn();

    const response = await SELF.fetch("http://briefly.test/admin", {
      headers: { cookie },
    });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Publication History");
    expect(html).toContain("Load retained Publications");
    expect(html).toContain("unpublished Draft changes");
    expect(html).toContain("permanently replaces the current Draft");
    expect(html).toContain("Confirm and restore Publication");
    expect(html).toContain("preview the restored Draft before publishing");
  }, 20_000);
});
