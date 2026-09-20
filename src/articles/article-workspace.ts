import type {
  AdminArticleListItem,
  Article,
  ArticleDraftUpdate,
  ArticleLifecycleProjection,
  ArticlePublicationHistory,
  ArticleTrashEntry,
} from "./articles";
import { slugAfterTitleChange } from "./slug-follow";
import type {
  PublicationIssue,
  PublicationPreview,
  PublicationReceipt,
} from "./publication-workflow";
import type { PublicationRestorationIssue } from "./publication-restoration";

/** States owned by the Article workspace's editor binding. */
export type WorkspaceState =
  | "loading"
  | "ready"
  | "creating"
  | "dirty"
  | "saving"
  | "saved"
  | "invalid"
  | "conflict"
  | "slug-conflict"
  | "failed"
  | "offline";

/** States owned by the Trash actions in the Article workspace. */
export type TrashActionState =
  | "ready"
  | "trashing"
  | "trashed"
  | "trash-error"
  | "restoring"
  | "restored"
  | "restore-error"
  | "purging"
  | "purged"
  | "purge-error";

/** States owned by the Publication actions in the Article workspace. */
export type PublishState =
  | "ready"
  | "publishing"
  | "published"
  | "invalid"
  | "conflict"
  | "not-completed"
  | "reconciling"
  | "state-unconfirmed"
  | "transport-error"
  | "error";

export type PublicationReconciliationTerminalState = Extract<
  PublishState,
  "conflict" | "state-unconfirmed" | "transport-error"
>;

/** Commands that keep Publication transitions independent of React. */
export type ArticleWorkspacePublicationCommand =
  | { type: "begin" }
  | { type: "confirmed"; concurrentDraft: boolean }
  | { type: "invalid" }
  | { type: "not-completed" }
  | { type: "reconciling" }
  | { type: "reconciled"; state: PublicationReconciliationTerminalState }
  | { type: "error" }
  | { type: "acknowledge" }
  | { type: "draft-changed" }
  | { type: "reset" }
  | { type: "unpublished" };

/** Pure Publication state transitions used by the workspace binding. */
export function reducePublicationState(
  state: PublishState,
  command: ArticleWorkspacePublicationCommand,
): PublishState {
  switch (command.type) {
    case "begin":
      return "publishing";
    case "confirmed":
      return command.concurrentDraft ? "ready" : "published";
    case "invalid":
      return "invalid";
    case "not-completed":
      return "not-completed";
    case "reconciling":
      return "reconciling";
    case "reconciled":
      return command.state;
    case "error":
      return "error";
    case "acknowledge":
      return ["conflict", "state-unconfirmed", "transport-error"].includes(
        state,
      )
        ? "ready"
        : state;
    case "draft-changed":
      return preservePublicationRecoveryState(state);
    case "reset":
    case "unpublished":
      return "ready";
  }
}

export type ArticleWorkspaceTrashCommand =
  | { type: "reset" }
  | { type: "begin"; action: "trash" | "restore" | "purge" }
  | { type: "succeeded"; action: "trash" | "restore" | "purge" }
  | { type: "failed"; action: "trash" | "restore" | "purge" };

/** Pure Trash lifecycle transitions used by the workspace binding. */
export function reduceTrashActionState(
  _state: TrashActionState,
  command: ArticleWorkspaceTrashCommand,
): TrashActionState {
  if (command.type === "reset") return "ready";
  if (command.type === "begin") {
    return command.action === "trash"
      ? "trashing"
      : command.action === "restore"
        ? "restoring"
        : "purging";
  }
  if (command.type === "succeeded") {
    return command.action === "trash"
      ? "trashed"
      : command.action === "restore"
        ? "restored"
        : "purged";
  }
  return command.action === "trash"
    ? "trash-error"
    : command.action === "restore"
      ? "restore-error"
      : "purge-error";
}

type EditableArticleDraft = Pick<
  Article["draft"],
  | "title"
  | "slug"
  | "slugIsManual"
  | "summary"
  | "tags"
  | "byline"
  | "language"
  | "channelSlug"
  | "cover"
  | "document"
>;

export type PublicationReceiptConfirmation = Pick<
  PublicationReceipt,
  "publicationId" | "draftVersion"
>;

export interface ArticleDraftIssue {
  readonly message: string;
}

export type PublicArticleAvailability = "present" | "absent" | "unknown";

export type ArticleWorkspaceGatewayFailureReason =
  | "invalid"
  | "conflict"
  | "slug-conflict"
  | "not-found"
  | "not-completed"
  | "state-unconfirmed"
  | "transport-error"
  | "error";

/** A transport-independent result returned by every workspace gateway call. */
export type ArticleWorkspaceGatewayOutcome<Value, Issue = unknown> =
  | { ok: true; value: Value }
  | {
      ok: false;
      reason: ArticleWorkspaceGatewayFailureReason;
      issues?: readonly Issue[];
    };

/**
 * Everything the Article workspace can ask of persistence and public reads.
 * The production adapter hides Eden paths and HTTP response shapes; tests use
 * an in-memory adapter against this same interface.
 */
export interface ArticleWorkspaceGateway {
  listArticles(): Promise<
    ArticleWorkspaceGatewayOutcome<AdminArticleListItem[]>
  >;
  listTrashedArticles(): Promise<
    ArticleWorkspaceGatewayOutcome<ArticleTrashEntry[]>
  >;
  createArticle(): Promise<ArticleWorkspaceGatewayOutcome<Article>>;
  readArticle(
    articleId: string,
  ): Promise<ArticleWorkspaceGatewayOutcome<Article>>;
  saveDraft(
    articleId: string,
    draft: ArticleDraftUpdate,
  ): Promise<ArticleWorkspaceGatewayOutcome<Article, ArticleDraftIssue>>;
  previewDraft(
    articleId: string,
    draftVersion: number,
  ): Promise<
    ArticleWorkspaceGatewayOutcome<PublicationPreview, PublicationIssue>
  >;
  /** A successful receipt is already matched to articleId and draftVersion. */
  publishDraft(input: {
    articleId: string;
    draftVersion: number;
    expectedCurrentPublicationId: string | null;
  }): Promise<
    ArticleWorkspaceGatewayOutcome<
      PublicationReceiptConfirmation,
      PublicationIssue
    >
  >;
  unpublishArticle(
    articleId: string,
  ): Promise<ArticleWorkspaceGatewayOutcome<void>>;
  readPublicationHistory(
    articleId: string,
  ): Promise<ArticleWorkspaceGatewayOutcome<ArticlePublicationHistory>>;
  restorePublication(input: {
    articleId: string;
    publicationId: string;
    draftVersion: number;
  }): Promise<
    ArticleWorkspaceGatewayOutcome<Article, PublicationRestorationIssue>
  >;
  trashArticle(
    articleId: string,
  ): Promise<ArticleWorkspaceGatewayOutcome<void>>;
  restoreTrashedArticle(
    articleId: string,
  ): Promise<ArticleWorkspaceGatewayOutcome<void>>;
  purgeTrashedArticle(
    articleId: string,
    confirmationTitle: string,
  ): Promise<ArticleWorkspaceGatewayOutcome<void>>;
  readPublicArticle(
    slug: string,
  ): Promise<
    ArticleWorkspaceGatewayOutcome<{ availability: PublicArticleAvailability }>
  >;
}

/** The React-free editor slice observed by the workspace binding. */
export interface ArticleWorkspaceEditorState {
  readonly selected: Article | null;
  readonly revision: number;
  readonly confirmedRevision: number;
  readonly state: WorkspaceState;
}

export type ArticleWorkspaceCommand =
  | { type: "select"; article: Article }
  | { type: "change-draft"; changes: Partial<Article["draft"]> }
  | {
      type: "save-succeeded";
      serverArticle: Article;
      requestSnapshot: Article;
      capturedRevision: number;
    }
  | { type: "clear" };

/**
 * Pure Article workspace state machine. React owns subscription and effects;
 * this interface owns the editor's observable state transitions.
 */
export function reduceArticleWorkspace(
  state: ArticleWorkspaceEditorState,
  command: ArticleWorkspaceCommand,
): ArticleWorkspaceEditorState {
  switch (command.type) {
    case "select":
      return {
        selected: command.article,
        revision: 0,
        confirmedRevision: 0,
        state: "ready",
      };
    case "change-draft": {
      if (!state.selected) return state;
      return {
        selected: applyDraftChanges(state.selected, command.changes),
        revision: state.revision + 1,
        confirmedRevision: state.confirmedRevision,
        state: "dirty",
      };
    }
    case "save-succeeded": {
      const local = state.selected;
      const localChanged = state.revision !== command.capturedRevision;
      const localArticle =
        local?.id === command.serverArticle.id ? local : null;
      const lifecycleMerged = mergeConcurrentCurrentPublication(
        command.serverArticle,
        command.requestSnapshot,
        localArticle,
      ).article;
      const selected =
        localChanged && localArticle
          ? preserveLocalDraft(lifecycleMerged, localArticle)
          : lifecycleMerged;
      return {
        selected,
        revision: state.revision,
        confirmedRevision: command.capturedRevision,
        state: localChanged ? "dirty" : "saved",
      };
    }
    case "clear":
      return {
        selected: null,
        revision: 0,
        confirmedRevision: 0,
        state: "ready",
      };
  }
}

/**
 * The list projection is a server-owned value when present. Older Article
 * responses do not carry it, so the workspace keeps a conservative fallback
 * for those responses.
 */
export function articleLifecycleProjection(
  article: Article,
): ArticleLifecycleProjection {
  if (
    "lifecycleProjection" in article &&
    isArticleLifecycleProjection(
      (article as AdminArticleListItem).lifecycleProjection,
    )
  ) {
    return (article as AdminArticleListItem).lifecycleProjection;
  }
  return article.currentPublicationId !== null ? "published" : "draft";
}

function isArticleLifecycleProjection(
  value: unknown,
): value is ArticleLifecycleProjection {
  return (
    value === "draft" ||
    value === "published" ||
    value === "changes-pending" ||
    value === "unpublished"
  );
}

export function withLifecycleProjection(
  article: Article,
  lifecycleProjection: ArticleLifecycleProjection,
): AdminArticleListItem {
  return { ...article, lifecycleProjection };
}

function editableArticleDraft(draft: Article["draft"]): EditableArticleDraft {
  const {
    title,
    slug,
    slugIsManual,
    summary,
    tags,
    byline,
    language,
    channelSlug,
    cover,
    document,
  } = draft;
  return {
    title,
    slug,
    slugIsManual,
    summary,
    tags,
    byline,
    language,
    channelSlug,
    cover,
    document,
  };
}

/** Build the transport-safe Draft update from an Article Draft. */
export function draftUpdate(
  draft: Article["draft"],
  version = draft.version,
): ArticleDraftUpdate {
  return {
    version,
    ...editableArticleDraft(draft),
  };
}

/**
 * Apply an editor command without touching React state or the network.
 * Title changes follow the Slug only while the Draft still owns an automatic
 * Slug; explicit Slug edits remain untouched.
 */
export function applyDraftChanges(
  article: Article,
  changes: Partial<Article["draft"]>,
): Article {
  let draft = { ...article.draft, ...changes };
  if ("title" in changes && !("slug" in changes) && !draft.slugIsManual) {
    const followed = slugAfterTitleChange(
      { mode: "auto", slug: draft.slug },
      draft.title,
    );
    draft = { ...draft, slug: followed.slug, slugIsManual: false };
  }
  return { ...article, draft };
}

/** Keep locally edited Draft fields when a concurrent server read completes. */
export function preserveLocalDraft(server: Article, local: Article): Article {
  return {
    ...server,
    draft: {
      ...server.draft,
      ...editableArticleDraft(local.draft),
    },
  };
}

/** Keep the complete local Draft when it is newer than the server Draft. */
export function preserveNewestLocalDraft(
  server: Article,
  local: Article,
): Article {
  const merged = preserveLocalDraft(server, local);
  return local.draft.version > server.draft.version
    ? { ...merged, draft: local.draft }
    : merged;
}

/** Validate the small, stable part of a Publication receipt used by the UI. */
export function publicationReceiptConfirmation(
  value: unknown,
  expectedArticleId: string,
): PublicationReceiptConfirmation | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const article = candidate.article;
  if (typeof article !== "object" || article === null) return null;
  const publicationId = candidate.publicationId;
  const draftVersion = candidate.draftVersion;
  if (
    typeof publicationId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      publicationId,
    ) ||
    typeof draftVersion !== "number" ||
    !Number.isInteger(draftVersion) ||
    draftVersion < 1 ||
    !("id" in article) ||
    article.id !== expectedArticleId
  ) {
    return null;
  }
  return { publicationId, draftVersion };
}

/**
 * Preserve a locally observed Current Publication pointer while a stale read
 * is in flight. This prevents a background refresh from undoing a concurrent
 * Publish/Unpublish action made in another view.
 */
export function mergeConcurrentCurrentPublication(
  server: Article,
  requestSnapshot: Article | null,
  local: Article | null,
): { article: Article; currentPublicationChanged: boolean } {
  if (
    !requestSnapshot ||
    !local ||
    requestSnapshot.id !== server.id ||
    local.id !== server.id ||
    local.currentPublicationId === requestSnapshot.currentPublicationId
  ) {
    return { article: server, currentPublicationChanged: false };
  }

  return {
    article: { ...server, currentPublicationId: local.currentPublicationId },
    currentPublicationChanged: true,
  };
}

export function replaceArticlePreservingConcurrentCurrentPublication(
  articles: readonly Article[],
  server: Article,
  requestSnapshot: Article | null,
): Article[] {
  return articles.map((local) =>
    local.id === server.id
      ? mergeConcurrentCurrentPublication(server, requestSnapshot, local)
          .article
      : local,
  );
}

/** Preserve a retry/reconciliation state when a Draft is edited locally. */
export function preservePublicationRecoveryState(
  state: PublishState,
): PublishState {
  return [
    "publishing",
    "not-completed",
    "conflict",
    "reconciling",
    "state-unconfirmed",
    "transport-error",
  ].includes(state)
    ? state
    : "ready";
}
