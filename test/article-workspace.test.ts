import { describe, expect, it } from "vitest";

import type {
  Article,
  ArticleDraftUpdate,
  ArticleTrashEntry,
} from "../src/articles/articles";
import {
  articleLifecycleProjection,
  applyDraftChanges,
  draftUpdate,
  mergeConcurrentCurrentPublication,
  preserveLocalDraft,
  preserveNewestLocalDraft,
  preservePublicationRecoveryState,
  publicationReceiptConfirmation,
  reducePublicationState,
  reduceArticleWorkspace,
  reduceTrashActionState,
  type ArticleWorkspaceGateway,
} from "../src/articles/article-workspace";

const document = {
  documentSchemaVersion: 1 as const,
  doc: { type: "doc" as const, content: [] },
};

function article(
  overrides: {
    id?: string;
    currentPublicationId?: string | null;
    draft?: Partial<Article["draft"]>;
  } = {},
): Article {
  const { channelSlug: overrideChannelSlug, ...draftOverrides } =
    overrides.draft ?? {};
  return {
    id: overrides.id ?? "article-1",
    currentPublicationId: overrides.currentPublicationId ?? null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    draft: {
      version: 1,
      title: "原始标题",
      slug: "原始标题",
      slugIsManual: false,
      summary: null,
      tags: [],
      byline: null,
      language: "zh-Hans",
      cover: null,
      document,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...draftOverrides,
      channelSlug: overrideChannelSlug ?? null,
    },
  };
}

describe("Article Workspace pure interface", () => {
  it("uses the server lifecycle projection and safely falls back for legacy responses", () => {
    expect(
      articleLifecycleProjection(
        Object.assign(article(), { lifecycleProjection: "changes-pending" }),
      ),
    ).toBe("changes-pending");
    expect(
      articleLifecycleProjection(
        Object.assign(article({ currentPublicationId: "publication-1" }), {
          lifecycleProjection: "not-a-projection",
        }),
      ),
    ).toBe("published");
    expect(articleLifecycleProjection(article())).toBe("draft");
  });

  it("applies Draft commands with automatic Slug following and manual lock", () => {
    expect(
      applyDraftChanges(article(), { title: "  新的标题  " }).draft,
    ).toMatchObject({
      title: "  新的标题  ",
      slug: "新的标题",
      slugIsManual: false,
    });

    const manual = article({
      draft: { slug: "fixed-url", slugIsManual: true },
    });
    expect(
      applyDraftChanges(manual, { title: "另一个标题" }).draft,
    ).toMatchObject({
      slug: "fixed-url",
      slugIsManual: true,
    });

    expect(
      applyDraftChanges(article(), {
        title: "标题",
        slug: "explicit-url",
      }).draft,
    ).toMatchObject({ slug: "explicit-url" });
  });

  it("builds a transport-safe Draft update and honors an explicit version", () => {
    const update = draftUpdate(article().draft, 7);
    expect(update).toEqual({
      version: 7,
      title: "原始标题",
      slug: "原始标题",
      slugIsManual: false,
      summary: null,
      tags: [],
      byline: null,
      language: "zh-Hans",
      channelSlug: null,
      cover: null,
      document,
    });
    expect(update).not.toHaveProperty("createdAt");
    expect(update).not.toHaveProperty("updatedAt");
  });

  it("preserves local Draft edits while adopting server metadata", () => {
    const server = article({
      draft: {
        version: 2,
        title: "服务器标题",
        slug: "server-slug",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    });
    const local = article({
      draft: { version: 1, title: "本地标题", slug: "本地标题" },
    });
    const merged = preserveLocalDraft(server, local);
    expect(merged.draft.title).toBe("本地标题");
    expect(merged.draft.version).toBe(2);
    expect(merged.draft.updatedAt).toBe("2026-01-02T00:00:00.000Z");

    const newerLocal = article({
      draft: { version: 3, title: "更新的本地标题" },
    });
    expect(preserveNewestLocalDraft(server, newerLocal).draft.version).toBe(3);
    expect(preserveNewestLocalDraft(server, newerLocal).draft.title).toBe(
      "更新的本地标题",
    );
  });

  it("keeps a concurrent Publish or Unpublish pointer from a stale read", () => {
    const requestSnapshot = article();
    const localPublished = article({ currentPublicationId: "publication-1" });
    const server = article();
    expect(
      mergeConcurrentCurrentPublication(
        server,
        requestSnapshot,
        localPublished,
      ),
    ).toEqual({
      article: localPublished,
      currentPublicationChanged: true,
    });

    const localUnpublished = article({ currentPublicationId: null });
    const serverPublished = article({ currentPublicationId: "publication-1" });
    expect(
      mergeConcurrentCurrentPublication(
        serverPublished,
        article({ currentPublicationId: "publication-1" }),
        localUnpublished,
      ).article.currentPublicationId,
    ).toBeNull();
  });

  it("accepts only a receipt for the expected Article and Draft Version", () => {
    const value = {
      publicationId: "11111111-1111-4111-8111-111111111111",
      draftVersion: 2,
      article: { id: "article-1" },
    };
    expect(publicationReceiptConfirmation(value, "article-1")).toEqual({
      publicationId: value.publicationId,
      draftVersion: 2,
    });
    expect(
      publicationReceiptConfirmation(
        { ...value, article: { id: "article-2" } },
        "article-1",
      ),
    ).toBeNull();
    expect(
      publicationReceiptConfirmation(
        { ...value, publicationId: "not-a-uuid" },
        "article-1",
      ),
    ).toBeNull();
    expect(
      publicationReceiptConfirmation(
        { ...value, draftVersion: 0 },
        "article-1",
      ),
    ).toBeNull();
  });

  it("puts editor transitions behind one pure state interface", () => {
    const initial = {
      selected: null,
      revision: 0,
      confirmedRevision: 0,
      state: "ready" as const,
    };
    const selected = reduceArticleWorkspace(initial, {
      type: "select",
      article: article(),
    });
    const edited = reduceArticleWorkspace(selected, {
      type: "change-draft",
      changes: { title: "新标题" },
    });
    expect(edited.revision).toBe(1);
    expect(edited.state).toBe("dirty");
    expect(edited.selected?.draft.slug).toBe("新标题");

    const saved = reduceArticleWorkspace(edited, {
      type: "save-succeeded",
      serverArticle: article({ draft: { version: 2, title: "服务器标题" } }),
      requestSnapshot: article(),
      capturedRevision: 0,
    });
    expect(saved.state).toBe("dirty");
    expect(saved.selected?.draft.title).toBe("新标题");
    expect(saved.confirmedRevision).toBe(0);

    expect(reduceArticleWorkspace(saved, { type: "clear" })).toMatchObject({
      selected: null,
      revision: 0,
      state: "ready",
    });
  });

  it("keeps Publication conflict and recovery transitions pure", () => {
    expect(reducePublicationState("ready", { type: "begin" })).toBe(
      "publishing",
    );
    expect(
      reducePublicationState("publishing", {
        type: "confirmed",
        concurrentDraft: false,
      }),
    ).toBe("published");
    expect(
      reducePublicationState("publishing", {
        type: "confirmed",
        concurrentDraft: true,
      }),
    ).toBe("ready");
    expect(
      reducePublicationState("reconciling", {
        type: "reconciled",
        state: "conflict",
      }),
    ).toBe("conflict");
    expect(reducePublicationState("conflict", { type: "acknowledge" })).toBe(
      "ready",
    );
    expect(
      reducePublicationState("not-completed", { type: "draft-changed" }),
    ).toBe("not-completed");
  });

  it("keeps Trash transitions pure", () => {
    expect(
      reduceTrashActionState("ready", { type: "begin", action: "trash" }),
    ).toBe("trashing");
    expect(
      reduceTrashActionState("trashing", {
        type: "succeeded",
        action: "trash",
      }),
    ).toBe("trashed");
    expect(
      reduceTrashActionState("ready", {
        type: "begin",
        action: "restore",
      }),
    ).toBe("restoring");
    expect(
      reduceTrashActionState("restoring", {
        type: "failed",
        action: "restore",
      }),
    ).toBe("restore-error");
    expect(
      reduceTrashActionState("ready", { type: "begin", action: "purge" }),
    ).toBe("purging");
  });

  it("preserves recovery states when a local Draft edit follows a publish attempt", () => {
    for (const state of [
      "publishing",
      "not-completed",
      "conflict",
      "reconciling",
      "state-unconfirmed",
      "transport-error",
    ] as const) {
      expect(preservePublicationRecoveryState(state)).toBe(state);
    }
    expect(preservePublicationRecoveryState("published")).toBe("ready");
    expect(preservePublicationRecoveryState("invalid")).toBe("ready");
  });
});

function inMemoryGateway(seed: Article[]): ArticleWorkspaceGateway {
  let articles = [...seed];
  let trashed: ArticleTrashEntry[] = [];
  const archived = new Map<string, Article>();
  let publicationSequence = 1;
  const unavailable = { ok: false as const, reason: "error" as const };

  function trashEntry(value: Article): ArticleTrashEntry {
    return {
      id: value.id,
      title: value.draft.title,
      slug: value.draft.slug,
      draftVersion: value.draft.version,
      publicationCount: 0,
      currentPublicationId: null,
      trashedAt: "2026-01-04T00:00:00.000Z",
    };
  }

  return {
    async listArticles() {
      return {
        ok: true as const,
        value: articles.map((value) => ({
          ...value,
          lifecycleProjection: value.currentPublicationId
            ? ("published" as const)
            : ("draft" as const),
        })),
      };
    },
    async listTrashedArticles() {
      return { ok: true as const, value: trashed };
    },
    async createArticle() {
      const created = article({ id: `article-${articles.length + 1}` });
      articles = [created, ...articles];
      return { ok: true as const, value: created };
    },
    async readArticle(articleId) {
      const found = articles.find((value) => value.id === articleId);
      return found
        ? { ok: true as const, value: found }
        : { ok: false as const, reason: "not-found" as const };
    },
    async saveDraft(articleId, input: ArticleDraftUpdate) {
      const found = articles.find((value) => value.id === articleId);
      if (!found) return { ok: false as const, reason: "not-found" as const };
      const saved = {
        ...found,
        draft: {
          ...found.draft,
          ...input,
          version: found.draft.version + 1,
          updatedAt: "2026-01-03T00:00:00.000Z",
        },
      };
      articles = articles.map((value) =>
        value.id === articleId ? saved : value,
      );
      return { ok: true as const, value: saved };
    },
    async previewDraft() {
      return unavailable;
    },
    async publishDraft({ articleId, draftVersion }) {
      const found = articles.find((value) => value.id === articleId);
      if (!found) return { ok: false as const, reason: "not-found" as const };
      const publicationId = `11111111-1111-4111-8111-${String(
        publicationSequence++,
      ).padStart(12, "0")}`;
      articles = articles.map((value) =>
        value.id === articleId
          ? { ...value, currentPublicationId: publicationId }
          : value,
      );
      return {
        ok: true as const,
        value: { publicationId, draftVersion },
      };
    },
    async unpublishArticle(articleId) {
      const found = articles.find((value) => value.id === articleId);
      if (!found) return { ok: false as const, reason: "not-found" as const };
      articles = articles.map((value) =>
        value.id === articleId
          ? { ...value, currentPublicationId: null }
          : value,
      );
      return { ok: true as const, value: undefined };
    },
    async readPublicationHistory(articleId) {
      return articles.some((value) => value.id === articleId)
        ? {
            ok: true as const,
            value: { publications: [], hasUnpublishedChanges: false },
          }
        : { ok: false as const, reason: "not-found" as const };
    },
    async restorePublication(
      _input: Parameters<ArticleWorkspaceGateway["restorePublication"]>[0],
    ) {
      return unavailable as {
        ok: false;
        reason: "error";
      };
    },
    async trashArticle(articleId) {
      const found = articles.find((value) => value.id === articleId);
      if (!found) return { ok: false as const, reason: "not-found" as const };
      archived.set(articleId, found);
      articles = articles.filter((value) => value.id !== articleId);
      trashed = [trashEntry(found), ...trashed];
      return { ok: true as const, value: undefined };
    },
    async restoreTrashedArticle(articleId) {
      const found = archived.get(articleId);
      if (!found) return { ok: false as const, reason: "not-found" as const };
      archived.delete(articleId);
      trashed = trashed.filter((value) => value.id !== articleId);
      articles = [found, ...articles];
      return { ok: true as const, value: undefined };
    },
    async purgeTrashedArticle(articleId, confirmationTitle) {
      const found = archived.get(articleId);
      if (!found) return { ok: false as const, reason: "not-found" as const };
      if (found.draft.title !== confirmationTitle)
        return { ok: false as const, reason: "conflict" as const };
      archived.delete(articleId);
      trashed = trashed.filter((value) => value.id !== articleId);
      return { ok: true as const, value: undefined };
    },
    async readPublicArticle(slug) {
      return articles.some(
        (value) =>
          value.currentPublicationId !== null && value.draft.slug === slug,
      )
        ? { ok: true as const, value: { availability: "present" as const } }
        : { ok: true as const, value: { availability: "absent" as const } };
    },
  };
}

describe("Article Workspace gateway seam", () => {
  it("allows an in-memory adapter to replace the Eden adapter", async () => {
    const gateway = inMemoryGateway([article()]);
    const loaded = await gateway.readArticle("article-1");
    expect(loaded).toEqual({
      ok: true,
      value: expect.objectContaining({ id: "article-1" }),
    });

    const saved = await gateway.saveDraft(
      "article-1",
      draftUpdate(article().draft, 1),
    );
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.value.draft.title).toBe("原始标题");

    const missing = await gateway.readArticle("missing");
    expect(missing).toEqual({ ok: false, reason: "not-found" });

    const published = await gateway.publishDraft({
      articleId: "article-1",
      draftVersion: 2,
      expectedCurrentPublicationId: null,
    });
    expect(published.ok).toBe(true);
    if (published.ok) expect(published.value.draftVersion).toBe(2);

    expect((await gateway.unpublishArticle("article-1")).ok).toBe(true);
    expect((await gateway.trashArticle("article-1")).ok).toBe(true);
    const trash = await gateway.listTrashedArticles();
    expect(trash.ok).toBe(true);
    if (trash.ok) expect(trash.value).toHaveLength(1);
    const rejectedPurge = await gateway.purgeTrashedArticle(
      "article-1",
      "wrong title",
    );
    expect(rejectedPurge.ok).toBe(false);
    if (!rejectedPurge.ok) expect(rejectedPurge.reason).toBe("conflict");
    expect((await gateway.restoreTrashedArticle("article-1")).ok).toBe(true);
    expect((await gateway.readArticle("article-1")).ok).toBe(true);
  });
});
