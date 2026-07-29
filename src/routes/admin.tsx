import {
  Alert,
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
  type PublicationIssue,
  type RenderedArticleDraft,
} from "../articles/articles";
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

type EditableArticleDraft = Pick<
  Article["draft"],
  "title" | "slug" | "summary" | "tags" | "byline" | "language" | "document"
>;

function editableArticleDraft(draft: Article["draft"]): EditableArticleDraft {
  const { title, slug, summary, tags, byline, language, document } = draft;
  return { title, slug, summary, tags, byline, language, document };
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

function ArticleDraftManager() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [selected, setSelected] = useState<Article | null>(null);
  const [state, setState] = useState<ArticleDraftManagerState>("loading");
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
  const [preview, setPreview] = useState<RenderedArticleDraft | null>(null);
  const [previewIssues, setPreviewIssues] = useState<PublicationIssue[]>([]);
  const [previewState, setPreviewState] = useState<
    "idle" | "loading" | "ready" | "invalid" | "conflict" | "error"
  >("idle");
  const previewRequestGeneration = useRef(0);

  function resetPreview() {
    previewRequestGeneration.current += 1;
    setPreview(null);
    setPreviewIssues([]);
    setPreviewState("idle");
  }

  function selectServerDraft(article: Article) {
    selectedRef.current = article;
    revisionRef.current = 0;
    confirmedRevisionRef.current = 0;
    setSelected(article);
    setRevision(0);
    setConfirmedRevision(0);
    setEditorGeneration((current) => current + 1);
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
    return () => {
      active = false;
    };
  }, []);

  async function createDraft() {
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
    } catch {
      setState("failed");
    }
  }

  async function loadDraft(articleId: string) {
    setState("loading");
    setIssues([]);
    try {
      const response = await getApiClient().admin.articles({ articleId }).get();
      if (response.status !== 200 || !response.data)
        throw new Error("Article unavailable");
      selectServerDraft(response.data);
      setState("ready");
    } catch {
      setState("failed");
    }
  }

  const persistCurrentDraft = useCallback(async (version?: number) => {
    const snapshot = selectedRef.current;
    if (!snapshot || savingRef.current) return;
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
        const localChanged = revisionRef.current !== capturedRevision;
        const next =
          localChanged && local?.id === response.data.id
            ? preserveLocalDraft(response.data, local)
            : response.data;
        selectedRef.current = next;
        setSelected(next);
        setArticles((current) =>
          current.map((article) => (article.id === next.id ? next : article)),
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
      if (revisionRef.current !== confirmedRevisionRef.current)
        setState("offline");
    }
    function markOnline() {
      setState((current) => (current === "offline" ? "failed" : current));
    }
    globalThis.addEventListener("offline", markOffline);
    globalThis.addEventListener("online", markOnline);
    return () => {
      globalThis.removeEventListener("offline", markOffline);
      globalThis.removeEventListener("online", markOnline);
    };
  }, []);

  function updateDraft(changes: Partial<Article["draft"]>) {
    const current = selectedRef.current;
    if (!current) return;
    const next = { ...current, draft: { ...current.draft, ...changes } };
    const nextRevision = revisionRef.current + 1;
    selectedRef.current = next;
    revisionRef.current = nextRevision;
    setSelected(next);
    setRevision(nextRevision);
    setIssues([]);
    setState("dirty");
  }

  async function reloadDraft() {
    const articleId = selectedRef.current?.id;
    if (!articleId) return;
    setState("loading");
    try {
      const response = await getApiClient().admin.articles({ articleId }).get();
      if (response.status !== 200 || !response.data)
        throw new Error("Article unavailable");
      selectServerDraft(response.data);
      setArticles((current) =>
        current.map((article) =>
          article.id === response.data.id ? response.data : article,
        ),
      );
      setState("ready");
    } catch {
      setState("failed");
    }
  }

  async function retryConflict() {
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
      const retry = preserveLocalDraft(response.data, local);
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
    !hasUnsavedChanges &&
    ["ready", "saved"].includes(state);
  const blocker = useBlocker({
    shouldBlockFn: () => hasUnsavedChanges,
    enableBeforeUnload: hasUnsavedChanges,
    withResolver: true,
  });

  async function previewSavedDraft() {
    if (!selected) return;
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

  return (
    <section
      className="space-y-5"
      aria-labelledby="article-drafts-heading"
      data-server-confirmed={serverConfirmed}
    >
      <div className="space-y-1">
        <h2 id="article-drafts-heading" className="text-xl font-semibold">
          Article Drafts
        </h2>
        <p className="text-sm text-default-500">
          Create incomplete Articles and autosave complete versioned Drafts. The
          text-rich editor loads after hydration while this shell remains
          server-rendered.
        </p>
      </div>
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
                <Button type="button" variant="secondary" onPress={reloadDraft}>
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
                <Button type="button" onPress={retryConflict}>
                  Deliberately retry local Draft
                </Button>
                <Button type="button" variant="secondary" onPress={reloadDraft}>
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
      <Button
        fullWidth
        type="button"
        isPending={state === "creating"}
        isDisabled={hasUnsavedChanges}
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
                isDisabled={hasUnsavedChanges}
                onPress={() => loadDraft(article.id)}
              >
                {article.draft.title || "Untitled Article"} · Version{" "}
                {article.draft.version}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {selected ? (
        <Form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void persistCurrentDraft();
          }}
        >
          <p className="text-sm text-default-500">
            Draft Version {selected.draft.version}
          </p>
          <output className="text-sm" data-server-confirmed={serverConfirmed}>
            {serverConfirmed
              ? "Latest client state is server-confirmed."
              : "Latest client state is not server-confirmed."}
          </output>
          <SettingsField label="Title" htmlFor="articleTitle">
            <Input
              fullWidth
              id="articleTitle"
              value={selected.draft.title}
              onChange={(event) => updateDraft({ title: event.target.value })}
            />
          </SettingsField>
          <SettingsField label="Unicode slug (optional)" htmlFor="articleSlug">
            <Input
              fullWidth
              id="articleSlug"
              value={selected.draft.slug ?? ""}
              onChange={(event) =>
                updateDraft({ slug: event.target.value || null })
              }
            />
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
                  onChange={(document) => updateDraft({ document })}
                />
              </Suspense>
            </ClientOnly>
          </div>
          <Button fullWidth type="submit" isPending={state === "saving"}>
            Save complete Draft now
          </Button>
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
              <div dangerouslySetInnerHTML={{ __html: preview.html }} />
            </article>
          </div>
        ) : null}
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
