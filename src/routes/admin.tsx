import {
  Alert,
  AlertDialog,
  Button,
  Form,
  Input,
  Label,
  Spinner,
  TextArea,
} from "@heroui/react";
import {
  ClientOnly,
  createFileRoute,
  useBlocker,
} from "@tanstack/react-router";
import {
  type FormEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

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
} from "../articles/articles";
import { AssetMediaLibrary } from "../assets/asset-media-library";
import {
  AuthenticationField,
  AuthenticationSurface,
} from "../auth/auth-surface";
import { getApiClient } from "./api.$";
import {
  BYLINE_NAME_MAXIMUM_LENGTH,
  BYLINE_URL_MAXIMUM_LENGTH,
  LANGUAGE_TAG_MAXIMUM_LENGTH,
  SITE_DESCRIPTION_MAXIMUM_LENGTH,
  SITE_NAME_MAXIMUM_LENGTH,
  type SiteSettings,
} from "../site-settings/site-settings";

export const Route = createFileRoute("/admin")({ component: Admin });

const ArticleEditor = lazy(async () => {
  const module = await import("./-article-editor");
  return { default: module.ArticleEditor };
});

function Admin() {
  const [signOutState, setSignOutState] = useState<
    "ready" | "submitting" | "error"
  >("ready");
  const [passwordState, setPasswordState] = useState<
    "ready" | "submitting" | "error"
  >("ready");
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [settingsState, setSettingsState] = useState<
    "loading" | "ready" | "submitting" | "saved" | "error"
  >("loading");
  const [settingsIssues, setSettingsIssues] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    void getApiClient()
      .admin["site-settings"].get()
      .then((response) => {
        if (response.status !== 200 || !response.data)
          throw new Error("Site Settings unavailable");
        const loaded: SiteSettings = response.data;
        if (active) {
          setSettings(loaded);
          setSettingsState("ready");
        }
      })
      .catch(() => {
        if (active) setSettingsState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  async function signOut() {
    setSignOutState("submitting");
    try {
      const response = await fetch("/api/auth/sign-out", { method: "POST" });
      if (response.ok) {
        globalThis.location.replace("/sign-in");
      } else {
        setSignOutState("error");
      }
    } catch {
      setSignOutState("error");
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordState("submitting");
    const formData = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword: formData.get("currentPassword"),
          newPassword: formData.get("newPassword"),
        }),
      });
      if (response.ok) {
        globalThis.location.replace("/sign-in");
      } else {
        setPasswordState("error");
      }
    } catch {
      setPasswordState("error");
    }
  }

  async function saveSiteSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    setSettingsState("submitting");
    setSettingsIssues([]);

    try {
      const response =
        await getApiClient().admin["site-settings"].put(settings);
      if (response.status !== 200 || !response.data) {
        const error = response.error?.value;
        setSettingsIssues(
          error && "issues" in error
            ? error.issues.map((issue) => issue.message)
            : [],
        );
        setSettingsState("error");
        return;
      }
      setSettings(response.data);
      setSettingsState("saved");
    } catch {
      setSettingsState("error");
    }
  }

  return (
    <AuthenticationSurface
      title="Administrator session"
      description="This route is guarded for navigation convenience. Every administration operation still checks the server-side session."
    >
      {signOutState === "error" ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>Unable to sign out</Alert.Title>
            <Alert.Description>Please try again.</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      <section className="space-y-5" aria-labelledby="site-settings-heading">
        <div className="space-y-1">
          <h2 id="site-settings-heading" className="text-xl font-semibold">
            Site identity and defaults
          </h2>
          <p className="text-sm text-default-500">
            These public values are independent of the Administrator account.
          </p>
        </div>
        {settingsState === "loading" ? (
          <div className="flex items-center gap-3" role="status">
            <Spinner aria-label="Loading Site Settings" />
            <span>Loading Site Settings…</span>
          </div>
        ) : settings ? (
          <Form className="space-y-4" onSubmit={saveSiteSettings}>
            {settingsState === "error" ? (
              <Alert status="danger" role="alert">
                <Alert.Content>
                  <Alert.Title>Unable to save Site Settings</Alert.Title>
                  <Alert.Description>
                    {settingsIssues.length > 0 ? (
                      <ul className="list-disc pl-5">
                        {settingsIssues.map((issue) => (
                          <li key={issue}>{issue}</li>
                        ))}
                      </ul>
                    ) : (
                      "Please check the values and try again."
                    )}
                  </Alert.Description>
                </Alert.Content>
              </Alert>
            ) : settingsState === "saved" ? (
              <Alert status="success" role="status">
                <Alert.Content>
                  <Alert.Title>Site Settings saved</Alert.Title>
                </Alert.Content>
              </Alert>
            ) : null}
            <SettingsField label="Site name" htmlFor="siteName">
              <Input
                fullWidth
                id="siteName"
                name="siteName"
                required
                maxLength={SITE_NAME_MAXIMUM_LENGTH}
                value={settings.siteName}
                onChange={(event) =>
                  setSettings({ ...settings, siteName: event.target.value })
                }
              />
            </SettingsField>
            <SettingsField
              label="Site description (optional)"
              htmlFor="siteDescription"
            >
              <TextArea
                fullWidth
                id="siteDescription"
                name="siteDescription"
                maxLength={SITE_DESCRIPTION_MAXIMUM_LENGTH}
                value={settings.siteDescription ?? ""}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    siteDescription: event.target.value || null,
                  })
                }
              />
            </SettingsField>
            <SettingsField
              label="Default Byline name"
              htmlFor="defaultBylineName"
            >
              <Input
                fullWidth
                id="defaultBylineName"
                name="defaultBylineName"
                required
                maxLength={BYLINE_NAME_MAXIMUM_LENGTH}
                value={settings.defaultByline.name}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    defaultByline: {
                      ...settings.defaultByline,
                      name: event.target.value,
                    },
                  })
                }
              />
            </SettingsField>
            <SettingsField
              label="Default Byline URL (optional)"
              htmlFor="defaultBylineUrl"
            >
              <Input
                fullWidth
                id="defaultBylineUrl"
                name="defaultBylineUrl"
                type="url"
                maxLength={BYLINE_URL_MAXIMUM_LENGTH}
                value={settings.defaultByline.url ?? ""}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    defaultByline: {
                      ...settings.defaultByline,
                      url: event.target.value || null,
                    },
                  })
                }
              />
            </SettingsField>
            <SettingsField
              label="Default language (BCP 47)"
              htmlFor="defaultLanguage"
            >
              <Input
                fullWidth
                id="defaultLanguage"
                name="defaultLanguage"
                required
                maxLength={LANGUAGE_TAG_MAXIMUM_LENGTH}
                value={settings.defaultLanguage}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    defaultLanguage: event.target.value,
                  })
                }
              />
            </SettingsField>
            <Button
              fullWidth
              type="submit"
              isPending={settingsState === "submitting"}
            >
              Save Site Settings
            </Button>
          </Form>
        ) : (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>Unable to load Site Settings</Alert.Title>
              <Alert.Description>
                Refresh the page to try again.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        )}
      </section>
      <AssetMediaLibrary />
      <ArticleDraftManager />
      <Form className="space-y-5" onSubmit={changePassword}>
        <h2 className="text-xl font-semibold">Change password</h2>
        {passwordState === "error" ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>Unable to change password</Alert.Title>
              <Alert.Description>
                Check the current password and new password, then try again.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
        <AuthenticationField
          id="currentPassword"
          label="Current password"
          type="password"
          autoComplete="current-password"
        />
        <AuthenticationField
          id="newPassword"
          label="New password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
        />
        <p className="text-sm text-default-500">
          Changing the password revokes every Administrator session, including
          this one, and requires a fresh sign-in.
        </p>
        <Button
          fullWidth
          type="submit"
          isPending={passwordState === "submitting"}
        >
          Change password and revoke sessions
        </Button>
      </Form>
      <Button
        fullWidth
        variant="secondary"
        isPending={signOutState === "submitting"}
        onPress={signOut}
      >
        Sign out
      </Button>
    </AuthenticationSurface>
  );
}

type ArticleDraftManagerState =
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

type ArticleTrashActionState =
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

function ArticleDraftManager() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [trashedArticles, setTrashedArticles] = useState<ArticleTrashEntry[]>(
    [],
  );
  const [trashViewState, setTrashViewState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [trashActionState, setTrashActionState] =
    useState<ArticleTrashActionState>("ready");
  const [selected, setSelected] = useState<Article | null>(null);
  const [state, setState] = useState<ArticleDraftManagerState>("loading");
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
  const restorePendingRef = useRef(false);
  const trashLifecyclePendingRef = useRef(false);
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
  const [restoreState, setRestoreState] = useState<
    "ready" | "restoring" | "restored" | "invalid" | "conflict" | "error"
  >("ready");
  const [restoreIssues, setRestoreIssues] = useState<PublicationIssue[]>([]);

  function resetPublicationHistory() {
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
          setArticles(response.data.articles);
          setState("ready");
        }
      })
      .catch(() => {
        if (active) setState("failed");
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

  async function createDraft() {
    if (lifecycleActionPending) return;
    setState("creating");
    setIssues([]);
    try {
      const response = await getApiClient().admin.articles.post();
      if (response.status !== 201 || !response.data)
        throw new Error("Article creation failed");
      setArticles((current) => [response.data, ...current]);
      selectServerDraft(response.data);
      setConflictCopy(null);
      setState("ready");
      setPublishState("ready");
      setPublicationAction(null);
      setTrashActionState("ready");
    } catch {
      setState("failed");
    }
  }

  async function loadDraft(articleId: string) {
    if (lifecycleActionPending) return;
    const requestSnapshot = selectedRef.current;
    setState("loading");
    setIssues([]);
    try {
      const response = await getApiClient().admin.articles({ articleId }).get();
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
      setState("ready");
      setPublishState("ready");
      setPublicationAction(null);
      setTrashActionState("ready");
    } catch {
      setState("failed");
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
    const input = draftUpdate(snapshot.draft, version);
    savingRef.current = true;
    setState("saving");
    setIssues([]);

    try {
      const response = await getApiClient()
        .admin.articles({ articleId: snapshot.id })
        .draft.put(input);
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
        setPublishState("ready");
        setPublicationAction(null);
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
    setPublishState("ready");
    setPublicationAction(null);
    if (historyState === "ready") setHistoryHasUnpublishedChanges(true);
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
    if (!selected || lifecycleActionPending) return;
    const previewGeneration = ++previewRequestGeneration.current;
    const articleId = selected.id;
    const version = selected.draft.version;
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
    if (!snapshot || !publishable || publishActionDisabled) {
      return;
    }

    const isRepublish = snapshot.currentPublicationId !== null;
    setPublishState("publishing");
    setPublicationIssues([]);
    try {
      const response = await getApiClient()
        .admin.articles({ articleId: snapshot.id })
        .publications.post({ draftVersion: snapshot.draft.version });
      if (response.status === 201 && response.data) {
        if (selectedRef.current?.id === snapshot.id) {
          setPublishState("published");
          setPublicationAction(isRepublish ? "republished" : "published");
          setUnpublishState("ready");
          setTrashActionState("ready");
          resetPublicationHistory();
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
          // The publish response confirms the new Current Publication through
          // the public-read path. A private administration refresh must not
          // turn that success into an error.
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
    setHistoryState("loading");
    setRestoreState("ready");
    setRestoreIssues([]);
    try {
      const response = await getApiClient()
        .admin.articles({ articleId: snapshot.id })
        .publications.get();
      if (selectedRef.current?.id !== snapshot.id) return;
      if (response.status !== 200 || !response.data) {
        setHistoryState("error");
        return;
      }
      const history = response.data as ArticlePublicationHistory;
      setPublicationHistory(history.publications);
      setHistoryHasUnpublishedChanges(history.hasUnpublishedChanges);
      setHistoryState("ready");
    } catch {
      if (selectedRef.current?.id === snapshot.id) setHistoryState("error");
    }
  }

  async function restoreFromHistory(
    publication: ArticlePublicationHistoryEntry,
  ) {
    const snapshot = selectedRef.current;
    if (
      !snapshot ||
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

  return (
    <section
      className="space-y-5"
      aria-labelledby="article-administration-heading"
      data-server-confirmed={serverConfirmed}
    >
      <div className="space-y-1">
        <h2
          id="article-administration-heading"
          className="text-xl font-semibold"
        >
          Articles and Trash
        </h2>
        <p className="text-sm text-default-500">
          Create incomplete Articles and autosave complete versioned Drafts. The
          text-rich editor loads after hydration while this shell remains
          server-rendered.
        </p>
        <p className="text-sm text-default-500">
          Move Article to Trash is reversible; Restore Article always returns it
          as unpublished, so you must explicitly publish it again. Permanent
          purge is separate and irreversible.
        </p>
        <p className="text-sm text-default-500">
          The Restore this Article from Trash? confirmation makes the result
          explicit: Article restored as unpublished means it remains private
          until another deliberate publish.
        </p>
        <p className="text-sm text-default-500">
          The Permanently purge this Article? confirmation identifies the
          Article ID, states that its Draft and Publication history cannot be
          restored, and is visually separate from reversible Trash.
        </p>
      </div>
      {trashActionState === "restored" ? (
        <Alert status="success" role="status">
          <Alert.Content>
            <Alert.Title>Article restored as unpublished</Alert.Title>
            <Alert.Description>
              Its Draft and Publication history are intact. It has no Current
              Publication and remains unavailable from public endpoints until
              you explicitly publish it again.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : trashActionState === "trash-error" ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>Unable to move Article to Trash</Alert.Title>
            <Alert.Description>
              Briefly did not confirm the transition. The prior Article and
              public visibility state remain authoritative; reload and try
              again.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      {blocker.status === "blocked" ? (
        <Alert status="warning" role="alert">
          <Alert.Content>
            <Alert.Title>Unsaved local changes</Alert.Title>
            <Alert.Description>
              Leaving now discards changes that the server has not confirmed.
              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onPress={blocker.reset}
                >
                  Stay here
                </Button>
                <Button type="button" onPress={blocker.proceed}>
                  Leave without saving
                </Button>
              </div>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      {state === "failed" ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>Draft save failed</Alert.Title>
            <Alert.Description>
              Your current-tab changes are still available but are not durable.
              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  onPress={() => void persistCurrentDraft()}
                >
                  Retry save
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  isDisabled={lifecycleActionPending}
                  onPress={reloadDraft}
                >
                  Reload server Draft
                </Button>
              </div>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : state === "conflict" ? (
        <Alert status="warning" role="alert">
          <Alert.Content>
            <Alert.Title>Draft conflict</Alert.Title>
            <Alert.Description>
              A newer Draft Version is already saved. No automatic rich-text
              merge or overwrite was attempted.
              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  isDisabled={lifecycleActionPending}
                  onPress={retryConflict}
                >
                  Deliberately retry local Draft
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  isDisabled={lifecycleActionPending}
                  onPress={reloadDraft}
                >
                  Reload server Draft
                </Button>
              </div>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : state === "slug-conflict" ? (
        <Alert status="warning" role="alert">
          <Alert.Content>
            <Alert.Title>Slug is already claimed</Alert.Title>
            <Alert.Description>
              Another Article owns this slug. Your local Draft remains visible;
              choose a different slug to resume autosave.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : state === "invalid" ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>Draft is invalid</Alert.Title>
            <Alert.Description>
              <ul className="list-disc pl-5">
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
              <Button
                className="mt-3"
                type="button"
                onPress={() => void persistCurrentDraft()}
              >
                Retry save
              </Button>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : state === "offline" ? (
        <Alert status="warning" role="alert">
          <Alert.Content>
            <Alert.Title>Offline — Draft not saved</Alert.Title>
            <Alert.Description>
              Changes remain only in this tab. Briefly does not promise offline
              durability or synchronization. Reconnect, then retry.
              <Button
                className="mt-3"
                type="button"
                onPress={() => void persistCurrentDraft()}
              >
                Retry save
              </Button>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : state === "saving" ? (
        <p className="text-sm text-default-600" role="status">
          Saving complete Draft…
        </p>
      ) : state === "dirty" ? (
        <p className="text-sm text-default-600" role="status">
          Unsaved changes — autosaving after 1 second of inactivity…
        </p>
      ) : state === "saved" ? (
        <Alert status="success" role="status">
          <Alert.Content>
            <Alert.Title>Complete Draft saved</Alert.Title>
          </Alert.Content>
        </Alert>
      ) : null}
      {conflictCopy ? (
        <details>
          <summary className="cursor-pointer font-medium">
            Copy the preserved local Draft JSON
          </summary>
          <TextArea
            className="mt-3 font-mono"
            aria-label="Preserved unsaved local Draft JSON"
            readOnly
            value={JSON.stringify(conflictCopy, null, 2)}
          />
        </details>
      ) : null}
      {publishState === "published" ? (
        <Alert status="success" role="status">
          <Alert.Content>
            <Alert.Title>
              {publicationAction === "republished"
                ? "Article republished"
                : "Article published"}
            </Alert.Title>
            <Alert.Description>
              {publicationAction === "republished"
                ? "The new immutable Publication is public now; earlier Publications remain unchanged."
                : "A new immutable Publication is public now."}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : publishState === "invalid" ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>Publication validation failed</Alert.Title>
            <Alert.Description>
              <ul className="list-disc pl-5">
                {publicationIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : publishState === "conflict" ? (
        <Alert status="warning" role="alert">
          <Alert.Content>
            <Alert.Title>Publication conflict</Alert.Title>
            <Alert.Description>
              Reload the latest server-confirmed Draft Version before
              publishing.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : publishState === "error" ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>Unable to publish Article</Alert.Title>
            <Alert.Description>Please try again.</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      {unpublishState === "unpublished" ? (
        <Alert status="success" role="status">
          <Alert.Content>
            <Alert.Title>Article unpublished</Alert.Title>
            <Alert.Description>
              This Article is private now: it has no Current Publication and is
              unavailable from public content endpoints. Its Draft and
              Publication history remain intact, and it can be published again.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : unpublishState === "error" ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>Unable to unpublish Article</Alert.Title>
            <Alert.Description>
              Briefly did not confirm withdrawal. The existing Current
              Publication remains public; reload and try again.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      <Button
        fullWidth
        type="button"
        isPending={state === "creating"}
        isDisabled={articleSelectionDisabled}
        onPress={createDraft}
      >
        Create Article Draft
      </Button>
      {state === "loading" && articles.length === 0 ? (
        <div className="flex items-center gap-3" role="status">
          <Spinner aria-label="Loading Article Drafts" />
          <span>Loading Article Drafts…</span>
        </div>
      ) : articles.length === 0 ? (
        <p className="text-sm text-default-500">No Article Drafts yet.</p>
      ) : (
        <ul className="space-y-2" aria-label="Article Drafts">
          {articles.map((article) => (
            <li key={article.id}>
              <Button
                fullWidth
                type="button"
                variant="secondary"
                isDisabled={articleSelectionDisabled}
                onPress={() => loadDraft(article.id)}
              >
                {article.draft.title || "Untitled Article"} · Version{" "}
                {article.draft.version}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <section
        className="space-y-1"
        aria-labelledby="asset-authoring-shell-heading"
      >
        <h3 id="asset-authoring-shell-heading" className="font-semibold">
          Figures and cover
        </h3>
        <p className="text-sm text-default-500">
          Select or upload verified Assets, then describe each Article usage.
          Decorative figures expose that state and save an empty alternative
          value.
        </p>
      </section>
      <section
        className="space-y-1"
        aria-labelledby="video-authoring-shell-heading"
      >
        <h3 id="video-authoring-shell-heading" className="font-semibold">
          YouTube and Bilibili video embeds
        </h3>
        <p className="text-sm text-default-500">
          Recognize a supported URL or identifier and provide an understandable
          iframe title. Unsupported providers can remain ordinary links.
        </p>
      </section>
      {selected ? (
        <Form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void persistCurrentDraft();
          }}
        >
          <fieldset
            aria-busy={editorLocked}
            className="min-w-0 space-y-4 border-0 p-0"
            disabled={editorLocked}
          >
            <p className="text-sm text-default-500">
              Draft Version {selected.draft.version}
            </p>
            <output className="text-sm" data-server-confirmed={serverConfirmed}>
              {serverConfirmed
                ? "Latest client state is server-confirmed."
                : "Latest client state is not server-confirmed."}
            </output>
            {restoreState === "restoring" ? (
              <p className="text-sm text-default-600" role="status">
                Restoring Publication… Draft editing is temporarily paused.
              </p>
            ) : trashActionState === "trashing" ? (
              <p className="text-sm text-default-600" role="status">
                Moving Article to Trash… Draft editing is temporarily paused.
              </p>
            ) : trashActionState === "restoring" ? (
              <p className="text-sm text-default-600" role="status">
                Restoring Article from Trash… Draft editing is temporarily
                paused.
              </p>
            ) : null}
            <SettingsField label="Title" htmlFor="articleTitle">
              <Input
                fullWidth
                id="articleTitle"
                value={selected.draft.title}
                onChange={(event) => updateDraft({ title: event.target.value })}
              />
            </SettingsField>
            <SettingsField
              label="Unicode slug (optional)"
              htmlFor="articleSlug"
            >
              <Input
                aria-describedby="articleSlugPolicy"
                fullWidth
                id="articleSlug"
                value={selected.draft.slug ?? ""}
                onChange={(event) =>
                  updateDraft({ slug: event.target.value || null })
                }
              />
              <p className="text-sm text-default-500" id="articleSlugPolicy">
                Saved as trimmed Unicode NFC with display casing preserved;
                global uniqueness is case-insensitive. Control and path-reserved
                characters, dot path segments, and malformed Unicode are
                rejected.
              </p>
            </SettingsField>
            <SettingsField
              label="Plain-text summary (optional)"
              htmlFor="articleSummary"
            >
              <TextArea
                fullWidth
                id="articleSummary"
                value={selected.draft.summary ?? ""}
                onChange={(event) =>
                  updateDraft({ summary: event.target.value || null })
                }
              />
            </SettingsField>
            <SettingsField
              label="Flat tags (comma separated)"
              htmlFor="articleTags"
            >
              <Input
                fullWidth
                id="articleTags"
                value={selected.draft.tags.join(", ")}
                onChange={(event) =>
                  updateDraft({
                    tags: event.target.value
                      .split(",")
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  })
                }
              />
            </SettingsField>
            <SettingsField
              label="Byline override name (optional)"
              htmlFor="articleBylineName"
            >
              <Input
                fullWidth
                id="articleBylineName"
                value={selected.draft.byline?.name ?? ""}
                onChange={(event) =>
                  updateDraft({
                    byline: event.target.value
                      ? {
                          name: event.target.value,
                          url: selected.draft.byline?.url ?? null,
                        }
                      : null,
                  })
                }
              />
            </SettingsField>
            <SettingsField
              label="Byline override URL (optional)"
              htmlFor="articleBylineUrl"
            >
              <Input
                fullWidth
                id="articleBylineUrl"
                type="url"
                disabled={!selected.draft.byline}
                value={selected.draft.byline?.url ?? ""}
                onChange={(event) =>
                  selected.draft.byline &&
                  updateDraft({
                    byline: {
                      ...selected.draft.byline,
                      url: event.target.value || null,
                    },
                  })
                }
              />
            </SettingsField>
            <SettingsField
              label="Language override (BCP 47, optional)"
              htmlFor="articleLanguage"
            >
              <Input
                fullWidth
                id="articleLanguage"
                value={selected.draft.language ?? ""}
                onChange={(event) =>
                  updateDraft({ language: event.target.value || null })
                }
              />
            </SettingsField>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold">Text-rich Draft editor</h3>
              <ClientOnly fallback={<ArticleEditorFallback />}>
                <Suspense fallback={<ArticleEditorFallback />}>
                  <ArticleEditor
                    key={`${selected.id}:${editorGeneration}`}
                    document={selected.draft.document}
                    cover={selected.draft.cover}
                    isDisabled={editorLocked}
                    onChange={(document) => updateDraft({ document })}
                    onCoverChange={(cover) => updateDraft({ cover })}
                  />
                </Suspense>
              </ClientOnly>
            </div>
            <Button fullWidth type="submit" isPending={state === "saving"}>
              Save complete Draft now
            </Button>
          </fieldset>
        </Form>
      ) : null}
      <section
        className="space-y-4 border-t border-default-200 pt-5"
        aria-labelledby="saved-draft-preview-heading"
      >
        <div className="space-y-1">
          <h3
            id="saved-draft-preview-heading"
            className="text-lg font-semibold"
          >
            Saved Draft Preview
          </h3>
          <p className="text-sm text-default-500">
            Preview uses publication validation and renders only content already
            confirmed by the server.
          </p>
        </div>
        {selected ? (
          <Button
            fullWidth
            type="button"
            variant="secondary"
            isDisabled={lifecycleActionPending}
            isPending={previewState === "loading"}
            onPress={previewSavedDraft}
          >
            Preview saved Draft Version {selected.draft.version}
          </Button>
        ) : (
          <p className="text-sm text-default-500">
            Select an Article to preview an exact server-confirmed Draft
            Version.
          </p>
        )}
        {previewState === "conflict" ? (
          <Alert status="warning" role="alert">
            <Alert.Content>
              <Alert.Title>Saved Draft Version changed</Alert.Title>
              <Alert.Description>
                Reload the Article before requesting another preview.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : previewState === "invalid" ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>Saved Draft cannot be previewed</Alert.Title>
              <Alert.Description>
                <ul className="list-disc pl-5">
                  {previewIssues.map((issue) => (
                    <li key={`${issue.code}:${issue.path}`}>
                      {issue.path}: {issue.message}
                    </li>
                  ))}
                </ul>
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : previewState === "error" ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>Unable to load saved Draft preview</Alert.Title>
              <Alert.Description>Please try again.</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
        {previewState === "ready" && preview ? (
          <div className="space-y-4">
            <p className="text-sm text-default-500" role="status">
              Showing saved Draft Version {preview.draftVersion} with Renderer
              Version {preview.rendererVersion}.
            </p>
            <article
              className="space-y-3 rounded-xl border border-default-200 p-4"
              lang={preview.metadata.language}
              aria-labelledby="saved-draft-preview-title"
            >
              <header className="space-y-1">
                <h4
                  id="saved-draft-preview-title"
                  className="text-xl font-semibold"
                >
                  {preview.metadata.title}
                </h4>
                <p className="text-sm text-default-500">
                  By {preview.metadata.byline.name} ·{" "}
                  {preview.metadata.language}
                </p>
              </header>
              {preview.coverHtml ? (
                <div dangerouslySetInnerHTML={{ __html: preview.coverHtml }} />
              ) : null}
              <div dangerouslySetInnerHTML={{ __html: preview.html }} />
            </article>
          </div>
        ) : null}
      </section>
      <section
        className="space-y-4 border-t border-default-200 pt-5"
        aria-labelledby="publication-history-heading"
      >
        <div className="space-y-1">
          <h3
            id="publication-history-heading"
            className="text-lg font-semibold"
          >
            Publication History
          </h3>
          <p className="text-sm text-default-500">
            Browse every retained immutable Publication. Restoring one
            permanently replaces the current Draft; when it contains unpublished
            Draft changes, a destructive warning requires you to choose Confirm
            and restore Publication explicitly. The public Current Publication
            stays unchanged, so you can preview the restored Draft before
            publishing.
          </p>
        </div>
        <Button
          fullWidth
          type="button"
          variant="secondary"
          isDisabled={!serverConfirmed || lifecycleActionPending}
          isPending={historyState === "loading"}
          onPress={loadPublicationHistory}
        >
          Load retained Publications
        </Button>
        {historyState === "error" ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>Unable to load Publication History</Alert.Title>
              <Alert.Description>Please reload the history.</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : historyState === "ready" && publicationHistory.length === 0 ? (
          <p className="text-sm text-default-500">
            This Article has no retained Publications yet.
          </p>
        ) : null}
        {restoreState === "restored" ? (
          <Alert status="success" role="status">
            <Alert.Content>
              <Alert.Title>Publication restored into the Draft</Alert.Title>
              <Alert.Description>
                Draft Version advanced. Preview it privately, then publish only
                when it is ready to replace the Current Publication.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : restoreState === "conflict" ? (
          <Alert status="warning" role="alert">
            <Alert.Content>
              <Alert.Title>Draft changed before restore</Alert.Title>
              <Alert.Description>
                Reload the latest server-confirmed Draft and Publication
                History; no historical source was changed.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : restoreState === "invalid" ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>Publication cannot be restored safely</Alert.Title>
              <Alert.Description>
                <ul className="list-disc pl-5">
                  {restoreIssues.map((issue) => (
                    <li key={issue.code + ":" + issue.path}>
                      {issue.path}: {issue.message}
                    </li>
                  ))}
                </ul>
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : restoreState === "error" ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>Unable to restore Publication</Alert.Title>
              <Alert.Description>
                The current Draft and public output were not confirmed as
                changed. Reload and try again.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
        {publicationHistory.length > 0 ? (
          <ol className="space-y-3" aria-label="Retained Publications">
            {publicationHistory.map((publication) => (
              <li
                key={publication.id}
                className="space-y-3 rounded-xl border border-default-200 p-4"
              >
                <div className="space-y-1">
                  <p className="font-medium">
                    Publication {publication.publicationNumber}
                    {publication.isCurrent ? " · Current" : ""}
                  </p>
                  <p>{publication.title}</p>
                  <p className="text-sm text-default-500">
                    /{publication.slug} · {publication.publishedAt}
                  </p>
                </div>
                <AlertDialog.Root>
                  <Button
                    fullWidth
                    type="button"
                    variant="danger-soft"
                    isDisabled={!serverConfirmed || lifecycleActionPending}
                    isPending={restoreState === "restoring"}
                  >
                    Restore Publication {publication.publicationNumber}
                  </Button>
                  <AlertDialog.Backdrop>
                    <AlertDialog.Container>
                      <AlertDialog.Dialog>
                        <AlertDialog.Header>
                          <AlertDialog.Heading>
                            Restore Publication {publication.publicationNumber}?
                          </AlertDialog.Heading>
                        </AlertDialog.Header>
                        <AlertDialog.Body>
                          <p>
                            {historyHasUnpublishedChanges
                              ? "This Article has unpublished Draft changes. Restoring this immutable source permanently replaces them with a new Draft Version."
                              : "Restoring this immutable source replaces the current Draft with a new Draft Version."}{" "}
                            The selected Publication, Current Publication,
                            public timestamps, and anonymous output remain
                            unchanged.
                          </p>
                        </AlertDialog.Body>
                        <AlertDialog.Footer>
                          <Button
                            type="button"
                            variant="secondary"
                            slot="close"
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            variant="danger-soft"
                            slot="close"
                            isDisabled={
                              !serverConfirmed || lifecycleActionPending
                            }
                            onPress={() => void restoreFromHistory(publication)}
                          >
                            Confirm and restore Publication
                          </Button>
                        </AlertDialog.Footer>
                      </AlertDialog.Dialog>
                    </AlertDialog.Container>
                  </AlertDialog.Backdrop>
                </AlertDialog.Root>
              </li>
            ))}
          </ol>
        ) : null}
      </section>
      <p className="text-sm text-default-500">
        Publishing is available only for a server-confirmed Draft Version and
        requires deliberate confirmation while online. Choose Publish saved
        Draft while the Article has no Current Publication; choose Republish
        saved Draft while it is public. Republishing creates a new immutable
        Publication while preserving earlier history and switches the Current
        Publication only after the new public read is available.
      </p>
      <p className="text-sm text-default-500">
        Published media URLs remain public permanently, including after the
        Article is unpublished.
      </p>
      <p className="text-sm text-default-500">
        Unpublish is reversible and does not depend on the Draft save state. It
        removes the Current Publication from public list and detail endpoints;
        Draft and Publication history remain intact. This is not Trash or
        permanent purge, and previously published media remains public. The
        action requires deliberate confirmation.
      </p>
      <AlertDialog.Root>
        <Button
          fullWidth
          type="button"
          isDisabled={publishActionDisabled}
          isPending={publishState === "publishing"}
        >
          {selected?.currentPublicationId
            ? "Republish saved Draft"
            : "Publish saved Draft"}
        </Button>
        <AlertDialog.Backdrop>
          <AlertDialog.Container>
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>
                  {selected?.currentPublicationId
                    ? "Republish saved Draft?"
                    : "Publish saved Draft?"}
                </AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                {selected?.currentPublicationId ? (
                  <p>
                    Republish saved Draft Version {selected?.draft.version} as a
                    new immutable Publication. Earlier Publications remain
                    unchanged, and the Current Publication switches only after
                    the new public read is available.
                  </p>
                ) : (
                  <p>
                    Publish saved Draft Version {selected?.draft.version} as a
                    new immutable Publication. It will be immediately public
                    after the Current Publication switches.
                  </p>
                )}
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button type="button" variant="secondary" slot="close">
                  Cancel
                </Button>
                <Button
                  type="button"
                  slot="close"
                  isDisabled={publishActionDisabled}
                  onPress={() => void publishDraft()}
                >
                  {selected?.currentPublicationId
                    ? "Republish saved Draft"
                    : "Publish saved Draft"}
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog.Root>
      <AlertDialog.Root>
        <Button
          fullWidth
          type="button"
          variant="danger-soft"
          aria-label="Unpublish this Article?"
          isDisabled={unpublishActionDisabled}
          isPending={unpublishState === "unpublishing"}
        >
          Unpublish Article
        </Button>
        <AlertDialog.Backdrop>
          <AlertDialog.Container>
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>
                  Unpublish this Article?
                </AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p>
                  Unpublish is reversible. It immediately removes the Current
                  Publication from the public list and makes public detail GET
                  and HEAD return 404. Draft and Publication history remain
                  intact, so you can edit and publish a new immutable
                  Publication later. This is not Trash or permanent purge, and
                  previously published media remains public.
                </p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button type="button" variant="secondary" slot="close">
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="danger-soft"
                  slot="close"
                  isDisabled={unpublishActionDisabled}
                  onPress={() => void unpublishCurrentPublication()}
                >
                  Unpublish Article
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog.Root>
      <p className="text-sm text-default-500">
        Trash removes an Article from normal administration and public Article
        endpoints while retaining its Draft, Publication history, slug claims,
        and Asset references. Restore always returns it as unpublished. This is
        not permanent purge, and previously published media remains public.
      </p>
      <AlertDialog.Root>
        <Button
          fullWidth
          type="button"
          variant="danger-soft"
          aria-label="Move this Article to Trash?"
          isDisabled={trashActionDisabled}
          isPending={trashActionState === "trashing"}
        >
          Move Article to Trash
        </Button>
        <AlertDialog.Backdrop>
          <AlertDialog.Container>
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>
                  Move this Article to Trash?
                </AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p>
                  Move {selected?.draft.title || "this Article"} to Trash? This
                  reversible action removes it from normal administration and
                  public Article list and detail endpoints immediately. If it is
                  public, its Current Publication is cleared. Its Draft,
                  retained Publications, slug claims, and Asset references stay
                  intact. Restoring it leaves it unpublished. This is not
                  permanent purge, and previously published media remains
                  public.
                </p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button type="button" variant="secondary" slot="close">
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="danger-soft"
                  slot="close"
                  isDisabled={trashActionDisabled}
                  onPress={() => void moveSelectedArticleToTrash()}
                >
                  Move Article to Trash
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog.Root>
      <section
        className="space-y-4 border-t border-default-200 pt-5"
        aria-labelledby="article-trash-heading"
      >
        <div className="space-y-1">
          <h3 id="article-trash-heading" className="text-lg font-semibold">
            Trash
          </h3>
          <p className="text-sm text-default-500">
            This separate authenticated view contains recoverable Articles only.
            Choose Restore Article to return one to normal administration as
            editable and unpublished.
          </p>
          <p className="text-sm text-default-500">
            Permanent purge is a separate destructive confirmation. It removes
            the identified Article, its Draft, and all Publication history
            forever. Only minimal formerly public slug tombstones remain; Asset
            objects are never deleted automatically.
          </p>
        </div>
        {trashActionState === "trashed" ? (
          <Alert status="success" role="status">
            <Alert.Content>
              <Alert.Title>Article moved to Trash</Alert.Title>
              <Alert.Description>
                It is absent from normal administration and public Article
                endpoints. Its recoverable work is intact; restoring it will
                leave it unpublished.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : trashActionState === "purged" ? (
          <Alert status="success" role="status">
            <Alert.Content>
              <Alert.Title>Article permanently purged</Alert.Title>
              <Alert.Description>
                The deleted content and authorship cannot be restored. Formerly
                public slugs remain reserved and return 410 Gone.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : trashActionState === "purge-error" ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>Unable to permanently purge Article</Alert.Title>
              <Alert.Description>
                Briefly did not confirm the destructive operation. The Article
                remains in Trash and can be retried safely.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : trashActionState === "restore-error" ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>Unable to restore Article</Alert.Title>
              <Alert.Description>
                Briefly did not confirm the restore. The Article remains in
                Trash; reload the Trash view and try again.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
        {trashViewState === "loading" ? (
          <div className="flex items-center gap-3" role="status">
            <Spinner aria-label="Loading Trash" />
            <span>Loading Trash…</span>
          </div>
        ) : trashViewState === "error" ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>Unable to load Trash</Alert.Title>
              <Alert.Description>
                <Button
                  className="mt-3"
                  type="button"
                  variant="secondary"
                  onPress={() => void reloadTrashView()}
                >
                  Reload Trash
                </Button>
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : trashedArticles.length === 0 ? (
          <p className="text-sm text-default-500">
            No recoverable Articles are in Trash.
          </p>
        ) : (
          <ul className="space-y-3" aria-label="Articles in Trash">
            {trashedArticles.map((article) => (
              <li
                key={article.id}
                className="space-y-3 rounded-xl border border-default-200 p-4"
              >
                <div className="space-y-1">
                  <p className="font-medium">
                    {article.title || "Untitled Article"}
                  </p>
                  <p className="break-all text-sm text-default-500">
                    Article ID {article.id}
                  </p>
                  <p className="text-sm text-default-500">
                    Draft Version {article.draftVersion} ·{" "}
                    {article.publicationCount} retained Publication
                    {article.publicationCount === 1 ? "" : "s"} · moved{" "}
                    <time dateTime={article.trashedAt}>
                      {article.trashedAt}
                    </time>
                  </p>
                </div>
                <AlertDialog.Root>
                  <Button
                    fullWidth
                    type="button"
                    variant="secondary"
                    aria-label={`Restore ${article.title || article.id} from Trash`}
                    isDisabled={articleSelectionDisabled}
                    isPending={trashActionState === "restoring"}
                  >
                    Restore Article
                  </Button>
                  <AlertDialog.Backdrop>
                    <AlertDialog.Container>
                      <AlertDialog.Dialog>
                        <AlertDialog.Header>
                          <AlertDialog.Heading>
                            Restore this Article from Trash?
                          </AlertDialog.Heading>
                        </AlertDialog.Header>
                        <AlertDialog.Body>
                          <p>
                            Restore {article.title || article.id} to normal
                            administration? Its Draft and Publication history
                            remain intact and editable, but it will have no
                            Current Publication. You must explicitly publish it
                            again before anonymous Article endpoints can see it.
                          </p>
                        </AlertDialog.Body>
                        <AlertDialog.Footer>
                          <Button
                            type="button"
                            variant="secondary"
                            slot="close"
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            slot="close"
                            isDisabled={articleSelectionDisabled}
                            onPress={() =>
                              void restoreArticleFromTrash(article)
                            }
                          >
                            Restore Article
                          </Button>
                        </AlertDialog.Footer>
                      </AlertDialog.Dialog>
                    </AlertDialog.Container>
                  </AlertDialog.Backdrop>
                </AlertDialog.Root>
                <AlertDialog.Root>
                  <Button
                    fullWidth
                    type="button"
                    variant="danger"
                    aria-label={`Permanently purge ${article.title || article.id}`}
                    isDisabled={articleSelectionDisabled}
                    isPending={trashActionState === "purging"}
                  >
                    Permanently purge Article
                  </Button>
                  <AlertDialog.Backdrop>
                    <AlertDialog.Container>
                      <AlertDialog.Dialog>
                        <AlertDialog.Header>
                          <AlertDialog.Heading>
                            Permanently purge this Article?
                          </AlertDialog.Heading>
                        </AlertDialog.Header>
                        <AlertDialog.Body>
                          <p>
                            Permanently purge Article ID {article.id}? This
                            cannot be undone. Its Draft and all Publication
                            history, including title, body, summary, tags,
                            Byline, language, and rendered HTML, will be deleted
                            and cannot be restored. Formerly public slugs remain
                            reserved and return 410 Gone. Asset objects are not
                            deleted automatically.
                          </p>
                        </AlertDialog.Body>
                        <AlertDialog.Footer>
                          <Button
                            type="button"
                            variant="secondary"
                            slot="close"
                          >
                            Cancel — keep Article
                          </Button>
                          <Button
                            type="button"
                            variant="danger"
                            slot="close"
                            isDisabled={articleSelectionDisabled}
                            onPress={() => void purgeArticleFromTrash(article)}
                          >
                            Confirm permanent purge
                          </Button>
                        </AlertDialog.Footer>
                      </AlertDialog.Dialog>
                    </AlertDialog.Container>
                  </AlertDialog.Backdrop>
                </AlertDialog.Root>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function ArticleEditorFallback() {
  return (
    <div className="rounded-xl border border-default-200 p-4" role="status">
      Loading the text-rich editor…
    </div>
  );
}

function SettingsField({
  label,
  htmlFor,
  children,
}: Readonly<{
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}>) {
  return (
    <div className="w-full space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
