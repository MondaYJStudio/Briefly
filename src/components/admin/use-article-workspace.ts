import { useBlocker } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ARTICLE_DRAFT_AUTOSAVE_DEBOUNCE_MS,
  type Article,
  type ArticleDocument,
  type ArticleDraftField,
  type ArticleDraftUpdate,
  type ArticlePublicationHistoryEntry,
  type ArticleTrashEntry,
} from "../../articles/articles";
import type { PublicationRestorationIssue } from "../../articles/publication-restoration";
import {
  type PublicationIssue,
  type PublicationPreview,
} from "../../articles/publication-workflow";
import {
  articleLifecycleProjection,
  draftUpdate,
  editorLifecycleProjection,
  mergeConcurrentCurrentPublication,
  preserveLocalDraft,
  preserveNewestLocalDraft,
  reducePublicationState,
  reduceTrashActionState,
  reduceArticleWorkspace,
  replaceArticlePreservingConcurrentCurrentPublication,
  withLifecycleProjection,
  type ArticleWorkspacePublicationCommand,
  type ArticleWorkspaceTrashCommand,
  type PublicationReceiptConfirmation,
  type ArticleWorkspaceGateway,
  type PublishState,
  type TrashActionState,
  type WorkspaceState,
} from "../../articles/article-workspace";
import { createArticleWorkspaceGateway } from "./article-workspace-gateway";
import { localizeServerIssueMessage } from "./publication-issues";

interface PublishAttempt {
  snapshot: Article;
  capturedRevision: number;
}

/**
 * React binding for the Article workspace. Domain state transitions live in
 * the framework-free Article workspace module and persistence is supplied by
 * an injectable gateway.
 */
export function useArticleWorkspace(gateway?: ArticleWorkspaceGateway) {
  const workspaceGateway = useMemo(
    () => gateway ?? createArticleWorkspaceGateway(),
    [gateway],
  );
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
  const [historyChangedFields, setHistoryChangedFields] = useState<
    ArticleDraftField[]
  >([]);
  const [historyPublishedDocument, setHistoryPublishedDocument] =
    useState<ArticleDocument | null>(null);
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
    setHistoryChangedFields([]);
    setHistoryPublishedDocument(null);
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

  function transitionPublication(command: ArticleWorkspacePublicationCommand) {
    setPublishState((current) => reducePublicationState(current, command));
  }

  function transitionTrash(command: ArticleWorkspaceTrashCommand) {
    setTrashActionState((current) => reduceTrashActionState(current, command));
  }

  function selectServerDraft(
    article: Article,
    options: {
      preservePublicationHistory?: boolean;
      preserveUnpublishFeedback?: boolean;
    } = {},
  ) {
    draftLoadGeneration.current += 1;
    const editor = reduceArticleWorkspace(
      {
        selected: selectedRef.current,
        revision: revisionRef.current,
        confirmedRevision: confirmedRevisionRef.current,
        state: "ready",
      },
      { type: "select", article },
    );
    selectedRef.current = editor.selected;
    revisionRef.current = editor.revision;
    confirmedRevisionRef.current = editor.confirmedRevision;
    setSelected(editor.selected);
    setRevision(editor.revision);
    setConfirmedRevision(editor.confirmedRevision);
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
      const response = await workspaceGateway.listArticles();
      if (!response.ok) throw new Error("Articles unavailable");
      const listed = response.value;
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
    void workspaceGateway
      .listArticles()
      .then((response) => {
        if (!response.ok) throw new Error("Articles unavailable");
        if (active) {
          const listed = response.value;
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
    void workspaceGateway
      .listTrashedArticles()
      .then((response) => {
        if (!response.ok) throw new Error("Trash unavailable");
        if (active) {
          setTrashedArticles(response.value);
          setTrashViewState("ready");
        }
      })
      .catch(() => {
        if (active) setTrashViewState("error");
      });
    return () => {
      active = false;
    };
  }, [workspaceGateway]);

  async function createDraft(): Promise<Article | null> {
    if (lifecycleActionPending) return null;
    setCreateError(false);
    setState("creating");
    setIssues([]);
    try {
      const response = await workspaceGateway.createArticle();
      if (!response.ok) throw new Error("Article creation failed");
      const created = withLifecycleProjection(response.value, "draft");
      setArticles((current) => [
        created,
        ...current.filter((article) => article.id !== created.id),
      ]);
      selectServerDraft(created);
      setConflictCopy(null);
      setState("ready");
      transitionPublication({ type: "reset" });
      setPublicationAction(null);
      transitionTrash({ type: "reset" });
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
      const response = await workspaceGateway.publishDraft({
        articleId: article.id,
        draftVersion: article.draft.version,
        expectedCurrentPublicationId: article.currentPublicationId,
      });
      if (!response.ok) return false;
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
      const response = await workspaceGateway.unpublishArticle(article.id);
      if (!response.ok) return false;
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
      const response = await workspaceGateway.trashArticle(article.id);
      if (!response.ok) return false;
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
      const response = await workspaceGateway.readArticle(articleId);
      if (!response.ok) throw new Error("Article unavailable");
      if (loadGeneration !== draftLoadGeneration.current) return null;
      const merged = mergeConcurrentCurrentPublication(
        response.value,
        requestSnapshot,
        selectedRef.current,
      );
      selectServerDraft(merged.article, {
        preserveUnpublishFeedback: merged.currentPublicationChanged,
      });
      setState("ready");
      transitionPublication({ type: "reset" });
      setPublicationAction(null);
      transitionTrash({ type: "reset" });
      return merged.article;
    } catch {
      if (loadGeneration === draftLoadGeneration.current) {
        setState(selectedRef.current ? "saved" : "ready");
      }
      return null;
    }
  }

  const persistCurrentDraft = useCallback(
    async (version?: number) => {
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
        const response = await workspaceGateway.saveDraft(snapshot.id, input);
        if (
          saveGeneration !== draftLoadGeneration.current ||
          selectedRef.current?.id !== snapshot.id
        ) {
          return;
        }
        if (response.ok) {
          const editor = reduceArticleWorkspace(
            {
              selected: selectedRef.current,
              revision: revisionRef.current,
              confirmedRevision: confirmedRevisionRef.current,
              state: "saving",
            },
            {
              type: "save-succeeded",
              serverArticle: response.value,
              requestSnapshot: snapshot,
              capturedRevision,
            },
          );
          const next = editor.selected;
          if (!next) return;
          selectedRef.current = next;
          setSelected(next);
          setArticles((current) =>
            replaceArticlePreservingConcurrentCurrentPublication(
              current,
              next,
              snapshot,
            ),
          );
          transitionPublication({ type: "draft-changed" });
          confirmedRevisionRef.current = editor.confirmedRevision;
          setConfirmedRevision(editor.confirmedRevision);
          setConflictCopy(null);
          resetPreview();
          setRevision(editor.revision);
          setState(editor.state);
          return;
        }

        if (response.reason === "slug-conflict") {
          setConflictCopy(null);
          setState("slug-conflict");
        } else if (response.reason === "conflict") {
          const local = selectedRef.current;
          setConflictCopy(
            local?.id === snapshot.id
              ? draftUpdate(local.draft, input.version)
              : input,
          );
          setState("conflict");
        } else if (response.reason === "invalid") {
          setIssues(
            (response.issues ?? []).map((issue) =>
              typeof issue === "object" &&
              issue !== null &&
              "message" in issue &&
              typeof issue.message === "string"
                ? localizeServerIssueMessage(issue.message)
                : String(issue),
            ),
          );
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
    },
    [workspaceGateway],
  );

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
    const editor = reduceArticleWorkspace(
      {
        selected: current,
        revision: revisionRef.current,
        confirmedRevision: confirmedRevisionRef.current,
        state: "dirty",
      },
      { type: "change-draft", changes },
    );
    const next = editor.selected;
    if (!next) return;
    selectedRef.current = next;
    revisionRef.current = editor.revision;
    setSelected(next);
    setRevision(editor.revision);
    setIssues([]);
    setState(editor.state);
    if (!publishPendingRef.current) {
      transitionPublication({ type: "draft-changed" });
      setPublicationAction(null);
      setPublicationReceipt(null);
      setPublicationIssues([]);
    }
    if (current.currentPublicationId !== null || historyState === "ready") {
      setHistoryHasUnpublishedChanges(true);
    }
    setHistoryChangedFields([]);
    setRestoreState((current) => (current === "restoring" ? current : "ready"));
    setRestoreIssues([]);
  }

  async function reloadDraft() {
    if (lifecycleActionPending) return;
    const requestSnapshot = selectedRef.current;
    if (!requestSnapshot) return;
    setState("loading");
    try {
      const response = await workspaceGateway.readArticle(requestSnapshot.id);
      if (!response.ok) throw new Error("Article unavailable");
      const merged = mergeConcurrentCurrentPublication(
        response.value,
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
      transitionPublication({ type: "reset" });
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
      const response = await workspaceGateway.readArticle(local.id);
      if (!response.ok) throw new Error("Article unavailable");
      const current = selectedRef.current;
      const currentArticle =
        current?.id === response.value.id ? current : local;
      const lifecycleMerged = mergeConcurrentCurrentPublication(
        response.value,
        local,
        currentArticle,
      ).article;
      const retry = preserveLocalDraft(lifecycleMerged, currentArticle);
      selectedRef.current = retry;
      setSelected(retry);
      await persistCurrentDraft(response.value.draft.version);
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
  const nothingToRepublish =
    selected?.currentPublicationId != null &&
    historyState === "ready" &&
    !historyHasUnpublishedChanges &&
    !hasUnsavedChanges;
  const selectedChangesPending =
    hasUnsavedChanges || historyHasUnpublishedChanges;
  useEffect(() => {
    if (!selected) return;
    setArticles((current) => {
      let changed = false;
      const next = current.map((row) => {
        if (row.id !== selected.id) return row;
        const projection = editorLifecycleProjection(row, {
          currentPublicationId: selected.currentPublicationId,
          changesPending: selectedChangesPending,
          divergenceKnown: historyState === "ready",
        });
        if (
          "lifecycleProjection" in row &&
          articleLifecycleProjection(row) === projection
        ) {
          return row;
        }
        changed = true;
        return withLifecycleProjection(row, projection);
      });
      return changed ? next : current;
    });
  }, [articles, selected, selectedChangesPending, historyState]);
  const publishActionDisabled =
    !selected ||
    !serverConfirmed ||
    publishState !== "ready" ||
    lifecycleActionPending ||
    nothingToRepublish;
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
      const response = await workspaceGateway.previewDraft(articleId, version);
      if (previewGeneration !== previewRequestGeneration.current) return;
      if (response.ok) {
        setPreview(response.value);
        setPreviewState("ready");
        return;
      }

      if (response.reason === "conflict") {
        setPreviewState("conflict");
        return;
      }
      if (response.reason === "invalid") {
        setPreviewIssues([...(response.issues ?? [])]);
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
    transitionTrash({ type: "reset" });
    resetPublicationHistory();
    if (hasConcurrentDraft) setHistoryHasUnpublishedChanges(true);
    transitionPublication({
      type: "confirmed",
      concurrentDraft: hasConcurrentDraft,
    });
  }

  async function reconcilePublicationState(
    attempt: PublishAttempt,
    terminalState: "conflict" | "state-unconfirmed" | "transport-error",
  ) {
    const { snapshot, capturedRevision } = attempt;
    retryablePublishAttemptRef.current = null;
    setPublicationReceipt(null);
    if (selectedRef.current?.id === snapshot.id) {
      transitionPublication({ type: "reconciling" });
    }

    const historyGeneration = ++historyRequestGeneration.current;
    const [articleRead, historyRead] = await Promise.allSettled([
      workspaceGateway.readArticle(snapshot.id),
      workspaceGateway.readPublicationHistory(snapshot.id),
    ]);

    let articleReadCompleted = false;
    let historyReadCompleted = false;
    let publicSlug = snapshot.draft.slug;
    let refreshedCurrentPublicationId = snapshot.currentPublicationId;
    let localDraftChanged = revisionRef.current !== capturedRevision;

    if (articleRead.status === "fulfilled" && articleRead.value.ok) {
      articleReadCompleted = true;
      const serverArticle = articleRead.value.value;
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

    if (historyRead.status === "fulfilled" && historyRead.value.ok) {
      historyReadCompleted = true;
      const history = historyRead.value.value;
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
        setHistoryChangedFields(localDraftChanged ? [] : history.changedFields);
        setHistoryPublishedDocument(history.publishedDocument);
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
      const publicResponse =
        await workspaceGateway.readPublicArticle(publicSlug);
      if (publicResponse.ok) {
        publicReadCompleted =
          refreshedCurrentPublicationId === null
            ? publicResponse.value.availability === "absent"
            : publicResponse.value.availability === "present";
      }
    }

    if (selectedRef.current?.id === snapshot.id) {
      setPublicationReconciliationState(
        articleReadCompleted && historyReadCompleted && publicReadCompleted
          ? "reconciled"
          : "failed",
      );
      transitionPublication({ type: "reconciled", state: terminalState });
    }
  }

  async function performPublish(attempt: PublishAttempt) {
    const { snapshot } = attempt;
    publishPendingRef.current = true;
    transitionPublication({ type: "begin" });
    setPublicationAction(null);
    setPublicationIssues([]);
    setPublicationReceipt(null);
    setPublicationReconciliationState("idle");
    try {
      const response = await workspaceGateway.publishDraft({
        articleId: snapshot.id,
        draftVersion: snapshot.draft.version,
        expectedCurrentPublicationId: snapshot.currentPublicationId,
      });
      if (response.ok) {
        acceptPublicationReceipt(attempt, response.value);
        return;
      }
      if (response.reason === "transport-error") {
        await reconcilePublicationState(attempt, "transport-error");
        return;
      }

      if (selectedRef.current?.id !== snapshot.id) return;
      if (response.reason === "conflict") {
        await reconcilePublicationState(attempt, "conflict");
      } else if (response.reason === "invalid") {
        retryablePublishAttemptRef.current = null;
        setPublicationIssues([...(response.issues ?? [])]);
        transitionPublication({ type: "invalid" });
      } else if (response.reason === "not-completed") {
        retryablePublishAttemptRef.current = attempt;
        transitionPublication({ type: "not-completed" });
      } else if (response.reason === "state-unconfirmed") {
        await reconcilePublicationState(attempt, "state-unconfirmed");
      } else {
        retryablePublishAttemptRef.current = null;
        transitionPublication({ type: "error" });
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
    transitionPublication({ type: "acknowledge" });
    setPublicationReconciliationState("idle");
  }

  async function unpublishCurrentPublication() {
    const snapshot = selectedRef.current;
    if (!snapshot?.currentPublicationId || unpublishActionDisabled) {
      return;
    }

    setUnpublishState("unpublishing");
    try {
      const response = await workspaceGateway.unpublishArticle(snapshot.id);
      if (response.ok) {
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
          transitionPublication({ type: "unpublished" });
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
      const response = await workspaceGateway.readPublicationHistory(
        snapshot.id,
      );
      if (
        selectedRef.current?.id !== snapshot.id ||
        requestGeneration !== historyRequestGeneration.current
      ) {
        return;
      }
      if (!response.ok) {
        setHistoryState("error");
        return;
      }
      const history = response.value;
      setPublicationHistory(history.publications);
      setHistoryHasUnpublishedChanges(
        (locallyKnown) => locallyKnown || history.hasUnpublishedChanges,
      );
      setHistoryChangedFields(history.changedFields);
      setHistoryPublishedDocument(history.publishedDocument);
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
      (publication.isCurrent && !historyHasUnpublishedChanges) ||
      !serverConfirmed ||
      lifecycleActionPending ||
      restorePendingRef.current
    )
      return;
    restorePendingRef.current = true;
    setRestoreState("restoring");
    setRestoreIssues([]);

    try {
      const response = await workspaceGateway.restorePublication({
        articleId: snapshot.id,
        publicationId: publication.id,
        draftVersion: snapshot.draft.version,
      });
      if (selectedRef.current?.id !== snapshot.id) return;
      if (response.ok) {
        const serverArticle = response.value;
        selectServerDraft(serverArticle, { preservePublicationHistory: true });
        setState("saved");
        setArticles((current) =>
          current.map((article) =>
            article.id === serverArticle.id ? serverArticle : article,
          ),
        );
        setHistoryHasUnpublishedChanges(!publication.isCurrent);
        setHistoryChangedFields([]);
        transitionPublication({ type: "reset" });
        setPublicationAction(null);
        setUnpublishState("ready");
        setRestoreState("restored");
        return;
      }

      if (response.reason === "invalid") {
        setRestoreIssues([...(response.issues ?? [])]);
        setRestoreState("invalid");
      } else if (response.reason === "conflict") {
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
    const editor = reduceArticleWorkspace(
      {
        selected: selectedRef.current,
        revision: revisionRef.current,
        confirmedRevision: confirmedRevisionRef.current,
        state,
      },
      { type: "clear" },
    );
    selectedRef.current = editor.selected;
    revisionRef.current = editor.revision;
    confirmedRevisionRef.current = editor.confirmedRevision;
    setSelected(editor.selected);
    setRevision(editor.revision);
    setConfirmedRevision(editor.confirmedRevision);
    setConflictCopy(null);
    setIssues([]);
    setState(editor.state);
    transitionPublication({ type: "reset" });
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
      const response = await workspaceGateway.listTrashedArticles();
      if (!response.ok) throw new Error("Trash unavailable");
      setTrashedArticles(response.value);
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
    transitionTrash({ type: "begin", action: "trash" });
    try {
      const response = await workspaceGateway.trashArticle(snapshot.id);
      if (!response.ok) {
        transitionTrash({ type: "failed", action: "trash" });
        return;
      }

      setArticles((current) =>
        current.filter((article) => article.id !== snapshot.id),
      );
      if (selectedRef.current?.id === snapshot.id) clearSelectedArticle();
      transitionTrash({ type: "succeeded", action: "trash" });
      await reloadTrashView();
    } catch {
      transitionTrash({ type: "failed", action: "trash" });
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
    transitionTrash({ type: "begin", action: "restore" });
    let restoreConfirmed = false;
    try {
      const response = await workspaceGateway.restoreTrashedArticle(article.id);
      if (!response.ok) {
        transitionTrash({ type: "failed", action: "restore" });
        return;
      }
      restoreConfirmed = true;

      setTrashedArticles((current) =>
        current.filter((candidate) => candidate.id !== article.id),
      );
      transitionTrash({ type: "succeeded", action: "restore" });

      const restored = await workspaceGateway.readArticle(article.id);
      if (restored.ok) {
        const serverArticle = restored.value;
        setArticles((current) => [
          serverArticle,
          ...current.filter((candidate) => candidate.id !== serverArticle.id),
        ]);
        selectServerDraft(serverArticle);
        setState("saved");
        transitionPublication({ type: "reset" });
        setPublicationAction(null);
        setUnpublishState("ready");
        transitionTrash({ type: "succeeded", action: "restore" });
      }
    } catch {
      transitionTrash(
        restoreConfirmed
          ? { type: "succeeded", action: "restore" }
          : { type: "failed", action: "restore" },
      );
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
    transitionTrash({ type: "begin", action: "purge" });
    try {
      const response = await workspaceGateway.purgeTrashedArticle(
        article.id,
        confirmationTitle,
      );
      if (!response.ok) {
        transitionTrash({ type: "failed", action: "purge" });
        return;
      }
      setTrashedArticles((current) =>
        current.filter((candidate) => candidate.id !== article.id),
      );
      transitionTrash({ type: "succeeded", action: "purge" });
    } catch {
      transitionTrash({ type: "failed", action: "purge" });
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
    historyChangedFields,
    historyPublishedDocument,
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

type ArticleWorkspaceBinding = ReturnType<typeof useArticleWorkspace>;

export type ArticleListWorkspace = Pick<
  ArticleWorkspaceBinding,
  | "articles"
  | "state"
  | "selected"
  | "articleSelectionDisabled"
  | "listError"
  | "createError"
  | "listActionPendingId"
  | "createDraft"
  | "reloadArticles"
  | "publishListedArticle"
  | "unpublishListedArticle"
  | "moveListedArticleToTrash"
  | "loadDraft"
  | "previewSavedDraft"
>;

export type ArticleWorkspaceAlerts = Pick<
  ArticleWorkspaceBinding,
  | "state"
  | "issues"
  | "conflictCopy"
  | "blocker"
  | "publishState"
  | "publicationAction"
  | "publicationIssues"
  | "publicationReceipt"
  | "publicationReconciliationState"
  | "unpublishState"
  | "trashActionState"
  | "lifecycleActionPending"
  | "persistCurrentDraft"
  | "reloadDraft"
  | "retryConflict"
  | "retryPublishDraft"
  | "acknowledgePublicationReconciliation"
  | "clearSelectedArticle"
>;

export type ArticleEditorWorkspace = ArticleWorkspaceAlerts &
  Pick<
    ArticleWorkspaceBinding,
    | "selected"
    | "editorLocked"
    | "editorGeneration"
    | "serverConfirmed"
    | "historyState"
    | "historyHasUnpublishedChanges"
    | "historyChangedFields"
    | "historyPublishedDocument"
    | "loadPublicationHistory"
    | "hasUnsavedChanges"
    | "updateDraft"
    | "preview"
    | "previewState"
    | "previewIssues"
    | "previewSavedDraft"
    | "publishActionDisabled"
    | "publishDraft"
    | "unpublishActionDisabled"
    | "unpublishCurrentPublication"
    | "trashActionDisabled"
    | "moveSelectedArticleToTrash"
    | "publicationHistory"
    | "restoreState"
    | "restoreIssues"
    | "restoreFromHistory"
  >;

export type ArticleTrashWorkspace = Pick<
  ArticleWorkspaceBinding,
  | "trashedArticles"
  | "trashViewState"
  | "trashActionState"
  | "articleSelectionDisabled"
  | "reloadTrashView"
  | "restoreArticleFromTrash"
  | "purgeArticleFromTrash"
>;

/** Route-level composition; each view consumes one narrower role interface. */
export type ArticleWorkspace = ArticleListWorkspace &
  ArticleEditorWorkspace &
  ArticleTrashWorkspace;
