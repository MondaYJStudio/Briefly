import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  Spinner,
  TextArea,
} from "@heroui/react";
import { type FormEvent, useEffect, useState } from "react";

import { getApiClient } from "../../routes/api.$";
import {
  BYLINE_NAME_MAXIMUM_LENGTH,
  BYLINE_URL_MAXIMUM_LENGTH,
  LANGUAGE_TAG_MAXIMUM_LENGTH,
  SITE_DESCRIPTION_MAXIMUM_LENGTH,
  SITE_NAME_MAXIMUM_LENGTH,
  type SiteSettings,
} from "../../site-settings/site-settings";
import { SettingsField } from "./fields";

interface SettingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: SiteSettings | null;
  onSettingsChange: (settings: SiteSettings) => void;
}

/**
 * Site settings as an overlay drawer (deep-linkable route in the prototype):
 * it covers the current page instead of replacing it.
 */
export function SettingsDrawer({
  open,
  onOpenChange,
  settings,
  onSettingsChange,
}: SettingsDrawerProps) {
  const [state, setState] = useState<
    "loading" | "ready" | "submitting" | "saved" | "error"
  >("loading");
  const [issues, setIssues] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setState("loading");
    void getApiClient()
      .admin["site-settings"].get()
      .then((response) => {
        if (response.status !== 200 || !response.data)
          throw new Error("Site Settings unavailable");
        if (active) {
          onSettingsChange(response.data);
          setState("ready");
        }
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    setState("submitting");
    setIssues([]);
    try {
      const response =
        await getApiClient().admin["site-settings"].put(settings);
      if (response.status !== 200 || !response.data) {
        const error = response.error?.value;
        setIssues(
          error && "issues" in error
            ? error.issues.map((issue) => issue.message)
            : [],
        );
        setState("error");
        return;
      }
      onSettingsChange(response.data);
      setState("saved");
    } catch {
      setState("error");
    }
  }

  return (
    <Drawer.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Drawer.Content placement="right" className="briefly-drawer-wide">
        <Drawer.Dialog aria-label="Settings">
          <Drawer.Header>
            <div className="briefly-drawer-head">
              <div>
                <Drawer.Heading>
                  <strong>Settings</strong>
                </Drawer.Heading>
                <p className="small faint" style={{ marginTop: 2 }}>
                  Public content defaults — articles inherit these unless they
                  override them.
                </p>
              </div>
              <Drawer.CloseTrigger aria-label="Close settings" />
            </div>
          </Drawer.Header>
          <Drawer.Body style={{ padding: "var(--space-5)" }}>
            {state === "loading" ? (
              <div className="card card-pad row" role="status">
                <Spinner aria-label="Loading Site Settings" />
                <span>Loading Site Settings…</span>
              </div>
            ) : settings ? (
              <Form className="stack" onSubmit={save}>
                {state === "error" ? (
                  <Alert status="danger" role="alert">
                    <Alert.Content>
                      <Alert.Title>Couldn’t save settings</Alert.Title>
                      <Alert.Description>
                        {issues.length > 0 ? (
                          <ul className="list-disc pl-5">
                            {issues.map((issue) => (
                              <li key={issue}>{issue}</li>
                            ))}
                          </ul>
                        ) : (
                          "The request failed. Your edits are still in the form — retry to send them again."
                        )}
                      </Alert.Description>
                    </Alert.Content>
                  </Alert>
                ) : state === "saved" ? (
                  <Alert status="success" role="status">
                    <Alert.Content>
                      <Alert.Title>Settings saved</Alert.Title>
                      <Alert.Description>
                        New defaults apply to articles that inherit them.
                        Articles with overrides are unchanged.
                      </Alert.Description>
                    </Alert.Content>
                  </Alert>
                ) : null}

                <div className="card card-pad">
                  <h2
                    style={{
                      fontSize: "var(--text-medium)",
                      fontWeight: 700,
                      marginBottom: "var(--space-5)",
                    }}
                  >
                    Site information
                  </h2>
                  <div className="field-stack">
                    <SettingsField label="Site name" htmlFor="siteName">
                      <Input
                        fullWidth
                        id="siteName"
                        name="siteName"
                        required
                        maxLength={SITE_NAME_MAXIMUM_LENGTH}
                        value={settings.siteName}
                        onChange={(event) =>
                          onSettingsChange({
                            ...settings,
                            siteName: event.target.value,
                          })
                        }
                      />
                    </SettingsField>
                    <SettingsField
                      label="Site description"
                      htmlFor="siteDescription"
                      optional="optional"
                    >
                      <TextArea
                        fullWidth
                        id="siteDescription"
                        name="siteDescription"
                        maxLength={SITE_DESCRIPTION_MAXIMUM_LENGTH}
                        value={settings.siteDescription ?? ""}
                        onChange={(event) =>
                          onSettingsChange({
                            ...settings,
                            siteDescription: event.target.value || null,
                          })
                        }
                      />
                    </SettingsField>
                  </div>
                </div>

                <div className="card card-pad">
                  <h2
                    style={{
                      fontSize: "var(--text-medium)",
                      fontWeight: 700,
                      marginBottom: "var(--space-2)",
                    }}
                  >
                    Default public identity
                  </h2>
                  <p
                    className="small muted"
                    style={{ marginBottom: "var(--space-5)" }}
                  >
                    Shown alongside published content. Articles may override any
                    of these per article.
                  </p>
                  <div className="field-stack">
                    <SettingsField
                      label="Default byline name"
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
                          onSettingsChange({
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
                      label="Byline link"
                      htmlFor="defaultBylineUrl"
                      optional="optional"
                    >
                      <Input
                        fullWidth
                        id="defaultBylineUrl"
                        name="defaultBylineUrl"
                        type="url"
                        maxLength={BYLINE_URL_MAXIMUM_LENGTH}
                        value={settings.defaultByline.url ?? ""}
                        onChange={(event) =>
                          onSettingsChange({
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
                      label="Default language"
                      htmlFor="defaultLanguage"
                      optional="BCP 47"
                      description={
                        <>
                          A BCP 47 tag such as <span className="mono">en</span>,{" "}
                          <span className="mono">en-US</span> or{" "}
                          <span className="mono">zh-Hans</span>.
                        </>
                      }
                    >
                      <Input
                        fullWidth
                        className="font-mono"
                        id="defaultLanguage"
                        name="defaultLanguage"
                        required
                        maxLength={LANGUAGE_TAG_MAXIMUM_LENGTH}
                        value={settings.defaultLanguage}
                        onChange={(event) =>
                          onSettingsChange({
                            ...settings,
                            defaultLanguage: event.target.value,
                          })
                        }
                      />
                    </SettingsField>
                  </div>
                </div>

                <div className="alert alert-default" role="note">
                  <div className="alert-body">
                    These values describe <strong>public content</strong>. They
                    are unrelated to the administrator sign-in email in Account.
                  </div>
                </div>

                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <Button type="submit" isPending={state === "submitting"}>
                    Save changes
                  </Button>
                </div>
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
          </Drawer.Body>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}
