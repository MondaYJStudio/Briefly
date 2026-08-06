import { useBlocker } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  ARTICLE_DRAFT_AUTOSAVE_DEBOUNCE_MS,
  type AdminArticleListItem,
  type Article,
  type ArticleDraftUpdate,
  type ArticleLifecycleProjection,
  type ArticlePublicationHistory,
  type ArticlePublicationHistoryEntry,
  type ArticleTrashEntry,
} from "../../articles/articles";
import { slugAfterTitleChange } from "../../articles/slug-follow";

export function articleLifecycleProjection(
  article: Article,
): ArticleLifecycleProjection {
  if (
    "lifecycleProjection" in article &&
    typeof (article as AdminArticleListItem).lifecycleProjection === "string"
  ) {
    return (article as AdminArticleListItem).lifecycleProjection;
  }
  return article.currentPublicationId !== null ? "published" : "draft";
}

function withLifecycleProjection(
  article: Article,
  lifecycleProjection: ArticleLifecycleProjection,
): AdminArticleListItem {
  return { ...article, lifecycleProjection };
}
import {
  isPublicationRestorationIssue,
  type PublicationRestorationIssue,
} from "../../articles/publication-restoration";
import {
  isPublicationIssue,
  type PublicationIssue,
  type PublicationPreview,
  type PublicationReceipt,
} from "../../articles/publication-workflow";
import { getApiClient } from "../../routes/api.$";

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

type EditableArticleDraft = Pick<
  Article["draft"],
  | "title"
  | "slug"
  | "slugIsManual"
  | "summary"
  | "tags"
  | "byline"
  | "language"
  | "cover"
  | "document"
>;

function editableArticleDraft(draft: Article["draft"]): EditableArticleDraft {
  const {
    title,
    slug,
    slugIsManual,
    summary,
    tags,
    byline,
    language,
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
    cover,
    document,
  };
}

function draftUpdate(
  draft: Article["draft"],
  version = draft.version,
): ArticleDraftUpdate {
  return {
    version,
    ...editableArticleDraft(draft),
  };
}

function preserveLocalDraft(server: Article, local: Article): Article {
  return {
    ...server,
    draft: {
      ...server.draft,
      ...editableArticleDraft(local.draft),
    },
  };
}

function preserveNewestLocalDraft(server: Article, local: Article): Article {
  const merged = preserveLocalDraft(server, local);
  return local.draft.version > server.draft.version
    ? { ...merged, draft: local.draft }
    : merged;
}

type PublicationReceiptConfirmation = Pick<
  PublicationReceipt,
  "publicationId" | "draftVersion"
>;

function publicationReceiptConfirmationFromApi(
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

function mergeConcurrentCurrentPublication(
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

function replaceArticlePreservingConcurrentCurrentPublication(
  articles: Article[],
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

interface PublishAttempt {
  snapshot: Article;
  capturedRevision: number;
}

type PublishState =
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

function publicationErrorCode(value: unknown): string | null {
  return typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string"
    ? value.code
    : null;
}

function publicationErrorIssues(value: unknown): PublicationIssue[] {
  if (
    typeof value !== "object" ||
    value === null ||
    !("issues" in value) ||
    !Array.isArray(value.issues)
  ) {
    return [];
  }
  return value.issues.filter(isPublicationIssue);
}

function preservePublicationRecoveryState(state: PublishState): PublishState {
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

async function loadTrashedArticles(): Promise<ArticleTrashEntry[]> {
  const response = await getApiClient().admin.trash.articles.get();
  if (response.status !== 200 || !response.data)
    throw new Error("Trash unavailable");
  return response.data.articles as ArticleTrashEntry[];
}

/**
 * The complete Article workspace state machine: list, autosave, preview,
 * publish / unpublish, history restore and trash lifecycle. Extracted
 * verbatim from the former monolithic admin route so each view only renders.
 */
export function useArticleWorkspace() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [trashedArticles, setTrashedArticles] = useState<ArticleTrashEntry[]>(
    [],
  );
  const [trashViewState, setTrashViewState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [trashActionState, setTrashActionState] =
    useState<TrashActionState>("ready");
  const [listError, setListError] = useState(false);
  const [createError, setCreateError] = useState(false);
  const [listActionPendingId, setListActionPendingId] = useState<string | null>(
    null,
  );
  const [selected, setSelected] = useState<Article | null>(null);
  const [state, setState] = useState<WorkspaceState>("loading");
  const [isOnline, setIsOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine,
  );
  const [issues, setIssues] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [confirmedRevision, setConfirmedRevision] = useState(0);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [conflictCopy, setConflictCopy] = useState<ArticleDraftUpdate | null>(
    null,
  );
  const selectedRef = useRef<Article | null>(null);
  const revisionRef = useRef(0);
  const confirmedRevisionRef = useRef(0);
  const savingRef = useRef(false);
  const publishPendingRef = useRef(false);
  const restorePendingRef = useRef(false);
  const trashLifecyclePendingRef = useRef(false);
  const draftLoadGeneration = useRef(0);
  const [preview, setPreview] = useState<PublicationPreview | null>(null);
  const [previewIssues, setPreviewIssues] = useState<PublicationIssue[]>([]);
  const [previewState, setPreviewState] = useState<
    "idle" | "loading" | "ready" | "invalid" | "conflict" | "error"
  >("idle");
  const previewRequestGeneration = useRef(0);
  const [publishState, setPublishState] = useState<PublishState>("ready");
  const [publicationIssues, setPublicationIssues] = useState<
    PublicationIssue[]
  >([]);
  const [publicationReceipt, setPublicationReceipt] =
    useState<PublicationReceiptConfirmation | null>(null);
  const [publicationReconciliationState, setPublicationReconciliationState] =
    useState<"idle" | "reconciled" | "failed">("idle");
  const retryablePublishAttemptRef = useRef<PublishAttempt | null>(null);
  const [publicationAction, setPublicationAction] = useState<
    "published" | "republished" | null
  >(null);
  const [unpublishState, setUnpublishState] = useState<
    "ready" | "unpublishing" | "unpublished" | "error"
  >("ready");
  const [publicationHistory, setPublicationHistory] = useState<
    ArticlePublicationHistoryEntry[]
  >([]);
  const [historyHasUnpublishedChanges, setHistoryHasUnpublishedChanges] =
    useState(false);
  const [historyState, setHistoryState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const historyRequestGeneration = useRef(0);
  const [restoreState, setRestoreState] = useState<
    "ready" | "restoring" | "restored" | "invalid" | "conflict" | "error"
  >("ready");
  const [restoreIssues, setRestoreIssues] = useState<
    PublicationRestorationIssue[]
  >([]);

  function resetPublicationHistory() {
    historyRequestGeneration.current += 1;
    setPublicationHistory([]);
    setHistoryHasUnpublishedChanges(false);
    setHistoryState("idle");
    setRestoreState("ready");
    setRestoreIssues([]);
  }

  function resetPreview() {
    previewRequestGeneration.current += 1;
    setPreview(null);
    setPreviewIssues([]);
    setPreviewState("idle");
  }

  function selectServerDraft(
    article: Article,
    options: {
      preservePublicationHistory?: boolean;
      preserveUnpublishFeedback?: boolean;
    } = {},
  ) {
    draftLoadGeneration.current += 1;
    selectedRef.current = article;
    revisionRef.current = 0;
    confirmedRevisionRef.current = 0;
    setSelected(article);
    setRevision(0);
    setConfirmedRevision(0);
    setEditorGeneration((current) => current + 1);
    retryablePublishAttemptRef.current = null;
    setPublicationIssues([]);
    setPublicationReceipt(null);
    setPublicationReconciliationState("idle");
    if (!options.preserveUnpublishFeedback) {
      setUnpublishState((current) =>
        current === "unpublishing" ? current : "ready",
      );
    }
    if (!options.preservePublicationHistory) resetPublicationHistory();
    resetPreview();
  }

  async function reloadArticles(options: { soft?: boolean } = {}) {
    const soft = options.soft === true;
    if (!soft && selectedRef.current === null) {
      setState((current) =>
        current === "failed" || current === "ready" ? "loading" : current,
      );
    }
    try {
      const response = await getApiClient().admin.articles.get();
      if (response.status !== 200 || !response.data)
        throw new Error("Articles unavailable");
      const listed = response.data.articles as AdminArticleListItem[];
      setArticles(listed);
      setListError(false);
      setState((current) =>
        selectedRef.current === null &&
        (current === "loading" || current === "failed")
          ? "ready"
          : current,
      );
    } catch {
      setListError(true);
      setState((current) =>
        current === "loading" && selectedRef.current === null
          ? "failed"
          : current,
      );
    }
  }

  useEffect(() => {
    let active = true;
    void getApiClient()
      .admin.articles.get()
      .then((response) => {
        if (response.status !== 200 || !response.data)
          throw new Error("Articles unavailable");
        if (active) {
          const listed = response.data.articles as AdminArticleListItem[];
          setArticles((current) => [
            ...current,
            ...listed.filter(
              (serverArticle) =>
                !current.some(
                  (localArticle) => localArticle.id === serverArticle.id,
                ),
            ),
          ]);
          setListError(false);
          setState((current) =>
            current === "loading" && selectedRef.current === null
              ? "ready"
              : current,
          );
        }
      })
      .catch(() => {
        if (active) {
          setListError(true);
          setState((current) =>
            current === "loading" && selectedRef.current === null
              ? "failed"
              : current,
          );
        }
      });
    void loadTrashedArticles()
      .then((trashEntries) => {
        if (active) {
          setTrashedArticles(trashEntries);
          setTrashViewState("ready");
        }
      })
      .catch(() => {
        if (active) setTrashViewState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  async function createDraft(): Promise<Article | null> {
    if (lifecycleActionPending) return null;
    setCreateError(false);
    setState("creating");
    setIssues([]);
    try {
      const response = await getApiClient().admin.articles.post();
      if (response.status !== 201 || !response.data)
        throw new Error("Article creation failed");
      const created = withLifecycleProjection(response.data, "draft");
      setArticles((current) => [
        created,
        ...current.filter((article) => article.id !== created.id),
      ]);
      selectServerDraft(created);
      setConflictCopy(null);
      setState("ready");
      setPublishState("ready");
      setPublicationAction(null);
      setTrashActionState("ready");
      return created;
    } catch {
      setCreateError(true);
      setState((current) => (current === "creating" ? "ready" : current));
      return null;
    }
  }

  async function publishListedArticle(article: Article): Promise<boolean> {
    if (lifecycleActionPending || listActionPendingId !== null) return false;
    setListActionPendingId(article.id);
    try {
      const response = await getApiClient()
        .admin.articles({ articleId: article.id })
        .publications.post({
          draftVersion: article.draft.version,
          expectedCurrentPublicationId: article.currentPublicationId,
        });
      if (response.status !== 201 || !response.data) return false;
      await reloadArticles({ soft: true });
      return true;
    } catch {
      return false;
    } finally {
      setListActionPendingId(null);
    }
  }

  async function unpublishListedArticle(article: Article): Promise<boolean> {
    if (
      !article.currentPublicationId ||
      lifecycleActionPending ||
      listActionPendingId !== null
    ) {
      return false;
    }
    setListActionPendingId(article.id);
    try {
      const response = await getApiClient()
        .admin.articles({ articleId: article.id })
        ["current-publication"].delete();
      if (response.status !== 200 || !response.data) return false;
      setArticles((current) =>
        current.map((row) =>
          row.id === article.id
            ? withLifecycleProjection(
                { ...row, currentPublicationId: null },
                "unpublished",
              )
            : row,
        ),
      );
      return true;
    } catch {
      return false;
    } finally {
      setListActionPendingId(null);
    }
  }

  async function moveListedArticleToTrash(article: Article): Promise<boolean> {
    if (
      articleSelectionDisabled ||
      lifecycleActionPending ||
      listActionPendingId !== null ||
      trashLifecyclePendingRef.current
    ) {
      return false;
    }
    setListActionPendingId(article.id);
    trashLifecyclePendingRef.current = true;
    try {
      const response = await getApiClient()
        .admin.articles({ articleId: article.id })
        .trash.post();
      if (response.status !== 200 || !response.data) return false;
      setArticles((current) => current.filter((row) => row.id !== article.id));
      if (selectedRef.current?.id === article.id) clearSelectedArticle();
      await reloadTrashView();
      return true;
    } catch {
      return false;
    } finally {
      trashLifecyclePendingRef.current = false;
      setListActionPendingId(null);
    }
  }

  async function loadDraft(articleId: string): Promise<Article | null> {
    if (lifecycleActionPending) return null;
    const loadGeneration = ++draftLoadGeneration.current;
    const requestSnapshot = selectedRef.current;
    setState("loading");
    setIssues([]);
    try {
      const response = await getApiClient().admin.articles({ articleId }).get();
      if (response.status !== 200 || !response.data)
        throw new Error("Article unavailable");
      if (loadGeneration !== draftLoadGeneration.current) return null;
      const merged = mergeConcurrentCurrentPublication(
        response.data,
        requestSnapshot,
        selectedRef.current,
      );
      selectServerDraft(merged.article, {
        preserveUnpublishFeedback: merged.currentPublicationChanged,
      });
      setState("ready");
      setPublishState("ready");
      setPublicationAction(null);
      setTrashActionState("ready");
      return merged.article;
    } catch {
      if (loadGeneration === draftLoadGeneration.current) {
        setState(selectedRef.current ? "saved" : "ready");
      }
      return null;
    }
  }

  const persistCurrentDraft = useCallback(async (version?: number) => {
    const snapshot = selectedRef.current;
    if (
      !snapshot ||
      savingRef.current ||
      restorePendingRef.current ||
      trashLifecyclePendingRef.current
    )
      return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setState("offline");
      return;
    }

    const capturedRevision = revisionRef.current;
    const saveGeneration = draftLoadGeneration.current;
    const input = draftUpdate(snapshot.draft, version);
    savingRef.current = true;
    setState("saving");
    setIssues([]);

    try {
      const response = await getApiClient()
        .admin.articles({ articleId: snapshot.id })
        .draft.put(input);
      if (
        saveGeneration !== draftLoadGeneration.current ||
        selectedRef.current?.id !== snapshot.id
      ) {
        return;
      }
      if (response.status === 200 && response.data) {
        const local = selectedRef.current;
        const localArticle = local?.id === response.data.id ? local : null;
        const localChanged = revisionRef.current !== capturedRevision;
        const lifecycleMerged = mergeConcurrentCurrentPublication(
          response.data,
          snapshot,
          localArticle,
        ).article;
        const next =
          localChanged && localArticle
            ? preserveLocalDraft(lifecycleMerged, localArticle)
            : lifecycleMerged;
        selectedRef.current = next;
        setSelected(next);
        setArticles((current) =>
          replaceArticlePreservingConcurrentCurrentPublication(
            current,
            next,
            snapshot,
          ),
        );
        setPublishState(preservePublicationRecoveryState);
        confirmedRevisionRef.current = capturedRevision;
        setConfirmedRevision(capturedRevision);
        setConflictCopy(null);
        resetPreview();
        setState(localChanged ? "dirty" : "saved");
        return;
      }

      const error = response.error?.value;
      if (
        response.status === 409 &&
        error &&
        "code" in error &&
        error.code === "ARTICLE_SLUG_CONFLICT"
      ) {
        setConflictCopy(null);
        setState("slug-conflict");
      } else if (response.status === 409) {
        const local = selectedRef.current;
        setConflictCopy(
          local?.id === snapshot.id
            ? draftUpdate(local.draft, input.version)
            : input,
        );
        setState("conflict");
      } else if (error && "issues" in error) {
        setIssues(error.issues.map((issue) => issue.message));
        setState("invalid");
      } else {
        setState("failed");
      }
    } catch {
      if (
        saveGeneration !== draftLoadGeneration.current ||
        selectedRef.current?.id !== snapshot.id
      ) {
        return;
      }
      setState(
        typeof navigator !== "undefined" && !navigator.onLine
          ? "offline"
          : "failed",
      );
    } finally {
      savingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (state !== "dirty" || revision === confirmedRevision) return;
    const timer = globalThis.setTimeout(() => {
      void persistCurrentDraft();
    }, ARTICLE_DRAFT_AUTOSAVE_DEBOUNCE_MS);
    return () => globalThis.clearTimeout(timer);
  }, [confirmedRevision, persistCurrentDraft, revision, state]);

  useEffect(() => {
    function markOffline() {
      setIsOnline(false);
      if (revisionRef.current !== confirmedRevisionRef.current)
        setState("offline");
    }
    function markOnline() {
      setIsOnline(true);
      setState((current) => (current === "offline" ? "failed" : current));
    }
    setIsOnline(navigator.onLine);
    globalThis.addEventListener("offline", markOffline);
    globalThis.addEventListener("online", markOnline);
    return () => {
      globalThis.removeEventListener("offline", markOffline);
      globalThis.removeEventListener("online", markOnline);
    };
  }, []);

  function updateDraft(changes: Partial<Article["draft"]>) {
    const current = selectedRef.current;
    if (
      !current ||
      restorePendingRef.current ||
      trashLifecyclePendingRef.current
    )
      return;
    let draft = { ...current.draft, ...changes };
    if ("title" in changes && !("slug" in changes) && !draft.slugIsManual) {
      const followed = slugAfterTitleChange(
        { mode: "auto", slug: draft.slug },
        draft.title,
      );
      draft = { ...draft, slug: followed.slug, slugIsManual: false };
    }
    const next = { ...current, draft };
    const nextRevision = revisionRef.current + 1;
    selectedRef.current = next;
    revisionRef.current = nextRevision;
    setSelected(next);
    setRevision(nextRevision);
    setIssues([]);
    setState("dirty");
    if (!publishPendingRef.current) {
      setPublishState(preservePublicationRecoveryState);
      setPublicationAction(null);
      setPublicationReceipt(null);
      setPublicationIssues([]);
    }
    if (current.currentPublicationId !== null || historyState === "ready") {
      setHistoryHasUnpublishedChanges(true);
    }
    setRestoreState((current) => (current === "restoring" ? current : "ready"));
    setRestoreIssues([]);
  }

  async function reloadDraft() {
    if (lifecycleActionPending) return;
    const requestSnapshot = selectedRef.current;
    if (!requestSnapshot) return;
    setState("loading");
    try {
      const response = await getApiClient()
        .admin.articles({ articleId: requestSnapshot.id })
        .get();
      if (response.status !== 200 || !response.data)
        throw new Error("Article unavailable");
      const merged = mergeConcurrentCurrentPublication(
        response.data,
        requestSnapshot,
        selectedRef.current,
      );
      selectServerDraft(merged.article, {
        preserveUnpublishFeedback: merged.currentPublicationChanged,
      });
      setArticles((current) =>
        replaceArticlePreservingConcurrentCurrentPublication(
          current,
          merged.article,
          requestSnapshot,
        ),
      );
      setState("ready");
      setPublishState("ready");
      setPublicationAction(null);
    } catch {
      setState("failed");
    }
  }

  async function retryConflict() {
    if (lifecycleActionPending) return;
    const local = selectedRef.current;
    if (!local) return;
    setState("loading");
    try {
      const response = await getApiClient()
        .admin.articles({
          articleId: local.id,
        })
        .get();
      if (response.status !== 200 || !response.data)
        throw new Error("Article unavailable");
      const current = selectedRef.current;
      const currentArticle = current?.id === response.data.id ? current : local;
      const lifecycleMerged = mergeConcurrentCurrentPublication(
        response.data,
        local,
        currentArticle,
      ).article;
      const retry = preserveLocalDraft(lifecycleMerged, currentArticle);
      selectedRef.current = retry;
      setSelected(retry);
      await persistCurrentDraft(response.data.draft.version);
    } catch {
      setState("failed");
    }
  }

  const hasUnsavedChanges = revision !== confirmedRevision;
  const serverConfirmed =
    selected !== null &&
    isOnline &&
    !hasUnsavedChanges &&
    ["ready", "saved"].includes(state);
  const lifecycleActionPending =
    publishState === "publishing" ||
    publishState === "reconciling" ||
    unpublishState === "unpublishing" ||
    restoreState === "restoring" ||
    trashActionState === "trashing" ||
    trashActionState === "restoring" ||
    trashActionState === "purging";
  const publishActionDisabled =
    !selected ||
    !serverConfirmed ||
    publishState !== "ready" ||
    lifecycleActionPending;
  const unpublishActionDisabled =
    !selected?.currentPublicationId ||
    lifecycleActionPending ||
    state === "loading" ||
    state === "creating";
  const trashActionDisabled =
    !selected || !serverConfirmed || lifecycleActionPending;
  const articleSelectionDisabled = hasUnsavedChanges || lifecycleActionPending;
  const editorLocked =
    restoreState === "restoring" ||
    trashActionState === "trashing" ||
    trashActionState === "restoring" ||
    trashActionState === "purging";
  const blocker = useBlocker({
    shouldBlockFn: () => hasUnsavedChanges,
    enableBeforeUnload: hasUnsavedChanges,
    withResolver: true,
  });

  async function previewSavedDraft() {
    const previewSource = selectedRef.current;
    if (!previewSource || lifecycleActionPending) return;
    const previewGeneration = ++previewRequestGeneration.current;
    const articleId = previewSource.id;
    const version = previewSource.draft.version;
    setPreview(null);
    setPreviewIssues([]);
    setPreviewState("loading");

    try {
      const response = await getApiClient()
        .admin.articles({ articleId })
        .preview.post({ draftVersion: version });
      if (previewGeneration !== previewRequestGeneration.current) return;
      if (response.status === 200 && response.data) {
        setPreview(response.data as PublicationPreview);
        setPreviewState("ready");
        return;
      }

      if (response.status === 409) {
        setPreviewState("conflict");
        return;
      }
      const error: unknown = response.error?.value;
      if (
        typeof error === "object" &&
        error !== null &&
        "issues" in error &&
        Array.isArray(error.issues)
      ) {
        const structuredIssues = error.issues.filter(isPublicationIssue);
        setPreviewIssues(structuredIssues);
        setPreviewState("invalid");
        return;
      }
      setPreviewState("error");
    } catch {
      if (previewGeneration === previewRequestGeneration.current)
        setPreviewState("error");
    }
  }

  function acceptPublicationReceipt(
    attempt: PublishAttempt,
    receipt: PublicationReceiptConfirmation,
  ) {
    const { snapshot, capturedRevision } = attempt;
    const hasConcurrentDraft = revisionRef.current !== capturedRevision;
    retryablePublishAttemptRef.current = null;
    setArticles((current) =>
      current.map((article) =>
        article.id === snapshot.id
          ? { ...article, currentPublicationId: receipt.publicationId }
          : article,
      ),
    );

    const local = selectedRef.current;
    if (local?.id !== snapshot.id) return;
    const next = { ...local, currentPublicationId: receipt.publicationId };
    selectedRef.current = next;
    setSelected(next);
    setPublicationReceipt(receipt);
    setPublicationAction(
      snapshot.currentPublicationId === null ? "published" : "republished",
    );
    setUnpublishState("ready");
    setTrashActionState("ready");
    resetPublicationHistory();
    if (hasConcurrentDraft) setHistoryHasUnpublishedChanges(true);
    setPublishState(hasConcurrentDraft ? "ready" : "published");
  }

  async function reconcilePublicationState(
    attempt: PublishAttempt,
    terminalState: "conflict" | "state-unconfirmed" | "transport-error",
  ) {
    const { snapshot, capturedRevision } = attempt;
    retryablePublishAttemptRef.current = null;
    setPublicationReceipt(null);
    if (selectedRef.current?.id === snapshot.id) {
      setPublishState("reconciling");
    }

    const historyGeneration = ++historyRequestGeneration.current;
    const [articleRead, historyRead] = await Promise.allSettled([
      getApiClient().admin.articles({ articleId: snapshot.id }).get(),
      getApiClient()
        .admin.articles({ articleId: snapshot.id })
        .publications.get(),
    ]);

    let articleReadCompleted = false;
    let historyReadCompleted = false;
    let publicSlug = snapshot.draft.slug;
    let refreshedCurrentPublicationId = snapshot.currentPublicationId;
    let localDraftChanged = revisionRef.current !== capturedRevision;

    if (
      articleRead.status === "fulfilled" &&
      articleRead.value.status === 200 &&
      articleRead.value.data
    ) {
      articleReadCompleted = true;
      const serverArticle = articleRead.value.data as Article;
      refreshedCurrentPublicationId = serverArticle.currentPublicationId;
      const local = selectedRef.current;
      const stillSelected = local?.id === snapshot.id;
      localDraftChanged =
        stillSelected && revisionRef.current !== capturedRevision;
      const next =
        stillSelected && localDraftChanged
          ? preserveNewestLocalDraft(serverArticle, local)
          : serverArticle;

      setArticles((current) =>
        current.map((article) =>
          article.id === serverArticle.id ? next : article,
        ),
      );
      if (stillSelected) {
        selectedRef.current = next;
        setSelected(next);
      }
    }

    if (
      historyRead.status === "fulfilled" &&
      historyRead.value.status === 200 &&
      historyRead.value.data
    ) {
      historyReadCompleted = true;
      const history = historyRead.value.data as ArticlePublicationHistory;
      publicSlug =
        history.publications.find((publication) => publication.isCurrent)
          ?.slug ?? publicSlug;
      if (
        selectedRef.current?.id === snapshot.id &&
        historyGeneration === historyRequestGeneration.current
      ) {
        setPublicationHistory(history.publications);
        setHistoryHasUnpublishedChanges(
          localDraftChanged || history.hasUnpublishedChanges,
        );
        setHistoryState("ready");
      }
    } else if (
      selectedRef.current?.id === snapshot.id &&
      historyGeneration === historyRequestGeneration.current
    ) {
      setHistoryState("error");
    }

    let publicReadCompleted =
      publicSlug === null && refreshedCurrentPublicationId === null;
    if (publicSlug !== null) {
      try {
        const publicResponse = await globalThis.fetch(
          `/api/articles/${encodeURIComponent(publicSlug)}`,
          {
            cache: "no-store",
            headers: { accept: "application/json" },
          },
        );
        publicReadCompleted =
          refreshedCurrentPublicationId === null
            ? publicResponse.status === 404 || publicResponse.status === 410
            : publicResponse.status === 200;
      } catch {
        publicReadCompleted = false;
      }
    }

    if (selectedRef.current?.id === snapshot.id) {
      setPublicationReconciliationState(
        articleReadCompleted && historyReadCompleted && publicReadCompleted
          ? "reconciled"
          : "failed",
      );
      setPublishState(terminalState);
    }
  }

  async function performPublish(attempt: PublishAttempt) {
    const { snapshot } = attempt;
    publishPendingRef.current = true;
    setPublishState("publishing");
    setPublicationAction(null);
    setPublicationIssues([]);
    setPublicationReceipt(null);
    setPublicationReconciliationState("idle");
    try {
      const response = await getApiClient()
        .admin.articles({ articleId: snapshot.id })
        .publications.post({
          draftVersion: snapshot.draft.version,
          expectedCurrentPublicationId: snapshot.currentPublicationId,
        });
      if (response.status === 201) {
        const receipt = publicationReceiptConfirmationFromApi(
          response.data,
          snapshot.id,
        );
        if (receipt && receipt.draftVersion === snapshot.draft.version) {
          acceptPublicationReceipt(attempt, receipt);
        } else {
          await reconcilePublicationState(attempt, "state-unconfirmed");
        }
        return;
      }
      if (!response.response) {
        await reconcilePublicationState(attempt, "transport-error");
        return;
      }

      const error: unknown = response.error?.value;
      const errorCode = publicationErrorCode(error);
      if (selectedRef.current?.id !== snapshot.id) return;
      if (errorCode === "PUBLICATION_CONFLICT") {
        await reconcilePublicationState(attempt, "conflict");
      } else if (errorCode === "PUBLICATION_INVALID") {
        retryablePublishAttemptRef.current = null;
        setPublicationIssues(publicationErrorIssues(error));
        setPublishState("invalid");
      } else if (errorCode === "PUBLICATION_NOT_COMPLETED") {
        retryablePublishAttemptRef.current = attempt;
        setPublishState("not-completed");
      } else if (errorCode === "PUBLICATION_STATE_UNCONFIRMED") {
        await reconcilePublicationState(attempt, "state-unconfirmed");
      } else {
        retryablePublishAttemptRef.current = null;
        setPublishState("error");
      }
    } catch {
      await reconcilePublicationState(attempt, "transport-error");
    } finally {
      publishPendingRef.current = false;
    }
  }

  async function publishDraft() {
    const snapshot = selectedRef.current;
    const publishable =
      snapshot !== null &&
      isOnline &&
      revisionRef.current === confirmedRevisionRef.current &&
      ["ready", "saved"].includes(state);
    if (
      !snapshot ||
      !publishable ||
      publishActionDisabled ||
      publishPendingRef.current
    ) {
      return;
    }
    await performPublish({
      snapshot,
      capturedRevision: revisionRef.current,
    });
  }

  async function retryPublishDraft() {
    const attempt = retryablePublishAttemptRef.current;
    if (
      publishState !== "not-completed" ||
      !attempt ||
      selectedRef.current?.id !== attempt.snapshot.id ||
      !isOnline ||
      publishPendingRef.current
    ) {
      return;
    }
    await performPublish(attempt);
  }

  function acknowledgePublicationReconciliation() {
    if (
      publishState !== "conflict" &&
      publishState !== "state-unconfirmed" &&
      publishState !== "transport-error"
    ) {
      return;
    }
    setPublishState("ready");
    setPublicationReconciliationState("idle");
  }

  async function unpublishCurrentPublication() {
    const snapshot = selectedRef.current;
    if (!snapshot?.currentPublicationId || unpublishActionDisabled) {
      return;
    }

    setUnpublishState("unpublishing");
    try {
      const response = await getApiClient()
        .admin.articles({ articleId: snapshot.id })
        ["current-publication"].delete();
      if (response.status === 200 && response.data) {
        resetPublicationHistory();
        setArticles((current) =>
          current.map((article) =>
            article.id === snapshot.id
              ? { ...article, currentPublicationId: null }
              : article,
          ),
        );
        const local = selectedRef.current;
        if (local?.id === snapshot.id) {
          const unpublished = { ...local, currentPublicationId: null };
          selectedRef.current = unpublished;
          setSelected(unpublished);
          setPublishState("ready");
          setPublicationAction(null);
          setPublicationReceipt(null);
          setPublicationReconciliationState("idle");
          setUnpublishState("unpublished");
        }
        return;
      }

      if (selectedRef.current?.id === snapshot.id) setUnpublishState("error");
    } catch {
      if (selectedRef.current?.id === snapshot.id) setUnpublishState("error");
    }
  }

  async function loadPublicationHistory() {
    const snapshot = selectedRef.current;
    if (!snapshot || !serverConfirmed || lifecycleActionPending) return;
    const requestGeneration = ++historyRequestGeneration.current;
    setHistoryState("loading");
    setRestoreState("ready");
    setRestoreIssues([]);
    try {
      const response = await getApiClient()
        .admin.articles({ articleId: snapshot.id })
        .publications.get();
      if (
        selectedRef.current?.id !== snapshot.id ||
        requestGeneration !== historyRequestGeneration.current
      ) {
        return;
      }
      if (response.status !== 200 || !response.data) {
        setHistoryState("error");
        return;
      }
      const history = response.data as ArticlePublicationHistory;
      setPublicationHistory(history.publications);
      setHistoryHasUnpublishedChanges(
        (locallyKnown) => locallyKnown || history.hasUnpublishedChanges,
      );
      setHistoryState("ready");
    } catch {
      if (
        selectedRef.current?.id === snapshot.id &&
        requestGeneration === historyRequestGeneration.current
      ) {
        setHistoryState("error");
      }
    }
  }

  async function restoreFromHistory(
    publication: ArticlePublicationHistoryEntry,
  ) {
    const snapshot = selectedRef.current;
    if (
      !snapshot ||
      publication.isCurrent ||
      !serverConfirmed ||
      lifecycleActionPending ||
      restorePendingRef.current
    )
      return;
    restorePendingRef.current = true;
    setRestoreState("restoring");
    setRestoreIssues([]);

    try {
      const response = await getApiClient()
        .admin.articles({ articleId: snapshot.id })
        .publications({ publicationId: publication.id })
        .restore.post({
          draftVersion: snapshot.draft.version,
          confirmDiscardUnpublishedChanges: true,
        });
      if (selectedRef.current?.id !== snapshot.id) return;
      if (response.status === 200 && response.data) {
        const serverArticle = response.data as Article;
        selectServerDraft(serverArticle, { preservePublicationHistory: true });
        setState("saved");
        setArticles((current) =>
          current.map((article) =>
            article.id === serverArticle.id ? serverArticle : article,
          ),
        );
        setHistoryHasUnpublishedChanges(true);
        setPublishState("ready");
        setPublicationAction(null);
        setUnpublishState("ready");
        setRestoreState("restored");
        return;
      }

      const error: unknown = response.error?.value;
      if (
        response.status === 400 &&
        typeof error === "object" &&
        error !== null &&
        "issues" in error &&
        Array.isArray(error.issues)
      ) {
        setRestoreIssues(error.issues.filter(isPublicationRestorationIssue));
        setRestoreState("invalid");
      } else if (response.status === 409) {
        setRestoreState("conflict");
      } else {
        setRestoreState("error");
      }
    } catch {
      if (selectedRef.current?.id === snapshot.id) setRestoreState("error");
    } finally {
      restorePendingRef.current = false;
    }
  }

  function clearSelectedArticle() {
    draftLoadGeneration.current += 1;
    selectedRef.current = null;
    revisionRef.current = 0;
    confirmedRevisionRef.current = 0;
    setSelected(null);
    setRevision(0);
    setConfirmedRevision(0);
    setConflictCopy(null);
    setIssues([]);
    setState("ready");
    setPublishState("ready");
    setPublicationAction(null);
    retryablePublishAttemptRef.current = null;
    setPublicationIssues([]);
    setPublicationReceipt(null);
    setPublicationReconciliationState("idle");
    setUnpublishState("ready");
    resetPublicationHistory();
    resetPreview();
  }

  async function reloadTrashView() {
    setTrashViewState("loading");
    try {
      setTrashedArticles(await loadTrashedArticles());
      setTrashViewState("ready");
    } catch {
      setTrashViewState("error");
    }
  }

  async function moveSelectedArticleToTrash() {
    const snapshot = selectedRef.current;
    if (!snapshot || trashActionDisabled || trashLifecyclePendingRef.current)
      return;
    trashLifecyclePendingRef.current = true;
    setTrashActionState("trashing");
    try {
      const response = await getApiClient()
        .admin.articles({ articleId: snapshot.id })
        .trash.post();
      if (response.status !== 200 || !response.data) {
        setTrashActionState("trash-error");
        return;
      }

      setArticles((current) =>
        current.filter((article) => article.id !== snapshot.id),
      );
      if (selectedRef.current?.id === snapshot.id) clearSelectedArticle();
      setTrashActionState("trashed");
      await reloadTrashView();
    } catch {
      setTrashActionState("trash-error");
    } finally {
      trashLifecyclePendingRef.current = false;
    }
  }

  async function restoreArticleFromTrash(article: ArticleTrashEntry) {
    if (
      articleSelectionDisabled ||
      revisionRef.current !== confirmedRevisionRef.current ||
      trashLifecyclePendingRef.current
    )
      return;
    trashLifecyclePendingRef.current = true;
    setTrashActionState("restoring");
    let restoreConfirmed = false;
    try {
      const response = await getApiClient()
        .admin.trash.articles({ articleId: article.id })
        .restore.post();
      if (response.status !== 200 || !response.data) {
        setTrashActionState("restore-error");
        return;
      }
      restoreConfirmed = true;

      setTrashedArticles((current) =>
        current.filter((candidate) => candidate.id !== article.id),
      );
      setTrashActionState("restored");

      const restored = await getApiClient()
        .admin.articles({ articleId: article.id })
        .get();
      if (restored.status === 200 && restored.data) {
        const serverArticle = restored.data as Article;
        setArticles((current) => [
          serverArticle,
          ...current.filter((candidate) => candidate.id !== serverArticle.id),
        ]);
        selectServerDraft(serverArticle);
        setState("saved");
        setPublishState("ready");
        setPublicationAction(null);
        setUnpublishState("ready");
        setTrashActionState("restored");
      }
    } catch {
      setTrashActionState(restoreConfirmed ? "restored" : "restore-error");
    } finally {
      trashLifecyclePendingRef.current = false;
    }
  }

  async function purgeArticleFromTrash(
    article: ArticleTrashEntry,
    confirmationTitle: string,
  ) {
    if (articleSelectionDisabled || trashLifecyclePendingRef.current) return;
    trashLifecyclePendingRef.current = true;
    setTrashActionState("purging");
    try {
      const response = await getApiClient()
        .admin.trash.articles({ articleId: article.id })
        .delete({ confirmationTitle });
      if (response.status !== 200 || !response.data) {
        setTrashActionState("purge-error");
        return;
      }
      setTrashedArticles((current) =>
        current.filter((candidate) => candidate.id !== article.id),
      );
      setTrashActionState("purged");
    } catch {
      setTrashActionState("purge-error");
    } finally {
      trashLifecyclePendingRef.current = false;
    }
  }

  return {
    // data
    articles,
    trashedArticles,
    selected,
    preview,
    previewIssues,
    publicationHistory,
    publicationIssues,
    publicationReceipt,
    restoreIssues,
    issues,
    conflictCopy,
    editorGeneration,
    // state
    state,
    listError,
    createError,
    listActionPendingId,
    trashViewState,
    trashActionState,
    previewState,
    publishState,
    publicationReconciliationState,
    publicationAction,
    unpublishState,
    historyState,
    historyHasUnpublishedChanges,
    restoreState,
    isOnline,
    // derived
    hasUnsavedChanges,
    serverConfirmed,
    lifecycleActionPending,
    publishActionDisabled,
    unpublishActionDisabled,
    trashActionDisabled,
    articleSelectionDisabled,
    editorLocked,
    blocker,
    // actions
    createDraft,
    loadDraft,
    updateDraft,
    reloadDraft,
    retryConflict,
    persistCurrentDraft,
    previewSavedDraft,
    publishDraft,
    retryPublishDraft,
    acknowledgePublicationReconciliation,
    unpublishCurrentPublication,
    loadPublicationHistory,
    restoreFromHistory,
    clearSelectedArticle,
    reloadArticles,
    reloadTrashView,
    publishListedArticle,
    unpublishListedArticle,
    moveListedArticleToTrash,
    moveSelectedArticleToTrash,
    restoreArticleFromTrash,
    purgeArticleFromTrash,
  };
}

export type ArticleWorkspace = ReturnType<typeof useArticleWorkspace>;
