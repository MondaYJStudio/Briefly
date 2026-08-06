import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import type {
  ArticleDocument,
  ArticleDraftUpdate,
  ArticlePublicationHistory,
} from "../src/articles/articles";
import type { AssetLibraryEntry } from "../src/assets/assets";
import { initializeAndSignIn } from "./administrator-fixture";
import { uploadOnePixelPngAsset } from "./asset-fixture";

function textDocument(text: string): ArticleDocument {
  return {
    documentSchemaVersion: 1,
    doc: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    },
  };
}

function figureDocument(assetId: string, text: string): ArticleDocument {
  return {
    documentSchemaVersion: 1,
    doc: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text }] },
        {
          type: "figure",
          attrs: {
            assetId,
            alt: "Recoverable figure",
            caption: "Recoverable caption",
            decorative: false,
          },
        },
      ],
    },
  };
}

async function createSavedArticle(
  cookie: string,
  options: Partial<Omit<ArticleDraftUpdate, "version">> = {},
): Promise<{ id: string; draftVersion: number }> {
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
        title: "Recoverable Article",
        slug: "recoverable-article",
        summary: null,
        tags: [],
        byline: null,
        language: null,
        cover: null,
        document: textDocument("Recoverable Draft body"),
        ...options,
      }),
    },
  );
  expect(saved.status).toBe(200);
  return { id, draftVersion: 2 };
}

async function publish(
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

describe("Article Trash and restore", () => {
  beforeEach(async () => {
    const { results } = await env.DB.prepare(
      "SELECT object_key FROM asset",
    ).all<{ object_key: string }>();
    await Promise.all(
      results.map(({ object_key }) => env.MEDIA_BUCKET.delete(object_key)),
    );
    await env.DB.batch([
      env.DB.prepare("DROP TRIGGER IF EXISTS reject_article_trash"),
      env.DB.prepare("DROP TRIGGER IF EXISTS reject_article_restore"),
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

  it("requires an Administrator session for the Trash view and both lifecycle commands", async () => {
    const articleId = "00000000-0000-4000-8000-000000000000";
    const requests = [
      SELF.fetch("http://briefly.test/api/admin/trash/articles"),
      SELF.fetch(`http://briefly.test/api/admin/articles/${articleId}/trash`, {
        method: "POST",
      }),
      SELF.fetch(
        `http://briefly.test/api/admin/trash/articles/${articleId}/restore`,
        { method: "POST" },
      ),
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

  it("moves public and unpublished Articles out of normal administration and public reads", async () => {
    const cookie = await initializeAndSignIn();
    const published = await createSavedArticle(cookie, {
      title: "Formerly public Article",
      slug: "formerly-public-article",
    });
    expect(
      (await publish(cookie, published.id, published.draftVersion, null))
        .status,
    ).toBe(201);
    const draftOnly = await createSavedArticle(cookie, {
      title: "Draft-only Article",
      slug: "draft-only-in-trash",
    });
    const publicListBefore = await SELF.fetch(
      "http://briefly.test/api/articles",
    );
    const publicDetailBefore = await SELF.fetch(
      "http://briefly.test/api/articles/formerly-public-article",
    );
    const listEtag = publicListBefore.headers.get("etag");
    const detailEtag = publicDetailBefore.headers.get("etag");
    expect(publicListBefore.status).toBe(200);
    expect(publicDetailBefore.status).toBe(200);
    expect(listEtag).toBeTruthy();
    expect(detailEtag).toBeTruthy();

    const trashedPublished = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${published.id}/trash`,
      { method: "POST", headers: { cookie } },
    );
    const trashedDraft = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${draftOnly.id}/trash`,
      { method: "POST", headers: { cookie } },
    );

    for (const [response, id] of [
      [trashedPublished, published.id],
      [trashedDraft, draftOnly.id],
    ] as const) {
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        id,
        currentPublicationId: null,
        trashedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
    }

    const normalList = await SELF.fetch(
      "http://briefly.test/api/admin/articles",
      { headers: { cookie } },
    );
    expect(await normalList.json()).toEqual({ articles: [] });
    for (const id of [published.id, draftOnly.id]) {
      expect(
        (
          await SELF.fetch(`http://briefly.test/api/admin/articles/${id}`, {
            headers: { cookie },
          })
        ).status,
      ).toBe(404);
    }

    const trashView = await SELF.fetch(
      "http://briefly.test/api/admin/trash/articles",
      { headers: { cookie } },
    );
    expect(trashView.status).toBe(200);
    expect(await trashView.json()).toEqual({
      articles: expect.arrayContaining([
        expect.objectContaining({
          id: published.id,
          title: "Formerly public Article",
          slug: "formerly-public-article",
          draftVersion: 2,
          publicationCount: 1,
          currentPublicationId: null,
          trashedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        }),
        expect.objectContaining({
          id: draftOnly.id,
          title: "Draft-only Article",
          slug: "draft-only-in-trash",
          draftVersion: 2,
          publicationCount: 0,
          currentPublicationId: null,
          trashedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        }),
      ]),
    });

    const publicListAfter = await SELF.fetch(
      "http://briefly.test/api/articles",
      { headers: { "if-none-match": listEtag! } },
    );
    expect(publicListAfter.status).toBe(200);
    expect(publicListAfter.headers.get("etag")).not.toBe(listEtag);
    expect(await publicListAfter.json()).toEqual({
      items: [],
      nextCursor: null,
    });

    for (const response of await Promise.all([
      SELF.fetch("http://briefly.test/api/articles/formerly-public-article", {
        headers: { "if-none-match": detailEtag! },
      }),
      SELF.fetch("http://briefly.test/api/articles/formerly-public-article", {
        method: "HEAD",
        headers: { "if-none-match": detailEtag! },
      }),
    ])) {
      expect(response.status).toBe(404);
      expect(response.headers.get("etag")).toBeNull();
      expect(response.headers.get("cache-control")).toBe(
        "public, max-age=0, must-revalidate",
      );
    }
  }, 30_000);

  it("restores recoverable work as unpublished and requires another explicit publish", async () => {
    const cookie = await initializeAndSignIn();
    const asset = await uploadOnePixelPngAsset(cookie, "recoverable.png");
    const original = await createSavedArticle(cookie, {
      title: "Original public Article",
      slug: "original-public-article",
      cover: { assetId: asset.id, alt: "Recoverable cover" },
      document: figureDocument(asset.id, "Original public body"),
    });
    const firstPublication = await publish(
      cookie,
      original.id,
      original.draftVersion,
      null,
    );
    expect(firstPublication.status).toBe(201);
    const { article: firstPublic } = await firstPublication.json<{
      article: { cover: { url: string } };
    }>();

    const revisedDraft = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${original.id}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          version: 2,
          title: "Recoverable unpublished changes",
          slug: "restored-and-published-again",
          summary: "Saved after the first Publication",
          tags: ["trash", "restore"],
          byline: null,
          language: null,
          cover: { assetId: asset.id, alt: "Recoverable cover" },
          document: figureDocument(asset.id, "Recovered Draft body"),
        }),
      },
    );
    expect(revisedDraft.status).toBe(200);
    expect(await revisedDraft.json()).toMatchObject({
      currentPublicationId: expect.any(String),
      draft: {
        version: 3,
        title: "Recoverable unpublished changes",
        slug: "restored-and-published-again",
      },
    });

    const trashed = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${original.id}/trash`,
      { method: "POST", headers: { cookie } },
    );
    expect(trashed.status).toBe(200);

    const publicMedia = await SELF.fetch(firstPublic.cover.url);
    expect(publicMedia.status).toBe(200);
    expect(publicMedia.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    const assetLibrary = await SELF.fetch(
      "http://briefly.test/api/admin/assets",
      { headers: { cookie } },
    );
    const { assets } = await assetLibrary.json<{
      assets: AssetLibraryEntry[];
    }>();
    expect(assets.find(({ id }) => id === asset.id)?.references).toEqual({
      currentDrafts: 1,
      retainedPublications: 1,
    });
    const blockedCleanup = await SELF.fetch(
      `http://briefly.test/api/admin/assets/${asset.id}`,
      { method: "DELETE", headers: { cookie } },
    );
    expect(blockedCleanup.status).toBe(409);
    expect(await blockedCleanup.json()).toMatchObject({
      status: "error",
      code: "ASSET_CLEANUP_BLOCKED",
      references: { currentDrafts: 1, retainedPublications: 1 },
    });

    const restored = await SELF.fetch(
      `http://briefly.test/api/admin/trash/articles/${original.id}/restore`,
      { method: "POST", headers: { cookie } },
    );
    expect(restored.status).toBe(200);
    expect(restored.headers.get("cache-control")).toBe("no-store");
    expect(await restored.json()).toEqual({
      id: original.id,
      currentPublicationId: null,
    });

    const restoredArticle = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${original.id}`,
      { headers: { cookie } },
    );
    expect(restoredArticle.status).toBe(200);
    expect(await restoredArticle.json()).toMatchObject({
      id: original.id,
      currentPublicationId: null,
      draft: {
        version: 3,
        title: "Recoverable unpublished changes",
        slug: "restored-and-published-again",
        document: figureDocument(asset.id, "Recovered Draft body"),
      },
    });
    const trashAfterRestore = await SELF.fetch(
      "http://briefly.test/api/admin/trash/articles",
      { headers: { cookie } },
    );
    expect(await trashAfterRestore.json()).toEqual({ articles: [] });

    const historyResponse = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${original.id}/publications`,
      { headers: { cookie } },
    );
    expect(historyResponse.status).toBe(200);
    const history = await historyResponse.json<ArticlePublicationHistory>();
    expect(history.publications).toEqual([
      expect.objectContaining({
        publicationNumber: 1,
        title: "Original public Article",
        slug: "original-public-article",
        isCurrent: false,
      }),
    ]);
    expect(history.hasUnpublishedChanges).toBe(true);

    for (const slug of [
      "original-public-article",
      "restored-and-published-again",
    ]) {
      expect(
        (
          await SELF.fetch(`http://briefly.test/api/articles/${slug}`, {
            redirect: "manual",
          })
        ).status,
      ).toBe(404);
    }

    const publishedAgain = await publish(cookie, original.id, 3, null);
    expect(publishedAgain.status).toBe(201);
    expect(
      (await publishedAgain.json<{ article: unknown }>()).article,
    ).toMatchObject({
      slug: "restored-and-published-again",
      title: "Recoverable unpublished changes",
      html: expect.stringContaining("Recovered Draft body"),
    });
    const oldLocator = await SELF.fetch(
      "http://briefly.test/api/articles/original-public-article",
      { redirect: "manual" },
    );
    expect(oldLocator.status).toBe(308);
    expect(oldLocator.headers.get("location")).toBe(
      "/api/articles/restored-and-published-again",
    );
    const historyAfterPublish = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${original.id}/publications`,
      { headers: { cookie } },
    );
    expect(
      (
        await historyAfterPublish.json<ArticlePublicationHistory>()
      ).publications.map(({ publicationNumber }) => publicationNumber),
    ).toEqual([2, 1]);
  }, 30_000);

  it("preserves the complete prior lifecycle state when Trash or restore fails", async () => {
    const cookie = await initializeAndSignIn();
    const article = await createSavedArticle(cookie, {
      title: "Atomic lifecycle Article",
      slug: "atomic-trash-restore",
    });
    expect(
      (await publish(cookie, article.id, article.draftVersion, null)).status,
    ).toBe(201);
    await env.DB.prepare(
      `CREATE TRIGGER reject_article_trash
       BEFORE UPDATE OF trashed_at ON article
       WHEN OLD.trashed_at IS NULL AND NEW.trashed_at IS NOT NULL
       BEGIN
         SELECT RAISE(ABORT, 'forced Trash failure');
       END`,
    ).run();

    let failedTrash: Response;
    try {
      failedTrash = await SELF.fetch(
        `http://briefly.test/api/admin/articles/${article.id}/trash`,
        { method: "POST", headers: { cookie } },
      );
    } finally {
      await env.DB.prepare("DROP TRIGGER IF EXISTS reject_article_trash").run();
    }
    expect(failedTrash.status).toBe(500);
    expect(failedTrash.headers.get("cache-control")).toBe("no-store");
    expect(await failedTrash.json()).toEqual({
      status: "error",
      code: "INTERNAL_ERROR",
    });
    const stillNormal = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${article.id}`,
      { headers: { cookie } },
    );
    expect(stillNormal.status).toBe(200);
    expect(await stillNormal.json()).toMatchObject({
      id: article.id,
      currentPublicationId: expect.any(String),
    });
    expect(
      (
        await SELF.fetch(
          "http://briefly.test/api/articles/atomic-trash-restore",
        )
      ).status,
    ).toBe(200);
    expect(
      await (
        await SELF.fetch("http://briefly.test/api/admin/trash/articles", {
          headers: { cookie },
        })
      ).json(),
    ).toEqual({ articles: [] });

    expect(
      (
        await SELF.fetch(
          `http://briefly.test/api/admin/articles/${article.id}/trash`,
          { method: "POST", headers: { cookie } },
        )
      ).status,
    ).toBe(200);
    await env.DB.prepare(
      `CREATE TRIGGER reject_article_restore
       BEFORE UPDATE OF trashed_at ON article
       WHEN OLD.trashed_at IS NOT NULL AND NEW.trashed_at IS NULL
       BEGIN
         SELECT RAISE(ABORT, 'forced restore failure');
       END`,
    ).run();

    let failedRestore: Response;
    try {
      failedRestore = await SELF.fetch(
        `http://briefly.test/api/admin/trash/articles/${article.id}/restore`,
        { method: "POST", headers: { cookie } },
      );
    } finally {
      await env.DB.prepare(
        "DROP TRIGGER IF EXISTS reject_article_restore",
      ).run();
    }
    expect(failedRestore.status).toBe(500);
    expect(await failedRestore.json()).toEqual({
      status: "error",
      code: "INTERNAL_ERROR",
    });
    expect(
      (
        await SELF.fetch(
          `http://briefly.test/api/admin/articles/${article.id}`,
          { headers: { cookie } },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await SELF.fetch(
          "http://briefly.test/api/articles/atomic-trash-restore",
        )
      ).status,
    ).toBe(404);
    const stillTrashed = await SELF.fetch(
      "http://briefly.test/api/admin/trash/articles",
      { headers: { cookie } },
    );
    expect(await stillTrashed.json()).toEqual({
      articles: [expect.objectContaining({ id: article.id })],
    });
  }, 30_000);

  it("keeps normal administration operations outside the Trash scope", async () => {
    const cookie = await initializeAndSignIn();
    const article = await createSavedArticle(cookie, {
      title: "Unavailable while trashed",
      slug: "unavailable-while-trashed",
    });
    expect(
      (await publish(cookie, article.id, article.draftVersion, null)).status,
    ).toBe(201);
    const historyBefore = await (
      await SELF.fetch(
        `http://briefly.test/api/admin/articles/${article.id}/publications`,
        { headers: { cookie } },
      )
    ).json<ArticlePublicationHistory>();
    const publicationId = historyBefore.publications[0]?.id;
    if (!publicationId) throw new Error("Expected a retained Publication");
    expect(
      (
        await SELF.fetch(
          `http://briefly.test/api/admin/articles/${article.id}/trash`,
          { method: "POST", headers: { cookie } },
        )
      ).status,
    ).toBe(200);

    const unavailable = [
      await SELF.fetch(
        `http://briefly.test/api/admin/articles/${article.id}/draft`,
        {
          method: "PUT",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({
            version: 2,
            title: "Must remain unchanged",
            slug: "unavailable-while-trashed",
            summary: null,
            tags: [],
            byline: null,
            language: null,
            cover: null,
            document: textDocument("Must remain unchanged"),
          }),
        },
      ),
      await SELF.fetch(
        `http://briefly.test/api/admin/articles/${article.id}/preview`,
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ draftVersion: 2 }),
        },
      ),
      await publish(cookie, article.id, 2, null),
      await SELF.fetch(
        `http://briefly.test/api/admin/articles/${article.id}/publications`,
        { headers: { cookie } },
      ),
      await SELF.fetch(
        `http://briefly.test/api/admin/articles/${article.id}/publications/${publicationId}/restore`,
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({
            draftVersion: 2,
            confirmDiscardUnpublishedChanges: true,
          }),
        },
      ),
      await SELF.fetch(
        `http://briefly.test/api/admin/articles/${article.id}/current-publication`,
        { method: "DELETE", headers: { cookie } },
      ),
      await SELF.fetch(
        `http://briefly.test/api/admin/articles/${article.id}/trash`,
        { method: "POST", headers: { cookie } },
      ),
    ];
    for (const response of unavailable) {
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        status: "error",
        code: "ARTICLE_NOT_FOUND",
      });
    }
  }, 30_000);

  it("restores a Draft-only Article without making it public", async () => {
    const cookie = await initializeAndSignIn();
    const article = await createSavedArticle(cookie, {
      title: "Draft-only restoration",
      slug: "draft-only-restoration",
    });
    expect(
      (
        await SELF.fetch(
          `http://briefly.test/api/admin/articles/${article.id}/trash`,
          { method: "POST", headers: { cookie } },
        )
      ).status,
    ).toBe(200);

    const restored = await SELF.fetch(
      `http://briefly.test/api/admin/trash/articles/${article.id}/restore`,
      { method: "POST", headers: { cookie } },
    );
    expect(restored.status).toBe(200);
    expect(await restored.json()).toEqual({
      id: article.id,
      currentPublicationId: null,
    });
    const normalRead = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${article.id}`,
      { headers: { cookie } },
    );
    expect(normalRead.status).toBe(200);
    expect(await normalRead.json()).toMatchObject({
      id: article.id,
      currentPublicationId: null,
      draft: { version: 2, title: "Draft-only restoration" },
    });
    expect(
      (
        await SELF.fetch(
          "http://briefly.test/api/articles/draft-only-restoration",
        )
      ).status,
    ).toBe(404);
  }, 30_000);

  it("serves recoverable Articles from the dedicated Trash route", async () => {
    const cookie = await initializeAndSignIn();

    const response = await SELF.fetch("http://briefly.test/admin/trash", {
      headers: { cookie },
    });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('id="admin-main"');
    expect(html).toContain("Trash");
    expect(html).toContain("Restore or permanently delete trashed articles.");
    expect(html).toContain("Loading Trash");
  }, 30_000);
});
