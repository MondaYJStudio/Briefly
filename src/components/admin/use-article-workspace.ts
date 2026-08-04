import { useBlocker } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  ARTICLE_DRAFT_AUTOSAVE_DEBOUNCE_MS,
  isPublicationIssue,
  type Article,
  type ArticleDraftUpdate,
  type ArticlePublicationHistory,
  type ArticlePublicationHistoryEntry,
  type ArticleTrashEntry,
  type PublicationIssue,
  type RenderedArticleDraft,
} from "../../articles/articles";
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
  | "summary"
  | "tags"
  | "byline"
  | "language"
  | "cover"
  | "document"
>;

function editableArticleDraft(draft: Article["draft"]): EditableArticleDraft {
  const { title, slug, summary, tags, byline, language, cover, document } =
    draft;
  return { title, slug, summary, tags, byline, language, cover, document };
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
  const [preview, setPreview] = useState<RenderedArticleDraft | null>(null);
  const [previewIssues, setPreviewIssues] = useState<PublicationIssue[]>([]);
  const [previewState, setPreviewState] = useState<
    "idle" | "loading" | "ready" | "invalid" | "conflict" | "error"
  >("idle");
  const previewRequestGeneration = useRef(0);
  const [publishState, setPublishState] = useState<
    "ready" | "publishing" | "published" | "invalid" | "conflict" | "error"
  >("ready");
  const [publicationIssues, setPublicationIssues] = useState<string[]>([]);
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
  const [restoreIssues, setRestoreIssues] = useState<PublicationIssue[]>([]);

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
    if (!options.preserveUnpublishFeedback) {
      setUnpublishState((current) =>
        current === "unpublishing" ? current : "ready",
      );
    }
    if (!options.preservePublicationHistory) resetPublicationHistory();
    resetPreview();
  }

  useEffect(() => {
    let active = true;
    void getApiClient()
      .admin.articles.get()
      .then((response) => {
        if (response.status !== 200 || !response.data)
          throw new Error("Articles unavailable");
        if (active) {
          setArticles((current) => [
            ...current,
            ...response.data.articles.filter(
              (serverArticle) =>
                !current.some(
                  (localArticle) => localArticle.id === serverArticle.id,
                ),
            ),
          ]);
          setState((current) =>
            current === "loading" && selectedRef.current === null
              ? "ready"
              : current,
          );
        }
      })
      .catch(() => {
        if (active) {
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
    setState("creating");
    setIssues([]);
    try {
      const response = await getApiClient().admin.articles.post();
      if (response.status !== 201 || !response.data)
        throw new Error("Article creation failed");
      setArticles((current) => [
        response.data,
        ...current.filter((article) => article.id !== response.data.id),
      ]);
      selectServerDraft(response.data);
      setConflictCopy(null);
      setState("ready");
      setPublishState("ready");
      setPublicationAction(null);
      setTrashActionState("ready");
      return response.data;
    } catch {
      setState("failed");
      return null;
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
        setPublishState((current) =>
          current === "publishing" ? current : "ready",
        );
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
    const next = { ...current, draft: { ...current.draft, ...changes } };
    const nextRevision = revisionRef.current + 1;
    selectedRef.current = next;
    revisionRef.current = nextRevision;
    setSelected(next);
    setRevision(nextRevision);
    setIssues([]);
    setState("dirty");
    if (!publishPendingRef.current) {
      setPublishState("ready");
      setPublicationAction(null);
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
        .preview.post({ version });
      if (previewGeneration !== previewRequestGeneration.current) return;
      if (response.status === 200 && response.data) {
        setPreview(response.data as RenderedArticleDraft);
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

  async function publishDraft() {
    const snapshot = selectedRef.current;
    const capturedRevision = revisionRef.current;
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

    const isRepublish = snapshot.currentPublicationId !== null;
    publishPendingRef.current = true;
    setPublishState("publishing");
    setPublicationAction(null);
    setPublicationIssues([]);
    try {
      const response = await getApiClient()
        .admin.articles({ articleId: snapshot.id })
        .publications.post({ draftVersion: snapshot.draft.version });
      if (response.status === 201 && response.data) {
        let hasConcurrentDraft = revisionRef.current !== capturedRevision;
        if (selectedRef.current?.id === snapshot.id) {
          setPublicationAction(isRepublish ? "republished" : "published");
          setUnpublishState("ready");
          setTrashActionState("ready");
          resetPublicationHistory();
          if (hasConcurrentDraft) setHistoryHasUnpublishedChanges(true);
        }
        try {
          const refreshed = await getApiClient()
            .admin.articles({ articleId: snapshot.id })
            .get();
          if (refreshed.status === 200 && refreshed.data) {
            const local = selectedRef.current;
            const stillSelected = local?.id === refreshed.data.id;
            const localChanged =
              stillSelected && revisionRef.current !== capturedRevision;
            hasConcurrentDraft ||= localChanged;
            const lifecycleMerged = mergeConcurrentCurrentPublication(
              refreshed.data,
              snapshot,
              local,
            );
            const next =
              localChanged && local
                ? preserveLocalDraft(lifecycleMerged.article, local)
                : lifecycleMerged.article;
            if (stillSelected) {
              if (localChanged) {
                selectedRef.current = next;
                setSelected(next);
                setHistoryHasUnpublishedChanges(true);
              } else {
                selectServerDraft(next, {
                  preserveUnpublishFeedback:
                    lifecycleMerged.currentPublicationChanged,
                });
              }
            }
            setArticles((current) =>
              replaceArticlePreservingConcurrentCurrentPublication(
                current,
                next,
                snapshot,
              ),
            );
          }
        } catch {
          hasConcurrentDraft ||= revisionRef.current !== capturedRevision;
          if (hasConcurrentDraft && selectedRef.current?.id === snapshot.id) {
            setHistoryHasUnpublishedChanges(true);
          }
          // The publish response confirms the new Current Publication through
          // the public-read path. A private administration refresh must not
          // turn that success into an error.
        }
        if (selectedRef.current?.id === snapshot.id) {
          setPublishState(hasConcurrentDraft ? "ready" : "published");
        }
        return;
      }

      const error = response.error?.value;
      if (selectedRef.current?.id !== snapshot.id) return;
      if (response.status === 409) {
        setPublishState("conflict");
      } else if (error && "issues" in error) {
        setPublicationIssues(error.issues.map((issue) => issue.message));
        setPublishState("invalid");
      } else {
        setPublishState("error");
      }
    } catch {
      if (selectedRef.current?.id === snapshot.id) setPublishState("error");
    } finally {
      publishPendingRef.current = false;
    }
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
        setRestoreIssues(error.issues.filter(isPublicationIssue));
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

  async function purgeArticleFromTrash(article: ArticleTrashEntry) {
    if (articleSelectionDisabled || trashLifecyclePendingRef.current) return;
    trashLifecyclePendingRef.current = true;
    setTrashActionState("purging");
    try {
      const response = await getApiClient()
        .admin.trash.articles({ articleId: article.id })
        .delete({ confirmationArticleId: article.id });
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
    restoreIssues,
    issues,
    conflictCopy,
    editorGeneration,
    // state
    state,
    trashViewState,
    trashActionState,
    previewState,
    publishState,
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
    unpublishCurrentPublication,
    loadPublicationHistory,
    restoreFromHistory,
    clearSelectedArticle,
    reloadTrashView,
    moveSelectedArticleToTrash,
    restoreArticleFromTrash,
    purgeArticleFromTrash,
  };
}

export type ArticleWorkspace = ReturnType<typeof useArticleWorkspace>;
