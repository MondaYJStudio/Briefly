import {
  Alert,
  Button,
  Form,
  Input,
  Label,
  Spinner,
  TextArea,
} from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";

import type { Article, ArticleDraftUpdate } from "../articles/articles";
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

function ArticleDraftManager() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [selected, setSelected] = useState<Article | null>(null);
  const [state, setState] = useState<
    | "loading"
    | "ready"
    | "creating"
    | "saving"
    | "saved"
    | "invalid"
    | "conflict"
    | "error"
  >("loading");
  const [issues, setIssues] = useState<string[]>([]);

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
        if (active) setState("error");
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
      setSelected(response.data);
      setState("ready");
    } catch {
      setState("error");
    }
  }

  async function loadDraft(articleId: string) {
    setState("loading");
    setIssues([]);
    try {
      const response = await getApiClient().admin.articles({ articleId }).get();
      if (response.status !== 200 || !response.data)
        throw new Error("Article unavailable");
      setSelected(response.data);
      setState("ready");
    } catch {
      setState("error");
    }
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setState("saving");
    setIssues([]);
    const input: ArticleDraftUpdate = {
      version: selected.draft.version,
      title: selected.draft.title,
      slug: selected.draft.slug,
      summary: selected.draft.summary,
      tags: selected.draft.tags,
      byline: selected.draft.byline,
      language: selected.draft.language,
    };

    try {
      const response = await getApiClient()
        .admin.articles({ articleId: selected.id })
        .draft.put(input);
      if (response.status === 200 && response.data) {
        setSelected(response.data);
        setArticles((current) =>
          current.map((article) =>
            article.id === response.data.id ? response.data : article,
          ),
        );
        setState("saved");
        return;
      }

      const error = response.error?.value;
      if (response.status === 409) {
        setState("conflict");
      } else if (error && "issues" in error) {
        setIssues(error.issues.map((issue) => issue.message));
        setState("invalid");
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    }
  }

  function updateDraft(changes: Partial<Article["draft"]>) {
    setSelected((current) =>
      current
        ? { ...current, draft: { ...current.draft, ...changes } }
        : current,
    );
    setState("ready");
  }

  return (
    <section className="space-y-5" aria-labelledby="article-drafts-heading">
      <div className="space-y-1">
        <h2 id="article-drafts-heading" className="text-xl font-semibold">
          Article Drafts
        </h2>
        <p className="text-sm text-default-500">
          Create incomplete Articles and explicitly save versioned metadata.
        </p>
      </div>
      {state === "error" ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>Unable to manage Article Drafts</Alert.Title>
            <Alert.Description>Please try again.</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : state === "conflict" ? (
        <Alert status="warning" role="alert">
          <Alert.Content>
            <Alert.Title>Draft conflict</Alert.Title>
            <Alert.Description>
              A newer Draft Version is already saved. Reload it before saving
              again.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : state === "invalid" ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>Draft metadata is invalid</Alert.Title>
            <Alert.Description>
              <ul className="list-disc pl-5">
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : state === "saved" ? (
        <Alert status="success" role="status">
          <Alert.Content>
            <Alert.Title>Draft metadata saved</Alert.Title>
          </Alert.Content>
        </Alert>
      ) : null}
      <Button
        fullWidth
        type="button"
        isPending={state === "creating"}
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
        <Form className="space-y-4" onSubmit={saveDraft}>
          <p className="text-sm text-default-500">
            Draft Version {selected.draft.version}
          </p>
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
          <Button fullWidth type="submit" isPending={state === "saving"}>
            Save Draft metadata
          </Button>
        </Form>
      ) : null}
    </section>
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
