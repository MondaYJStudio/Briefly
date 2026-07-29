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
        const loaded = response.data as unknown as SiteSettings;
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
        const error = response.error?.value as
          { issues?: { message: string }[] } | undefined;
        setSettingsIssues(error?.issues?.map((issue) => issue.message) ?? []);
        setSettingsState("error");
        return;
      }
      setSettings(response.data as unknown as SiteSettings);
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
