import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { OpenAPIV3_1 } from "openapi-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { purgeConfirmationPhrases } from "../src/articles/article-trash";
import { translationLanguageKey } from "../src/articles/translation-groups";
import { initializeAndSignIn } from "./administrator-fixture";
import { uploadOnePixelPngAsset } from "./asset-fixture";
import { expectResponseMatchesContract } from "./openapi-contract";

const origin = "http://briefly.test";

function textDocument(text: string) {
  return {
    documentSchemaVersion: 1,
    doc: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    },
  };
}

function request(
  cookie: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return SELF.fetch(`${origin}${path}`, {
    method,
    headers: {
      cookie,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

interface DraftInput {
  title: string;
  slug: string | null;
  language: string | null;
  cover?: { assetId: string; alt: string } | null;
  summary?: string | null;
  tags?: string[];
}

async function createDraft(
  cookie: string,
  input: DraftInput,
): Promise<{ id: string; version: number }> {
  const created = await request(cookie, "POST", "/api/admin/articles");
  expect(created.status).toBe(201);
  const { id } = await created.json<{ id: string }>();
  const saved = await saveDraft(cookie, id, 1, input);
  return { id, version: saved.version };
}

async function saveDraft(
  cookie: string,
  id: string,
  version: number,
  input: DraftInput,
): Promise<{ version: number }> {
  const saved = await request(
    cookie,
    "PUT",
    `/api/admin/articles/${id}/draft`,
    {
      version,
      title: input.title,
      slug: input.slug,
      slugIsManual: input.slug !== null,
      summary: input.summary ?? null,
      tags: input.tags ?? [],
      byline: { name: "Translator", url: null },
      language: input.language,
      cover: input.cover ?? null,
      document: textDocument(`Body of ${input.title}`),
    },
  );
  expect(saved.status).toBe(200);
  const article = await saved.json<{ draft: { version: number } }>();
  return { version: article.draft.version };
}

function publish(
  cookie: string,
  id: string,
  draftVersion: number,
  expectedCurrentPublicationId: string | null = null,
): Promise<Response> {
  return request(cookie, "POST", `/api/admin/articles/${id}/publications`, {
    draftVersion,
    expectedCurrentPublicationId,
  });
}

async function createPublished(
  cookie: string,
  input: { title: string; slug: string; language: string },
): Promise<{ id: string; version: number; publicationId: string }> {
  const draft = await createDraft(cookie, input);
  const published = await publish(cookie, draft.id, draft.version);
  expect(published.status).toBe(201);
  const { publicationId } = await published.json<{ publicationId: string }>();
  return { ...draft, publicationId };
}

function link(cookie: string, articleId: string, translationId: string) {
  return request(
    cookie,
    "PUT",
    `/api/admin/articles/${articleId}/translations/${translationId}`,
  );
}

function unlink(cookie: string, articleId: string) {
  return request(
    cookie,
    "DELETE",
    `/api/admin/articles/${articleId}/translation-group`,
  );
}

async function adminTranslations(cookie: string, articleId: string) {
  const response = await request(
    cookie,
    "GET",
    `/api/admin/articles/${articleId}/translations`,
  );
  expect(response.status).toBe(200);
  const { translations } = await response.json<{
    translations: Array<{
      id: string;
      title: string;
      language: string;
      lifecycleProjection: string;
    }>;
  }>();
  return translations;
}

async function publicTranslations(slug: string) {
  const response = await SELF.fetch(
    `${origin}/api/articles/${encodeURIComponent(slug)}`,
  );
  expect(response.status).toBe(200);
  const article = await response.json<{
    translations: Array<{ id: string; slug: string; language: string }>;
  }>();
  return article.translations;
}

async function groupIdOf(articleId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT translation_group_id FROM article WHERE id = ?",
  )
    .bind(articleId)
    .first<{ translation_group_id: string | null }>();
  return row?.translation_group_id ?? null;
}

async function draftVersionOf(articleId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT version FROM article_draft WHERE article_id = ?",
  )
    .bind(articleId)
    .first<{ version: number }>();
  if (!row) throw new Error("Missing Draft");
  return row.version;
}

async function errorCode(response: Response): Promise<string> {
  return (await response.json<{ code: string }>()).code;
}

describe("translation language key", () => {
  it("compares language and script, ignoring region, inside workerd", () => {
    for (const [tags, key] of [
      [["zh-CN", "zh-Hans", "zh-SG", "zh-Hans-CN"], "zh-Hans"],
      [["zh-TW", "zh-HK", "zh-Hant"], "zh-Hant"],
      [["en", "en-US", "en-GB"], "en-Latn"],
      [["ja", "ja-JP"], "ja-Jpan"],
      [["ko", "ko-KR"], "ko-Kore"],
      [["sr"], "sr-Cyrl"],
      [["sr-Latn"], "sr-Latn"],
      [["qq"], "qq"],
      [["und"], "und"],
      [["und-Hans"], "zh-Hans"],
    ] as const) {
      for (const tag of tags) expect(translationLanguageKey(tag)).toBe(key);
    }
  });
});

describe("Translation Groups", () => {
  beforeEach(async () => {
    const { results } = await env.DB.prepare(
      "SELECT object_key FROM asset",
    ).all<{ object_key: string }>();
    await Promise.all(
      results.map(({ object_key }) => env.MEDIA_BUCKET.delete(object_key)),
    );
    await env.DB.batch([
      env.DB.prepare("UPDATE article SET current_publication_id = NULL"),
      env.DB.prepare("DELETE FROM publication_asset_reference"),
      env.DB.prepare("DELETE FROM article_draft_asset_reference"),
      env.DB.prepare("DELETE FROM publication"),
      env.DB.prepare("DELETE FROM article_draft"),
      env.DB.prepare("DELETE FROM article_slug"),
      env.DB.prepare("DELETE FROM purged_article_slug"),
      env.DB.prepare("DELETE FROM article"),
      env.DB.prepare("DELETE FROM asset"),
      env.DB.prepare("DELETE FROM auth_session"),
      env.DB.prepare("DELETE FROM auth_account"),
      env.DB.prepare("DELETE FROM auth_user"),
      env.DB.prepare("DELETE FROM auth_rate_limit"),
      env.DB.prepare("UPDATE site_settings SET default_language = 'en'"),
    ]);
  });

  it("links Articles into one group visible to Admin and the public API without touching Draft Versions", async () => {
    const cookie = await initializeAndSignIn();
    const english = await createPublished(cookie, {
      title: "Hello",
      slug: "hello",
      language: "en",
    });
    const japanese = await createPublished(cookie, {
      title: "こんにちは",
      slug: "こんにちは",
      language: "ja",
    });
    const chinese = await createPublished(cookie, {
      title: "你好",
      slug: "你好",
      language: "zh-Hans",
    });
    const loner = await createPublished(cookie, {
      title: "Alone",
      slug: "alone",
      language: "en",
    });

    expect(await publicTranslations("hello")).toEqual([]);

    const first = await link(cookie, english.id, japanese.id);
    expect(first.status).toBe(200);
    expect(
      (await first.json<{ translations: Array<{ id: string }> }>())
        .translations,
    ).toEqual([
      {
        id: japanese.id,
        title: "こんにちは",
        language: "ja",
        lifecycleProjection: "published",
      },
    ]);
    // A third Article can join through any member.
    expect((await link(cookie, japanese.id, chinese.id)).status).toBe(200);

    const groupId = await groupIdOf(english.id);
    expect(groupId).not.toBeNull();
    expect(await groupIdOf(japanese.id)).toBe(groupId);
    expect(await groupIdOf(chinese.id)).toBe(groupId);
    expect(await groupIdOf(loner.id)).toBeNull();

    expect(await publicTranslations("hello")).toEqual([
      { id: japanese.id, slug: "こんにちは", language: "ja" },
      { id: chinese.id, slug: "你好", language: "zh-Hans" },
    ]);
    expect(await publicTranslations("你好")).toEqual([
      { id: english.id, slug: "hello", language: "en" },
      { id: japanese.id, slug: "こんにちは", language: "ja" },
    ]);
    expect(await publicTranslations("alone")).toEqual([]);
    expect(
      (await adminTranslations(cookie, chinese.id)).map(({ id }) => id),
    ).toEqual([english.id, japanese.id]);

    for (const member of [english, japanese, chinese]) {
      expect(await draftVersionOf(member.id)).toBe(member.version);
    }
  });

  it("refuses self links, unknown or trashed Articles, second groups, and public language collisions", async () => {
    const cookie = await initializeAndSignIn();
    const simplified = await createPublished(cookie, {
      title: "简体",
      slug: "简体",
      language: "zh-Hans",
    });
    const mainland = await createPublished(cookie, {
      title: "大陆",
      slug: "大陆",
      language: "zh-CN",
    });
    const traditional = await createPublished(cookie, {
      title: "繁體",
      slug: "繁體",
      language: "zh-Hant",
    });
    const british = await createPublished(cookie, {
      title: "Colour",
      slug: "colour",
      language: "en-GB",
    });
    const american = await createPublished(cookie, {
      title: "Color",
      slug: "color",
      language: "en-US",
    });
    const trashed = await createDraft(cookie, {
      title: "Trashed",
      slug: "trashed",
      language: "ja",
    });
    expect(
      (await request(cookie, "POST", `/api/admin/articles/${trashed.id}/trash`))
        .status,
    ).toBe(200);
    const unknown = crypto.randomUUID();

    const self = await link(cookie, simplified.id, simplified.id);
    expect(self.status).toBe(400);
    expect(await errorCode(self)).toBe("TRANSLATION_SELF_LINK");

    const unknownAnchor = await link(cookie, unknown, simplified.id);
    expect(unknownAnchor.status).toBe(404);
    expect(await errorCode(unknownAnchor)).toBe("ARTICLE_NOT_FOUND");

    for (const missing of [unknown, trashed.id]) {
      const response = await link(cookie, simplified.id, missing);
      expect(response.status).toBe(404);
      expect(await errorCode(response)).toBe("TRANSLATION_ARTICLE_NOT_FOUND");
    }

    // A new group refuses two public Articles in the same language.
    const variant = await link(cookie, simplified.id, mainland.id);
    expect(variant.status).toBe(409);
    expect(await errorCode(variant)).toBe("TRANSLATION_LANGUAGE_TAKEN");
    expect(await groupIdOf(simplified.id)).toBeNull();
    expect(await groupIdOf(mainland.id)).toBeNull();

    expect((await link(cookie, simplified.id, traditional.id)).status).toBe(
      200,
    );
    expect((await link(cookie, simplified.id, british.id)).status).toBe(200);

    // An existing group refuses a regional variant of a public language.
    const regional = await link(cookie, traditional.id, american.id);
    expect(regional.status).toBe(409);
    expect(await errorCode(regional)).toBe("TRANSLATION_LANGUAGE_TAKEN");
    expect(await groupIdOf(american.id)).toBeNull();

    // An Article in another group is refused rather than merged.
    expect((await link(cookie, american.id, mainland.id)).status).toBe(200);
    for (const [anchorId, joiningId] of [
      [simplified.id, mainland.id],
      [american.id, british.id],
    ]) {
      const response = await link(cookie, anchorId, joiningId);
      expect(response.status).toBe(409);
      expect(await errorCode(response)).toBe("TRANSLATION_ALREADY_LINKED");
    }
    expect(await groupIdOf(british.id)).toBe(await groupIdOf(simplified.id));
    expect(await groupIdOf(mainland.id)).toBe(await groupIdOf(american.id));
    expect(await groupIdOf(mainland.id)).not.toBe(
      await groupIdOf(simplified.id),
    );
  });

  it("unlinks an Article and dissolves a group left with one Article", async () => {
    const cookie = await initializeAndSignIn();
    const english = await createPublished(cookie, {
      title: "One",
      slug: "one",
      language: "en",
    });
    const japanese = await createPublished(cookie, {
      title: "一",
      slug: "一",
      language: "ja",
    });
    const korean = await createPublished(cookie, {
      title: "하나",
      slug: "하나",
      language: "ko",
    });
    await link(cookie, english.id, japanese.id);
    await link(cookie, english.id, korean.id);
    const groupId = await groupIdOf(english.id);

    const removed = await unlink(cookie, korean.id);
    expect(removed.status).toBe(204);
    expect(await groupIdOf(korean.id)).toBeNull();
    expect(await groupIdOf(english.id)).toBe(groupId);
    expect(await publicTranslations("one")).toEqual([
      { id: japanese.id, slug: "一", language: "ja" },
    ]);
    expect(await publicTranslations("하나")).toEqual([]);

    expect((await unlink(cookie, japanese.id)).status).toBe(204);
    expect(await groupIdOf(japanese.id)).toBeNull();
    expect(await groupIdOf(english.id)).toBeNull();
    expect(await adminTranslations(cookie, english.id)).toEqual([]);

    // Unlinking an ungrouped Article is a no-op; an unknown one is not found.
    expect((await unlink(cookie, english.id)).status).toBe(204);
    expect((await unlink(cookie, crypto.randomUUID())).status).toBe(404);

    for (const member of [english, japanese, korean]) {
      expect(await draftVersionOf(member.id)).toBe(member.version);
    }
  });

  it("hides unpublished and trashed members publicly, keeps membership through Trash, and dissolves on purge", async () => {
    const cookie = await initializeAndSignIn();
    const english = await createPublished(cookie, {
      title: "Visible",
      slug: "visible",
      language: "en",
    });
    const japanese = await createPublished(cookie, {
      title: "見える",
      slug: "見える",
      language: "ja",
    });
    await link(cookie, english.id, japanese.id);

    expect(
      (
        await request(
          cookie,
          "DELETE",
          `/api/admin/articles/${japanese.id}/current-publication`,
        )
      ).status,
    ).toBe(200);
    expect(await publicTranslations("visible")).toEqual([]);
    expect(await adminTranslations(cookie, english.id)).toEqual([
      {
        id: japanese.id,
        title: "見える",
        language: "ja",
        lifecycleProjection: "unpublished",
      },
    ]);

    const republished = await publish(cookie, japanese.id, japanese.version);
    expect(republished.status).toBe(201);
    expect(await publicTranslations("visible")).toEqual([
      { id: japanese.id, slug: "見える", language: "ja" },
    ]);

    expect(
      (
        await request(
          cookie,
          "POST",
          `/api/admin/articles/${japanese.id}/trash`,
        )
      ).status,
    ).toBe(200);
    expect(await publicTranslations("visible")).toEqual([]);
    expect(await adminTranslations(cookie, english.id)).toEqual([]);
    const groupId = await groupIdOf(english.id);
    expect(groupId).not.toBeNull();
    expect(await groupIdOf(japanese.id)).toBe(groupId);

    expect(
      (
        await request(
          cookie,
          "POST",
          `/api/admin/trash/articles/${japanese.id}/restore`,
        )
      ).status,
    ).toBe(200);
    expect(
      (await adminTranslations(cookie, english.id)).map(
        ({ lifecycleProjection }) => lifecycleProjection,
      ),
    ).toEqual(["unpublished"]);
    expect(await publicTranslations("visible")).toEqual([]);

    expect(
      (
        await request(
          cookie,
          "POST",
          `/api/admin/articles/${japanese.id}/trash`,
        )
      ).status,
    ).toBe(200);
    const purged = await request(
      cookie,
      "DELETE",
      `/api/admin/trash/articles/${japanese.id}`,
      { confirmationTitle: purgeConfirmationPhrases.en },
    );
    expect(purged.status).toBe(200);
    expect(await groupIdOf(english.id)).toBeNull();
  });

  it("reports a language collision with a public member in Preview and Publish while letting Drafts collide privately", async () => {
    const cookie = await initializeAndSignIn();
    const simplified = await createPublished(cookie, {
      title: "原文",
      slug: "原文",
      language: "zh-Hans",
    });
    const english = await createPublished(cookie, {
      title: "Source",
      slug: "source",
      language: "en",
    });
    await link(cookie, simplified.id, english.id);
    const draft = await createDraft(cookie, {
      title: "大陆译本",
      slug: "大陆译本",
      language: "ja",
    });
    expect((await link(cookie, simplified.id, draft.id)).status).toBe(200);

    // The private Draft may take a colliding regional variant.
    const colliding = await saveDraft(cookie, draft.id, draft.version, {
      title: "大陆译本",
      slug: "大陆译本",
      language: "zh-CN",
    });

    const preview = await request(
      cookie,
      "POST",
      `/api/admin/articles/${draft.id}/preview`,
      { draftVersion: colliding.version },
    );
    const published = await publish(cookie, draft.id, colliding.version);
    for (const response of [preview, published]) {
      expect(response.status).toBe(400);
      expect(
        await response.json<{
          code: string;
          issues: Array<{ code: string; path: string }>;
        }>(),
      ).toMatchObject({
        code: "PUBLICATION_INVALID",
        issues: [
          { code: "TRANSLATION_LANGUAGE_TAKEN", path: "draft.language" },
        ],
      });
    }

    // The issue clears once the public member is withdrawn.
    await request(
      cookie,
      "DELETE",
      `/api/admin/articles/${simplified.id}/current-publication`,
    );
    expect((await publish(cookie, draft.id, colliding.version)).status).toBe(
      201,
    );
    expect(await publicTranslations("source")).toEqual([
      { id: draft.id, slug: "大陆译本", language: "zh-CN" },
    ]);
    // The withdrawn member cannot now return in the same language.
    const restored = await publish(cookie, simplified.id, simplified.version);
    expect(restored.status).toBe(400);
  });

  it("lets exactly one of two concurrent same-language Publishes succeed", async () => {
    const cookie = await initializeAndSignIn();
    const anchor = await createPublished(cookie, {
      title: "Anchor",
      slug: "anchor",
      language: "en",
    });
    const first = await createDraft(cookie, {
      title: "Erste",
      slug: "erste",
      language: "de",
    });
    const second = await createDraft(cookie, {
      title: "Zweite",
      slug: "zweite",
      language: "de-AT",
    });
    await link(cookie, anchor.id, first.id);
    await link(cookie, anchor.id, second.id);

    const responses = await Promise.all([
      publish(cookie, first.id, first.version),
      publish(cookie, second.id, second.version),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([201, 400]);
    const refused = responses.find(({ status }) => status === 400)!;
    expect(
      await refused.json<{ issues: Array<{ code: string }> }>(),
    ).toMatchObject({ issues: [{ code: "TRANSLATION_LANGUAGE_TAKEN" }] });

    const { results } = await env.DB.prepare(
      `SELECT article_id FROM publication WHERE article_id IN (?, ?)`,
    )
      .bind(first.id, second.id)
      .all();
    expect(results).toHaveLength(1);
    expect(await publicTranslations("anchor")).toHaveLength(1);
  });

  it("refuses at commit when another member becomes public in the language after preparation", async () => {
    const cookie = await initializeAndSignIn();
    const asset = await uploadOnePixelPngAsset(cookie, "late.png");
    const anchor = await createPublished(cookie, {
      title: "Anchor",
      slug: "anchor",
      language: "en",
    });
    const rival = await createPublished(cookie, {
      title: "Rivale",
      slug: "rivale",
      language: "de",
    });
    const late = await createDraft(cookie, {
      title: "Späte",
      slug: "spaete",
      language: "de-AT",
      cover: { assetId: asset.id, alt: "Cover" },
    });
    await link(cookie, anchor.id, rival.id);
    await link(cookie, anchor.id, late.id);
    await env.DB.prepare(
      "UPDATE article SET current_publication_id = NULL WHERE id = ?",
    )
      .bind(rival.id)
      .run();

    // Rendering reads the cover object after preparation has passed; the
    // rival returns to public at exactly that point.
    const head = env.MEDIA_BUCKET.head.bind(env.MEDIA_BUCKET);
    const spy = vi
      .spyOn(env.MEDIA_BUCKET, "head")
      .mockImplementation(async (key) => {
        await env.DB.prepare(
          "UPDATE article SET current_publication_id = ? WHERE id = ?",
        )
          .bind(rival.publicationId, rival.id)
          .run();
        return head(key);
      });
    try {
      const refused = await publish(cookie, late.id, late.version);
      expect(spy).toHaveBeenCalled();
      expect(refused.status).toBe(400);
      expect(
        await refused.json<{ issues: Array<{ code: string; path: string }> }>(),
      ).toMatchObject({
        issues: [
          { code: "TRANSLATION_LANGUAGE_TAKEN", path: "draft.language" },
        ],
      });
    } finally {
      spy.mockRestore();
    }
    const { results } = await env.DB.prepare(
      "SELECT id FROM publication WHERE article_id = ?",
    )
      .bind(late.id)
      .all();
    expect(results).toEqual([]);
    expect(await publicTranslations("anchor")).toEqual([
      { id: rival.id, slug: "rivale", language: "de" },
    ]);
  });

  it("creates a translation from the source Draft without claiming its slug", async () => {
    const cookie = await initializeAndSignIn();
    const asset = await uploadOnePixelPngAsset(cookie, "cover.png");
    const source = await createDraft(cookie, {
      title: "Original title",
      slug: "original",
      language: null,
      summary: "Original summary",
      tags: ["guide"],
      cover: { assetId: asset.id, alt: "Cover" },
    });

    const created = await request(
      cookie,
      "POST",
      `/api/admin/articles/${source.id}/translations`,
      { language: "ja-JP" },
    );
    expect(created.status).toBe(201);
    const translation = await created.json<{
      id: string;
      currentPublicationId: string | null;
      draft: Record<string, unknown>;
    }>();
    expect(translation.currentPublicationId).toBeNull();
    expect(translation.draft).toMatchObject({
      version: 1,
      title: "Original title",
      slug: null,
      slugIsManual: false,
      summary: "Original summary",
      tags: ["guide"],
      byline: { name: "Translator", url: null },
      language: "ja-JP",
      cover: { assetId: asset.id, alt: "Cover" },
      document: textDocument("Body of Original title"),
    });
    expect(await groupIdOf(translation.id)).toBe(await groupIdOf(source.id));
    expect(await groupIdOf(source.id)).not.toBeNull();
    const references = await env.DB.prepare(
      "SELECT asset_id FROM article_draft_asset_reference WHERE article_id = ?",
    )
      .bind(translation.id)
      .all<{ asset_id: string }>();
    expect(references.results).toEqual([{ asset_id: asset.id }]);
    expect(
      (await adminTranslations(cookie, source.id)).map(({ id }) => id),
    ).toEqual([translation.id]);
    expect(await draftVersionOf(source.id)).toBe(source.version);

    // The source has no Draft language, so it holds the Site Settings default.
    for (const language of ["en-US", "ja"]) {
      const taken = await request(
        cookie,
        "POST",
        `/api/admin/articles/${source.id}/translations`,
        { language },
      );
      expect(taken.status).toBe(409);
      expect(await errorCode(taken)).toBe("TRANSLATION_LANGUAGE_TAKEN");
    }

    const invalid = await request(
      cookie,
      "POST",
      `/api/admin/articles/${source.id}/translations`,
      { language: "not a tag" },
    );
    expect(invalid.status).toBe(400);
    expect(await errorCode(invalid)).toBe("ARTICLE_TRANSLATION_INVALID");

    const missing = await request(
      cookie,
      "POST",
      `/api/admin/articles/${crypto.randomUUID()}/translations`,
      { language: "ko" },
    );
    expect(missing.status).toBe(404);
  });

  it("changes the detail ETag whenever translations change and keeps it stable otherwise", async () => {
    const cookie = await initializeAndSignIn();
    const english = await createPublished(cookie, {
      title: "Tagged",
      slug: "tagged",
      language: "en",
    });
    const korean = await createDraft(cookie, {
      title: "태그",
      slug: "태그",
      language: "ko",
    });

    async function etag(): Promise<string> {
      const response = await SELF.fetch(`${origin}/api/articles/tagged`);
      expect(response.status).toBe(200);
      const value = response.headers.get("etag");
      if (!value) throw new Error("Expected an ETag");
      return value;
    }

    const initial = await etag();
    expect(await etag()).toBe(initial);
    expect(
      (
        await SELF.fetch(`${origin}/api/articles/tagged`, {
          headers: { "if-none-match": initial },
        })
      ).status,
    ).toBe(304);

    // Linking an unpublished translation changes nothing public.
    await link(cookie, english.id, korean.id);
    expect(await etag()).toBe(initial);

    expect((await publish(cookie, korean.id, korean.version)).status).toBe(201);
    const withTranslation = await etag();
    expect(withTranslation).not.toBe(initial);
    expect(
      (
        await SELF.fetch(`${origin}/api/articles/tagged`, {
          headers: { "if-none-match": initial },
        })
      ).status,
    ).toBe(200);

    await unlink(cookie, korean.id);
    expect(await etag()).toBe(initial);
  });

  it("offers only other ungrouped, non-trashed Articles as link candidates", async () => {
    const cookie = await initializeAndSignIn();
    const anchor = await createDraft(cookie, {
      title: "Anchor",
      slug: "anchor",
      language: "en",
    });
    const grouped = await createDraft(cookie, {
      title: "Grouped",
      slug: "grouped",
      language: "ja",
    });
    const elsewhere = await createDraft(cookie, {
      title: "Elsewhere",
      slug: "elsewhere",
      language: "en",
    });
    const partner = await createDraft(cookie, {
      title: "Partner",
      slug: "partner",
      language: "ko",
    });
    const trashed = await createDraft(cookie, {
      title: "Trashed",
      slug: "trashed",
      language: "ko",
    });
    const free = await createDraft(cookie, {
      title: "Free",
      slug: null,
      language: null,
    });
    await link(cookie, anchor.id, grouped.id);
    await link(cookie, elsewhere.id, partner.id);
    await request(cookie, "POST", `/api/admin/articles/${trashed.id}/trash`);

    const response = await request(
      cookie,
      "GET",
      `/api/admin/articles/${anchor.id}/translation-candidates`,
    );
    expect(response.status).toBe(200);
    expect(
      (await response.json<{ candidates: unknown[] }>()).candidates,
    ).toEqual([
      {
        id: free.id,
        title: "Free",
        language: "en",
        lifecycleProjection: "draft",
      },
    ]);

    const missing = await request(
      cookie,
      "GET",
      `/api/admin/articles/${crypto.randomUUID()}/translation-candidates`,
    );
    expect(missing.status).toBe(404);
  });

  it("matches the OpenAPI ArticleDetail contract with translations", async () => {
    const cookie = await initializeAndSignIn();
    const english = await createPublished(cookie, {
      title: "Contract",
      slug: "contract",
      language: "en",
    });
    const japanese = await createPublished(cookie, {
      title: "契約",
      slug: "契約",
      language: "ja",
    });
    await link(cookie, english.id, japanese.id);
    const document = await (
      await SELF.fetch(`${origin}/api/openapi.json`)
    ).json<OpenAPIV3_1.Document>();
    const detail = await SELF.fetch(`${origin}/api/articles/contract`);
    expect(detail.status).toBe(200);
    expectResponseMatchesContract(
      document,
      "/api/articles/{slug}",
      "get",
      200,
      await detail.json(),
    );
  });

  it("enforces one public Article per language key in a group below application code", async () => {
    const cookie = await initializeAndSignIn();
    const first = await createPublished(cookie, {
      title: "First",
      slug: "first",
      language: "en",
    });
    const second = await createPublished(cookie, {
      title: "Second",
      slug: "second",
      language: "en-GB",
    });
    const groupId = crypto.randomUUID();
    await env.DB.prepare(
      `UPDATE article
       SET translation_group_id = ?, current_publication_language_key = 'en-Latn'
       WHERE id = ?`,
    )
      .bind(groupId, first.id)
      .run();
    await expect(
      env.DB.prepare(
        `UPDATE article
         SET translation_group_id = ?, current_publication_language_key = 'en-Latn'
         WHERE id = ?`,
      )
        .bind(groupId, second.id)
        .run(),
    ).rejects.toThrow(/UNIQUE/u);

    // An unpublished member does not hold its language.
    await env.DB.prepare(
      "UPDATE article SET current_publication_id = NULL WHERE id = ?",
    )
      .bind(first.id)
      .run();
    await env.DB.prepare(
      `UPDATE article
       SET translation_group_id = ?, current_publication_language_key = 'en-Latn'
       WHERE id = ?`,
    )
      .bind(groupId, second.id)
      .run();
    expect(await groupIdOf(second.id)).toBe(groupId);
  });
});
