import {
  SELF,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import worker from "../src/server";
import { initializeAndSignIn } from "./administrator-fixture";
import { uploadOnePixelPngAsset as uploadAsset } from "./asset-fixture";

function textDocument(content = "Saved body") {
  return {
    documentSchemaVersion: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: content }],
        },
      ],
    },
  };
}

function draftInput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 1,
    title: "Asset-backed Draft",
    slug: "asset-backed-draft",
    summary: null,
    tags: [],
    byline: null,
    language: null,
    cover: null,
    document: textDocument(),
    ...overrides,
  };
}

function figureDocument(
  usages: Array<{
    assetId: string;
    alt: string;
    caption: string | null;
    decorative?: boolean;
  }>,
) {
  return {
    documentSchemaVersion: 1,
    doc: {
      type: "doc",
      content: usages.map(({ decorative = false, ...usage }) => ({
        type: "figure",
        attrs: { ...usage, decorative },
      })),
    },
  };
}

describe("Article Draft Asset usages", () => {
  beforeEach(async () => {
    const { results } = await env.DB.prepare(
      "SELECT object_key FROM asset",
    ).all<{ object_key: string }>();
    await Promise.all(
      results.map(({ object_key }) => env.MEDIA_BUCKET.delete(object_key)),
    );
    await env.DB.batch([
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

  it("saves independent cover and figure usages of verified Assets with one Draft Version", async () => {
    const cookie = await initializeAndSignIn();
    const coverAsset = await uploadAsset(cookie, "cover.png");
    const figureAsset = await uploadAsset(cookie, "figure.png");
    const article = await (
      await SELF.fetch("http://briefly.test/api/admin/articles", {
        method: "POST",
        headers: { cookie },
      })
    ).json<{ id: string }>();
    const cover = {
      assetId: coverAsset.id,
      alt: "A quiet cover image",
    };
    const document = {
      documentSchemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Body before the figure" }],
          },
          {
            type: "figure",
            attrs: {
              assetId: figureAsset.id,
              alt: "A usage-specific description",
              caption: "A usage-specific caption",
              decorative: false,
            },
          },
        ],
      },
    };

    const saved = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${article.id}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          title: "Asset-backed Draft",
          slug: "asset-backed-draft",
          summary: null,
          tags: [],
          byline: null,
          language: null,
          cover,
          document,
        }),
      },
    );

    expect(saved.status).toBe(200);
    const savedText = await saved.text();
    expect(JSON.parse(savedText)).toMatchObject({
      draft: { version: 2, cover, document },
    });
    expect(savedText).not.toMatch(/object.?key|private-assets/i);

    const loaded = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${article.id}`,
      { headers: { cookie } },
    );
    expect(await loaded.json()).toMatchObject({
      draft: { version: 2, cover, document },
    });
  }, 15_000);

  it("preserves the versioned cover when a compatible save omits the field", async () => {
    const cookie = await initializeAndSignIn();
    const coverAsset = await uploadAsset(cookie, "preserved-cover.png");
    const article = await (
      await SELF.fetch("http://briefly.test/api/admin/articles", {
        method: "POST",
        headers: { cookie },
      })
    ).json<{ id: string }>();
    const cover = {
      assetId: coverAsset.id,
      alt: "A cover retained across compatible clients",
    };
    const initialSave = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${article.id}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(draftInput({ cover })),
      },
    );
    expect(initialSave.status).toBe(200);
    const compatibleInput = draftInput({
      version: 2,
      title: "Updated by a client without cover support",
    });
    delete compatibleInput.cover;

    const compatibleSave = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${article.id}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(compatibleInput),
      },
    );

    expect(compatibleSave.status).toBe(200);
    expect(await compatibleSave.json()).toMatchObject({
      draft: { version: 3, cover },
    });
    expect(
      await env.DB.prepare(
        `SELECT article_id, asset_id
         FROM article_draft_asset_reference
         WHERE article_id = ?`,
      )
        .bind(article.id)
        .all(),
    ).toMatchObject({
      results: [{ article_id: article.id, asset_id: coverAsset.id }],
    });
  }, 15_000);

  it("rejects non-internal, missing, incomplete, and URL-bearing Asset references without advancing the Draft", async () => {
    const cookie = await initializeAndSignIn();
    const readyAsset = await uploadAsset(cookie, "ready.png");
    const missingAssetId = crypto.randomUUID();
    const incompleteAssetId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO asset
         (id, original_filename, mime_type, byte_size, width, height,
          uploaded_at, object_key, lifecycle_state)
       VALUES (?, 'incomplete.png', 'image/png', 68, 1, 1, ?, ?, 'uploading')`,
    )
      .bind(
        incompleteAssetId,
        Date.now(),
        `private-assets/${crypto.randomUUID()}`,
      )
      .run();
    const figure = (attrs: Record<string, unknown>) => ({
      documentSchemaVersion: 1,
      doc: { type: "doc", content: [{ type: "figure", attrs }] },
    });
    const candidates = [
      {
        label: "an arbitrary cover URL",
        input: {
          cover: {
            assetId: "https://attacker.example/image.png",
            alt: "External",
          },
        },
      },
      {
        label: "a raw R2 object key",
        input: {
          cover: { assetId: "private-assets/raw-object-key", alt: "Raw" },
        },
      },
      {
        label: "a missing cover Asset",
        input: { cover: { assetId: missingAssetId, alt: "Missing" } },
      },
      {
        label: "an incomplete figure Asset",
        input: {
          document: figure({
            assetId: incompleteAssetId,
            alt: "Incomplete",
            caption: null,
            decorative: false,
          }),
        },
      },
      {
        label: "a figure-owned image URL",
        input: {
          document: figure({
            assetId: readyAsset.id,
            alt: "Injected",
            caption: null,
            decorative: false,
            src: "https://attacker.example/image.png",
          }),
        },
      },
    ];

    for (const [index, candidate] of candidates.entries()) {
      const article = await (
        await SELF.fetch("http://briefly.test/api/admin/articles", {
          method: "POST",
          headers: { cookie },
        })
      ).json<{ id: string }>();
      const response = await SELF.fetch(
        `http://briefly.test/api/admin/articles/${article.id}/draft`,
        {
          method: "PUT",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify(
            draftInput({
              slug: `rejected-asset-${index}`,
              ...candidate.input,
            }),
          ),
        },
      );

      expect(response.status, candidate.label).toBe(400);
      expect(await response.json(), candidate.label).toMatchObject({
        status: "error",
        code: "ARTICLE_DRAFT_INVALID",
        issues: [
          expect.objectContaining({
            path: expect.stringMatching(/^(cover|document)\./),
          }),
        ],
      });
      const preserved = await (
        await SELF.fetch(
          `http://briefly.test/api/admin/articles/${article.id}`,
          { headers: { cookie } },
        )
      ).json<{ draft: { version: number; cover: unknown } }>();
      expect(preserved.draft).toMatchObject({ version: 1, cover: null });
    }
  }, 15_000);

  it("synchronizes the deduplicated Draft reference set while preserving usage-specific meaning and cross-Article reuse", async () => {
    const cookie = await initializeAndSignIn();
    const reused = await uploadAsset(cookie, "reused.png");
    const replacement = await uploadAsset(cookie, "replacement.png");
    const firstArticle = await (
      await SELF.fetch("http://briefly.test/api/admin/articles", {
        method: "POST",
        headers: { cookie },
      })
    ).json<{ id: string }>();
    const reusedTwice = figureDocument([
      {
        assetId: reused.id,
        alt: "The Asset used as a diagram",
        caption: "Diagram meaning",
      },
      {
        assetId: reused.id,
        alt: "The same bytes used as evidence",
        caption: "Evidence meaning",
      },
    ]);
    const firstSave = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${firstArticle.id}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(
          draftInput({
            cover: { assetId: reused.id, alt: "Independent cover meaning" },
            document: reusedTwice,
          }),
        ),
      },
    );

    expect(firstSave.status).toBe(200);
    expect(await firstSave.json()).toMatchObject({
      draft: { version: 2, document: reusedTwice },
    });
    expect(
      await env.DB.prepare(
        `SELECT article_id, asset_id
         FROM article_draft_asset_reference
         WHERE article_id = ?`,
      )
        .bind(firstArticle.id)
        .all(),
    ).toMatchObject({
      results: [{ article_id: firstArticle.id, asset_id: reused.id }],
    });

    const replacedCover = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${firstArticle.id}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(
          draftInput({
            version: 2,
            cover: {
              assetId: replacement.id,
              alt: "Replacement cover meaning",
            },
            document: reusedTwice,
          }),
        ),
      },
    );
    expect(replacedCover.status).toBe(200);
    expect(
      (
        await env.DB.prepare(
          `SELECT asset_id
           FROM article_draft_asset_reference
           WHERE article_id = ?
           ORDER BY asset_id`,
        )
          .bind(firstArticle.id)
          .all<{ asset_id: string }>()
      ).results.map(({ asset_id }) => asset_id),
    ).toEqual([replacement.id, reused.id].sort());

    const secondArticle = await (
      await SELF.fetch("http://briefly.test/api/admin/articles", {
        method: "POST",
        headers: { cookie },
      })
    ).json<{ id: string }>();
    const secondSave = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${secondArticle.id}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(
          draftInput({
            slug: "second-asset-backed-draft",
            document: figureDocument([
              {
                assetId: reused.id,
                alt: "A third editorial meaning",
                caption: null,
              },
            ]),
          }),
        ),
      },
    );
    expect(secondSave.status).toBe(200);

    const removedFromFirst = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${firstArticle.id}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(
          draftInput({ version: 3, cover: null, document: textDocument() }),
        ),
      },
    );
    expect(removedFromFirst.status).toBe(200);
    expect(
      await env.DB.prepare(
        `SELECT article_id, asset_id
         FROM article_draft_asset_reference
         ORDER BY article_id, asset_id`,
      ).all(),
    ).toMatchObject({
      results: [{ article_id: secondArticle.id, asset_id: reused.id }],
    });
  }, 15_000);

  it("privately previews cover, captioned figure, and decorative figure through application media URLs without public side effects", async () => {
    const cookie = await initializeAndSignIn();
    const coverAsset = await uploadAsset(cookie, "preview-cover.png");
    const figureAsset = await uploadAsset(cookie, "preview-figure.png");
    const article = await (
      await SELF.fetch("http://briefly.test/api/admin/articles", {
        method: "POST",
        headers: { cookie },
      })
    ).json<{ id: string }>();
    const cover = { assetId: coverAsset.id, alt: "Preview cover" };
    const document = figureDocument([
      {
        assetId: figureAsset.id,
        alt: "Figure meaning",
        caption: "Caption <must be escaped>",
      },
      {
        assetId: figureAsset.id,
        alt: "Decorative authoring text must not render",
        caption: null,
        decorative: true,
      },
    ]);
    const saved = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${article.id}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(
          draftInput({
            title: "Private Asset preview",
            slug: "private-asset-preview",
            cover,
            document,
          }),
        ),
      },
    );
    expect(saved.status).toBe(200);

    const before = await (
      await SELF.fetch(`http://briefly.test/api/admin/articles/${article.id}`, {
        headers: { cookie },
      })
    ).json();
    const response = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${article.id}/preview`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ version: 2 }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    const responseText = await response.text();
    expect(JSON.parse(responseText)).toMatchObject({
      articleId: article.id,
      draftVersion: 2,
      rendererVersion: 2,
      coverHtml: `<figure><img src="http://briefly.test/media/private/${coverAsset.id}" width="1" height="1" alt="Preview cover"/></figure>`,
      html: `<figure><img src="http://briefly.test/media/private/${figureAsset.id}" width="1" height="1" alt="Figure meaning"/><figcaption>Caption &lt;must be escaped&gt;</figcaption></figure><figure><img src="http://briefly.test/media/private/${figureAsset.id}" width="1" height="1" alt=""/></figure>`,
    });
    expect(responseText).not.toMatch(/object.?key|private-assets/i);

    const after = await (
      await SELF.fetch(`http://briefly.test/api/admin/articles/${article.id}`, {
        headers: { cookie },
      })
    ).json();
    expect(after).toEqual(before);
    expect(
      await env.DB.prepare("SELECT id FROM publication WHERE article_id = ?")
        .bind(article.id)
        .first(),
    ).toBeNull();
    expect(
      (
        await env.DB.prepare(
          "SELECT public_asset_id FROM asset WHERE id IN (?, ?)",
        )
          .bind(coverAsset.id, figureAsset.id)
          .all<{ public_asset_id: string | null }>()
      ).results,
    ).toEqual([{ public_asset_id: null }, { public_asset_id: null }]);
  }, 15_000);

  it("returns every unavailable cover and figure issue without partial preview output", async () => {
    const cookie = await initializeAndSignIn();
    const coverAsset = await uploadAsset(cookie, "missing-cover.png");
    const missingFigure = await uploadAsset(cookie, "missing-figure.png");
    const incompleteFigure = await uploadAsset(cookie, "incomplete-figure.png");
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
        body: JSON.stringify(
          draftInput({
            title: "Unavailable Assets",
            slug: "unavailable-assets",
            cover: { assetId: coverAsset.id, alt: "Missing cover" },
            document: figureDocument([
              {
                assetId: missingFigure.id,
                alt: "Missing figure",
                caption: null,
              },
              {
                assetId: incompleteFigure.id,
                alt: "Incomplete figure",
                caption: null,
              },
            ]),
          }),
        ),
      },
    );
    expect(saved.status).toBe(200);
    const { results } = await env.DB.prepare(
      "SELECT id, object_key FROM asset WHERE id IN (?, ?, ?)",
    )
      .bind(coverAsset.id, missingFigure.id, incompleteFigure.id)
      .all<{ id: string; object_key: string }>();
    const keys = new Map(results.map(({ id, object_key }) => [id, object_key]));
    await Promise.all([
      env.MEDIA_BUCKET.delete(keys.get(coverAsset.id)!),
      env.MEDIA_BUCKET.delete(keys.get(missingFigure.id)!),
      env.DB.prepare(
        "UPDATE asset SET lifecycle_state = 'failed', failure_code = 'TEST' WHERE id = ?",
      )
        .bind(incompleteFigure.id)
        .run(),
    ]);

    const response = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${article.id}/preview`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ version: 2 }),
      },
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const responseText = await response.text();
    expect(JSON.parse(responseText)).toEqual({
      status: "error",
      code: "ARTICLE_PREVIEW_INVALID",
      issues: [coverAsset.id, missingFigure.id, incompleteFigure.id].map(
        (assetId) => ({
          code: "ASSET_NOT_RESOLVED",
          path: `assets.${assetId}`,
          message: "Referenced Asset is unavailable for publication",
        }),
      ),
    });
    expect(responseText).not.toMatch(
      /"(?:coverHtml|html)"|object.?key|private-assets/i,
    );
  }, 15_000);

  it("keeps both Draft content and references unchanged after stale and failed saves", async () => {
    const cookie = await initializeAndSignIn();
    const original = await uploadAsset(cookie, "original.png");
    const replacement = await uploadAsset(cookie, "failed-replacement.png");
    const article = await (
      await SELF.fetch("http://briefly.test/api/admin/articles", {
        method: "POST",
        headers: { cookie },
      })
    ).json<{ id: string }>();
    const originalCover = { assetId: original.id, alt: "Original cover" };
    expect(
      (
        await SELF.fetch(
          `http://briefly.test/api/admin/articles/${article.id}/draft`,
          {
            method: "PUT",
            headers: { cookie, "content-type": "application/json" },
            body: JSON.stringify(
              draftInput({ cover: originalCover, document: textDocument() }),
            ),
          },
        )
      ).status,
    ).toBe(200);
    const replacementInput = draftInput({
      cover: { assetId: replacement.id, alt: "Replacement cover" },
      document: figureDocument([
        {
          assetId: replacement.id,
          alt: "Replacement figure",
          caption: null,
        },
      ]),
    });

    const stale = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${article.id}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(replacementInput),
      },
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      status: "error",
      code: "ARTICLE_DRAFT_VERSION_CONFLICT",
    });

    await env.DB.prepare(
      `CREATE TRIGGER reject_asset_backed_article_timestamp
       BEFORE UPDATE OF updated_at ON article
       BEGIN
         SELECT RAISE(ABORT, 'simulated atomic save failure');
       END`,
    ).run();
    const failed = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${article.id}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ ...replacementInput, version: 2 }),
      },
    );
    await env.DB.prepare(
      "DROP TRIGGER reject_asset_backed_article_timestamp",
    ).run();
    expect(failed.status).toBe(500);

    const preserved = await (
      await SELF.fetch(`http://briefly.test/api/admin/articles/${article.id}`, {
        headers: { cookie },
      })
    ).json<{ draft: { version: number; cover: unknown; document: unknown } }>();
    expect(preserved.draft).toMatchObject({
      version: 2,
      cover: originalCover,
      document: textDocument(),
    });
    expect(
      await env.DB.prepare(
        `SELECT article_id, asset_id
         FROM article_draft_asset_reference
         WHERE article_id = ?`,
      )
        .bind(article.id)
        .all(),
    ).toMatchObject({
      results: [{ article_id: article.id, asset_id: original.id }],
    });
  }, 15_000);

  it("keeps references aligned with the winning save when same-Version requests share a timestamp", async () => {
    const cookie = await initializeAndSignIn();
    const firstAsset = await uploadAsset(cookie, "first-race.png");
    const secondAsset = await uploadAsset(cookie, "second-race.png");
    const article = await (
      await SELF.fetch("http://briefly.test/api/admin/articles", {
        method: "POST",
        headers: { cookie },
      })
    ).json<{ id: string }>();
    const fixedNow = vi.spyOn(Date, "now").mockReturnValue(2_000_000_000_000);

    try {
      const contexts = [createExecutionContext(), createExecutionContext()];
      const responses = await Promise.all(
        [firstAsset, secondAsset].map((asset, index) =>
          worker.fetch(
            new Request(
              `http://briefly.test/api/admin/articles/${article.id}/draft`,
              {
                method: "PUT",
                headers: { cookie, "content-type": "application/json" },
                body: JSON.stringify(
                  draftInput({
                    title: `Race candidate ${index + 1}`,
                    slug: `race-candidate-${index + 1}`,
                    cover: {
                      assetId: asset.id,
                      alt: `Race candidate ${index + 1}`,
                    },
                  }),
                ),
              },
            ) as Request<unknown, IncomingRequestCfProperties>,
            env,
            contexts[index],
          ),
        ),
      );
      await Promise.all(contexts.map(waitOnExecutionContext));
      expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    } finally {
      fixedNow.mockRestore();
    }

    const saved = await (
      await SELF.fetch(`http://briefly.test/api/admin/articles/${article.id}`, {
        headers: { cookie },
      })
    ).json<{ draft: { cover: { assetId: string } } }>();
    const references = await env.DB.prepare(
      `SELECT asset_id
       FROM article_draft_asset_reference
       WHERE article_id = ?`,
    )
      .bind(article.id)
      .all<{ asset_id: string }>();

    expect(references.results).toEqual([
      { asset_id: saved.draft.cover.assetId },
    ]);
  }, 15_000);

  it("presents an accessible route-local figure and cover authoring shell", async () => {
    const cookie = await initializeAndSignIn();

    const response = await SELF.fetch("http://briefly.test/admin", {
      headers: { cookie },
    });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Figures and cover");
    expect(html).toContain(
      "Select or upload verified Assets, then describe each Article usage.",
    );
    expect(html).toContain(
      "Decorative figures expose that state and save an empty alternative value.",
    );
  }, 15_000);
});
