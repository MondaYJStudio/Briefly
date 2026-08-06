import {
  SELF,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import type { ArticleDocument } from "../src/articles/articles";
import worker from "../src/server";
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
          content: [{ type: "text", text: "Asset-backed body" }],
        },
        {
          type: "figure",
          attrs: {
            assetId,
            alt: "A referenced figure",
            caption: null,
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

function saveDraftRequest(
  cookie: string,
  articleId: string,
  input: {
    version: number;
    slug: string;
    coverAssetId?: string;
    figureAssetId?: string;
  },
): Promise<Response> {
  return SELF.fetch(
    `http://briefly.test/api/admin/articles/${articleId}/draft`,
    {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        version: input.version,
        title: "Asset cleanup reference",
        slug: input.slug,
        summary: null,
        tags: [],
        byline: null,
        language: null,
        cover: input.coverAssetId
          ? { assetId: input.coverAssetId, alt: "A referenced cover" }
          : null,
        document: input.figureAssetId
          ? figureDocument(input.figureAssetId)
          : textDocument("Draft without media"),
      }),
    },
  );
}

async function saveDraft(
  cookie: string,
  articleId: string,
  input: {
    version: number;
    slug: string;
    coverAssetId?: string;
    figureAssetId?: string;
  },
): Promise<void> {
  const response = await saveDraftRequest(cookie, articleId, input);
  expect(response.status).toBe(200);
}

async function cleanupAsset(
  cookie: string,
  assetId: string,
  fetcher: (input: string, init: RequestInit) => Promise<Response> = (
    input,
    init,
  ) => SELF.fetch(input, init),
): Promise<Response> {
  return fetcher(`http://briefly.test/api/admin/assets/${assetId}`, {
    method: "DELETE",
    headers: { cookie },
  });
}

function bucketWithDeleteHook(
  onDelete: (objectKey: string) => Promise<void>,
): R2Bucket {
  const bucket = Object.create(env.MEDIA_BUCKET) as R2Bucket;
  Object.defineProperty(bucket, "delete", {
    value: async (objectKey: string | string[]) => {
      if (typeof objectKey !== "string")
        throw new Error("Expected one cleanup object key");
      await onDelete(objectKey);
    },
  });
  return bucket;
}

function bucketWithHeadHook(
  onHead: (objectKey: string) => Promise<R2Object | null>,
): R2Bucket {
  const bucket = Object.create(env.MEDIA_BUCKET) as R2Bucket;
  Object.defineProperty(bucket, "head", { value: onHead });
  return bucket;
}

async function fetchThroughWorker(
  input: string,
  init: RequestInit,
  bucket: R2Bucket,
): Promise<Response> {
  const context = createExecutionContext();
  const response = await worker.fetch(
    new Request(input, init) as Request<unknown, IncomingRequestCfProperties>,
    { ...env, MEDIA_BUCKET: bucket },
    context,
  );
  await waitOnExecutionContext(context);
  return response;
}

async function cleanupThroughWorker(
  cookie: string,
  assetId: string,
  bucket: R2Bucket,
): Promise<Response> {
  return cleanupAsset(cookie, assetId, (input, init) =>
    fetchThroughWorker(input, init, bucket),
  );
}

interface AssetLibraryEntry {
  id: string;
  lifecycleState: "pending_deletion" | "ready";
  failureCode: string | null;
  publicAssetId: string | null;
  references: {
    currentDrafts: number;
    retainedPublications: number;
  };
}

async function listAssets(cookie: string): Promise<AssetLibraryEntry[]> {
  const response = await SELF.fetch("http://briefly.test/api/admin/assets", {
    headers: { cookie },
  });
  expect(response.status).toBe(200);
  return (await response.json<{ assets: AssetLibraryEntry[] }>()).assets;
}

describe("Asset reference protection and cleanup", () => {
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
    ]);
  });

  it("requires an Administrator and exposes the dedicated Media route", async () => {
    const cookie = await initializeAndSignIn();
    const asset = await uploadOnePixelPngAsset(cookie, "protected-action.png");

    const anonymous = await cleanupAsset("", asset.id);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("cache-control")).toBe("no-store");
    expect(await anonymous.json()).toEqual({
      status: "error",
      code: "AUTHENTICATION_REQUIRED",
    });
    expect((await listAssets(cookie)).map(({ id }) => id)).toContain(asset.id);

    const admin = await SELF.fetch("http://briefly.test/admin/media", {
      headers: { cookie },
    });
    const html = await admin.text();
    expect(admin.status).toBe(200);
    expect(html).toContain('id="admin-main"');
    expect(html).toContain(">Media</h1>");
    expect(html).toContain("Images referenced by Drafts and Publications.");
  }, 60_000);

  it("reports Draft and retained Publication references and blocks both cleanup paths", async () => {
    const cookie = await initializeAndSignIn();
    const coverAsset = await uploadOnePixelPngAsset(cookie, "draft-cover.png");
    const figureAsset = await uploadOnePixelPngAsset(
      cookie,
      "draft-figure.png",
    );
    const historicalAsset = await uploadOnePixelPngAsset(
      cookie,
      "historical.png",
    );

    const privateArticleId = await createArticle(cookie);
    await saveDraft(cookie, privateArticleId, {
      version: 1,
      slug: "private-asset-references",
      coverAssetId: coverAsset.id,
      figureAssetId: figureAsset.id,
    });

    const historicalArticleId = await createArticle(cookie);
    await saveDraft(cookie, historicalArticleId, {
      version: 1,
      slug: "historical-asset-reference",
      figureAssetId: historicalAsset.id,
    });
    const published = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${historicalArticleId}/publications`,
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
    await saveDraft(cookie, historicalArticleId, {
      version: 2,
      slug: "historical-asset-reference",
    });
    const unpublished = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${historicalArticleId}/current-publication`,
      { method: "DELETE", headers: { cookie } },
    );
    expect(unpublished.status).toBe(200);

    const library = await listAssets(cookie);
    expect(library.find(({ id }) => id === coverAsset.id)?.references).toEqual({
      currentDrafts: 1,
      retainedPublications: 0,
    });
    expect(library.find(({ id }) => id === figureAsset.id)?.references).toEqual(
      { currentDrafts: 1, retainedPublications: 0 },
    );
    const historical = library.find(({ id }) => id === historicalAsset.id);
    expect(historical?.references).toEqual({
      currentDrafts: 0,
      retainedPublications: 1,
    });
    expect(historical?.publicAssetId).toBeTruthy();

    const draftBlocked = await cleanupAsset(cookie, coverAsset.id);
    expect(draftBlocked.status).toBe(409);
    expect(await draftBlocked.json()).toEqual({
      status: "error",
      code: "ASSET_CLEANUP_BLOCKED",
      references: { currentDrafts: 1, retainedPublications: 0 },
    });
    const publicationBlocked = await cleanupAsset(cookie, historicalAsset.id);
    expect(publicationBlocked.status).toBe(409);
    expect(await publicationBlocked.json()).toEqual({
      status: "error",
      code: "ASSET_CLEANUP_BLOCKED",
      references: { currentDrafts: 0, retainedPublications: 1 },
    });

    const unchanged = await listAssets(cookie);
    expect(
      unchanged
        .filter(({ id }) => [coverAsset.id, historicalAsset.id].includes(id))
        .map(({ id, lifecycleState }) => ({ id, lifecycleState })),
    ).toEqual(
      expect.arrayContaining(
        [coverAsset.id, historicalAsset.id].map((id) => ({
          id,
          lifecycleState: "ready",
        })),
      ),
    );
    expect(
      (
        await SELF.fetch(`http://briefly.test/media/private/${coverAsset.id}`, {
          headers: { cookie },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await SELF.fetch(
          `http://briefly.test/media/${historical?.publicAssetId}`,
        )
      ).status,
    ).toBe(200);
  }, 30_000);

  it("keeps zero-reference Assets until explicit cleanup and completes idempotently", async () => {
    const cookie = await initializeAndSignIn();
    const retained = await uploadOnePixelPngAsset(cookie, "keep-me.png");
    const cleaned = await uploadOnePixelPngAsset(cookie, "clean-me.png");

    expect((await listAssets(cookie)).map(({ id }) => id)).toEqual(
      expect.arrayContaining([retained.id, cleaned.id]),
    );
    expect(
      (
        await SELF.fetch(`http://briefly.test/media/private/${cleaned.id}`, {
          headers: { cookie },
        })
      ).status,
    ).toBe(200);

    const response = await cleanupAsset(cookie, cleaned.id);
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");

    const remaining = await listAssets(cookie);
    expect(remaining.map(({ id }) => id)).toContain(retained.id);
    expect(remaining.map(({ id }) => id)).not.toContain(cleaned.id);
    expect(
      (
        await SELF.fetch(`http://briefly.test/media/private/${cleaned.id}`, {
          headers: { cookie },
        })
      ).status,
    ).toBe(404);
    expect(
      (await SELF.fetch(`http://briefly.test/media/${cleaned.id}`)).status,
    ).toBe(404);
    expect(
      (
        await SELF.fetch(`http://briefly.test/media/private/${retained.id}`, {
          headers: { cookie },
        })
      ).status,
    ).toBe(200);

    const repeated = await cleanupAsset(cookie, cleaned.id);
    expect(repeated.status).toBe(204);
    expect((await listAssets(cookie)).map(({ id }) => id)).toEqual([
      retained.id,
    ]);
  }, 30_000);

  it("removes delivery through a previously assigned Public Asset Identity after references are gone", async () => {
    const cookie = await initializeAndSignIn();
    const asset = await uploadOnePixelPngAsset(cookie, "formerly-public.png");
    const articleId = await createArticle(cookie);
    await saveDraft(cookie, articleId, {
      version: 1,
      slug: "formerly-public-asset",
      figureAssetId: asset.id,
    });
    const publication = await SELF.fetch(
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
    expect(publication.status).toBe(201);
    const assigned = (await listAssets(cookie)).find(
      ({ id }) => id === asset.id,
    );
    expect(assigned?.publicAssetId).toBeTruthy();
    const publicUrl = `http://briefly.test/media/${assigned?.publicAssetId}`;
    expect((await SELF.fetch(publicUrl)).status).toBe(200);

    await saveDraft(cookie, articleId, {
      version: 2,
      slug: "formerly-public-asset",
    });
    expect(
      (
        await SELF.fetch(
          `http://briefly.test/api/admin/articles/${articleId}/current-publication`,
          { method: "DELETE", headers: { cookie } },
        )
      ).status,
    ).toBe(200);
    // Future Article purge reaches this same zero-reference Asset state. The
    // fixture removes the retained source so cleanup itself stays under test.
    await env.DB.prepare("DELETE FROM publication WHERE article_id = ?")
      .bind(articleId)
      .run();
    expect(
      (await listAssets(cookie)).find(({ id }) => id === asset.id),
    ).toMatchObject({
      publicAssetId: assigned?.publicAssetId,
      references: { currentDrafts: 0, retainedPublications: 0 },
    });

    expect((await cleanupAsset(cookie, asset.id)).status).toBe(204);
    expect((await SELF.fetch(publicUrl)).status).toBe(404);
    expect(
      (
        await SELF.fetch(`http://briefly.test/media/private/${asset.id}`, {
          headers: { cookie },
        })
      ).status,
    ).toBe(404);
  }, 30_000);

  it("records a retryable pending state before an R2 failure and completes on retry", async () => {
    const cookie = await initializeAndSignIn();
    const asset = await uploadOnePixelPngAsset(cookie, "retry-cleanup.png");
    let objectKey: string | null = null;
    let stateObservedByR2: AssetLibraryEntry | null = null;
    const failingBucket = bucketWithDeleteHook(async (key) => {
      objectKey = key;
      stateObservedByR2 =
        (await listAssets(cookie)).find(({ id }) => id === asset.id) ?? null;
      throw new Error("Injected R2 deletion failure");
    });

    const failed = await cleanupThroughWorker(cookie, asset.id, failingBucket);

    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({
      status: "error",
      code: "ASSET_CLEANUP_RETRY_REQUIRED",
      asset: {
        id: asset.id,
        lifecycleState: "pending_deletion",
        failureCode: "R2_DELETE_FAILED",
        references: { currentDrafts: 0, retainedPublications: 0 },
      },
    });
    expect(stateObservedByR2).toMatchObject({
      id: asset.id,
      lifecycleState: "pending_deletion",
      failureCode: null,
    });
    expect(objectKey).toBeTruthy();
    expect(await env.MEDIA_BUCKET.head(objectKey!)).not.toBeNull();
    expect(
      (await listAssets(cookie)).find(({ id }) => id === asset.id),
    ).toMatchObject({
      lifecycleState: "pending_deletion",
      failureCode: "R2_DELETE_FAILED",
    });
    expect(
      (
        await SELF.fetch(`http://briefly.test/media/private/${asset.id}`, {
          headers: { cookie },
        })
      ).status,
    ).toBe(404);

    expect((await cleanupAsset(cookie, asset.id)).status).toBe(204);
    expect(await env.MEDIA_BUCKET.head(objectKey!)).toBeNull();
    expect((await cleanupAsset(cookie, asset.id)).status).toBe(204);
  }, 30_000);

  it("prevents Draft saves and in-flight publishes from attaching an Asset after cleanup commits", async () => {
    const cookie = await initializeAndSignIn();

    const draftAsset = await uploadOnePixelPngAsset(
      cookie,
      "concurrent-draft.png",
    );
    const draftArticleId = await createArticle(cookie);
    const draftRace: { response: Response | null } = { response: null };
    const coordinatingDeleteBucket = bucketWithDeleteHook(async (objectKey) => {
      draftRace.response = await saveDraftRequest(cookie, draftArticleId, {
        version: 1,
        slug: "concurrent-draft-reference",
        coverAssetId: draftAsset.id,
        figureAssetId: draftAsset.id,
      });
      await env.MEDIA_BUCKET.delete(objectKey);
    });

    const draftCleanup = await cleanupThroughWorker(
      cookie,
      draftAsset.id,
      coordinatingDeleteBucket,
    );
    expect(draftCleanup.status).toBe(204);
    expect(draftRace.response?.status).toBe(400);
    expect(await draftRace.response!.json()).toMatchObject({
      status: "error",
      code: "ARTICLE_DRAFT_INVALID",
      issues: expect.arrayContaining([
        expect.objectContaining({
          message: "Referenced Asset must exist and be ready.",
        }),
      ]),
    });
    const unchangedDraft = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${draftArticleId}`,
      { headers: { cookie } },
    );
    expect(await unchangedDraft.json()).toMatchObject({
      draft: { version: 1, cover: null },
    });

    const publishAsset = await uploadOnePixelPngAsset(
      cookie,
      "concurrent-publication.png",
    );
    const publishArticleId = await createArticle(cookie);
    await saveDraft(cookie, publishArticleId, {
      version: 1,
      slug: "concurrent-publication-reference",
      figureAssetId: publishAsset.id,
    });
    const publishRace: { cleanup: Response | null } = { cleanup: null };
    const coordinatingHeadBucket = bucketWithHeadHook(async (objectKey) => {
      const staleHead = await env.MEDIA_BUCKET.head(objectKey);
      expect(staleHead).not.toBeNull();
      const removedFromDraft = await saveDraftRequest(
        cookie,
        publishArticleId,
        {
          version: 2,
          slug: "concurrent-publication-reference",
        },
      );
      expect(removedFromDraft.status).toBe(200);
      publishRace.cleanup = await cleanupAsset(cookie, publishAsset.id);
      expect(publishRace.cleanup.status).toBe(204);
      return staleHead;
    });

    const racedPublication = await fetchThroughWorker(
      `http://briefly.test/api/admin/articles/${publishArticleId}/publications`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          draftVersion: 2,
          expectedCurrentPublicationId: null,
        }),
      },
      coordinatingHeadBucket,
    );
    expect(racedPublication.status).toBe(409);
    expect(await racedPublication.json()).toMatchObject({
      status: "error",
      code: "PUBLICATION_CONFLICT",
    });
    expect(publishRace.cleanup?.status).toBe(204);
    expect((await listAssets(cookie)).map(({ id }) => id)).not.toContain(
      publishAsset.id,
    );
    expect(
      (
        await SELF.fetch(
          "http://briefly.test/api/articles/concurrent-publication-reference",
        )
      ).status,
    ).toBe(404);
  }, 30_000);
});
