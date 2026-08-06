import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  ListBox,
  Select,
  Spinner,
  TextArea,
} from "@heroui/react";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";

import { getApiClient } from "../../routes/api.$";
import {
  BYLINE_NAME_MAXIMUM_LENGTH,
  BYLINE_URL_MAXIMUM_LENGTH,
  SITE_DESCRIPTION_MAXIMUM_LENGTH,
  SITE_NAME_MAXIMUM_LENGTH,
  type SiteSettings,
} from "../../site-settings/site-settings";
import { AdminIcon } from "./icons";
import { SettingsField } from "./fields";
import { LANGUAGE_OPTIONS } from "./language-options";

interface SettingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: SiteSettings | null;
  onSettingsChange: (settings: SiteSettings) => void;
}

type SettingsState = "loading" | "ready" | "submitting" | "saved" | "failed";

function LoadingState() {
  return (
    <div className="stack" role="status" aria-label="Loading settings">
      <div className="card card-pad">
        <div className="skeleton" style={{ width: "8rem", height: "0.9rem" }} />
        <div className="skeleton mt-4" style={{ height: "2.5rem" }} />
        <div className="skeleton mt-4" style={{ height: "5rem" }} />
      </div>
      <div className="card card-pad">
        <div
          className="skeleton"
          style={{ width: "10rem", height: "0.9rem" }}
        />
        <div className="skeleton mt-4" style={{ height: "2.5rem" }} />
        <div className="skeleton mt-4" style={{ height: "2.5rem" }} />
        <div
          className="skeleton mt-4"
          style={{ width: "60%", height: "2.5rem" }}
        />
      </div>
    </div>
  );
}

function SettingsCard({ children }: Readonly<{ children: ReactNode }>) {
  return <section className="card card-pad">{children}</section>;
}

export function SettingsDrawer({
  open,
  onOpenChange,
  settings,
  onSettingsChange,
}: SettingsDrawerProps) {
  const [state, setState] = useState<SettingsState>("loading");
  const [issues, setIssues] = useState<
    ReadonlyArray<{ path: string; message: string }>
  >([]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setState("loading");
    setIssues([]);
    void getApiClient()
      .admin["site-settings"].get()
      .then((response) => {
        if (response.status !== 200 || !response.data)
          throw new Error("unavailable");
        if (active) {
          onSettingsChange(response.data);
          setState("ready");
        }
      })
      .catch(() => {
        if (active) setState("failed");
      });
    return () => {
      active = false;
    };
    // Settings are intentionally refreshed whenever the drawer opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const issueByPath = useMemo(
    () => new Map(issues.map((issue) => [issue.path, issue.message])),
    [issues],
  );

  function update(next: SiteSettings) {
    onSettingsChange(next);
    if (state === "saved" || state === "failed") setState("ready");
  }

  async function persistSettings() {
    if (!settings) return;
    setState("submitting");
    setIssues([]);
    try {
      const response =
        await getApiClient().admin["site-settings"].put(settings);
      if (response.status !== 200 || !response.data) {
        const value = response.error?.value;
        const nextIssues = value && "issues" in value ? value.issues : [];
        setIssues(nextIssues);
        setState("failed");
        return;
      }
      onSettingsChange(response.data);
      setState("saved");
    } catch {
      setState("failed");
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void persistSettings();
  }

  const disabled = state === "submitting";
  const hasValidation = issues.length > 0;
  const languageOptions = LANGUAGE_OPTIONS.some(
    (language) => language.id === settings?.defaultLanguage,
  )
    ? LANGUAGE_OPTIONS
    : settings
      ? [
          {
            id: settings.defaultLanguage,
            label: settings.defaultLanguage,
            detail: settings.defaultLanguage,
          },
          ...LANGUAGE_OPTIONS,
        ]
      : LANGUAGE_OPTIONS;

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
            {state === "loading" || !settings ? (
              state === "loading" ? (
                <LoadingState />
              ) : (
                <Alert status="danger" role="alert">
                  <Alert.Content>
                    <Alert.Title>Unable to load Site Settings</Alert.Title>
                    <Alert.Description>
                      Refresh the page to try again.
                    </Alert.Description>
                  </Alert.Content>
                </Alert>
              )
            ) : (
              <Form
                className="stack"
                onSubmit={save}
                aria-label="Site settings"
                aria-disabled={disabled}
              >
                {hasValidation ? (
                  <Alert status="danger" role="alert">
                    <Alert.Content>
                      <Alert.Title>
                        {issues.length} field{issues.length === 1 ? "" : "s"}{" "}
                        need attention
                      </Alert.Title>
                      <Alert.Description>
                        Nothing was saved. Fix the highlighted fields and save
                        again.
                      </Alert.Description>
                    </Alert.Content>
                  </Alert>
                ) : state === "failed" ? (
                  <Alert status="danger" role="alert">
                    <Alert.Content>
                      <Alert.Title>Couldn’t save settings</Alert.Title>
                      <Alert.Description>
                        The request failed. Your edits are still in the form —
                        retry to send them again.
                      </Alert.Description>
                    </Alert.Content>
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={() => void persistSettings()}
                    >
                      Retry
                    </Button>
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

                <SettingsCard>
                  <h2 className="settings-section-title">Site information</h2>
                  <div className="field-stack">
                    <SettingsField
                      label="Site name"
                      htmlFor="siteName"
                      issues={
                        issueByPath.has("siteName")
                          ? [issueByPath.get("siteName")!]
                          : []
                      }
                    >
                      <Input
                        fullWidth
                        id="siteName"
                        name="siteName"
                        required
                        maxLength={SITE_NAME_MAXIMUM_LENGTH}
                        aria-invalid={issueByPath.has("siteName")}
                        aria-describedby={
                          issueByPath.has("siteName")
                            ? "siteName-error"
                            : undefined
                        }
                        value={settings.siteName}
                        onChange={(e) =>
                          update({ ...settings, siteName: e.target.value })
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
                        onChange={(e) =>
                          update({
                            ...settings,
                            siteDescription: e.target.value || null,
                          })
                        }
                      />
                    </SettingsField>
                  </div>
                </SettingsCard>

                <SettingsCard>
                  <h2 className="settings-section-title">
                    Default public identity
                  </h2>
                  <p className="small muted settings-section-description">
                    Shown alongside published content. Articles may override any
                    of these per article.
                  </p>
                  <div className="field-stack">
                    <SettingsField
                      label="Default byline name"
                      htmlFor="defaultBylineName"
                      issues={
                        issueByPath.has("defaultByline.name")
                          ? [issueByPath.get("defaultByline.name")!]
                          : []
                      }
                    >
                      <Input
                        fullWidth
                        id="defaultBylineName"
                        name="defaultBylineName"
                        required
                        maxLength={BYLINE_NAME_MAXIMUM_LENGTH}
                        aria-invalid={issueByPath.has("defaultByline.name")}
                        aria-describedby={
                          issueByPath.has("defaultByline.name")
                            ? "defaultBylineName-error"
                            : undefined
                        }
                        value={settings.defaultByline.name}
                        onChange={(e) =>
                          update({
                            ...settings,
                            defaultByline: {
                              ...settings.defaultByline,
                              name: e.target.value,
                            },
                          })
                        }
                      />
                    </SettingsField>
                    <SettingsField
                      label="Byline link"
                      htmlFor="defaultBylineUrl"
                      optional="optional"
                      issues={
                        issueByPath.has("defaultByline.url")
                          ? [issueByPath.get("defaultByline.url")!]
                          : []
                      }
                    >
                      <Input
                        fullWidth
                        id="defaultBylineUrl"
                        name="defaultBylineUrl"
                        type="url"
                        maxLength={BYLINE_URL_MAXIMUM_LENGTH}
                        aria-invalid={issueByPath.has("defaultByline.url")}
                        aria-describedby={
                          issueByPath.has("defaultByline.url")
                            ? "defaultBylineUrl-error"
                            : undefined
                        }
                        value={settings.defaultByline.url ?? ""}
                        onChange={(e) =>
                          update({
                            ...settings,
                            defaultByline: {
                              ...settings.defaultByline,
                              url: e.target.value || null,
                            },
                          })
                        }
                      />
                    </SettingsField>
                    <SettingsField
                      label="Default language"
                      htmlFor="defaultLanguage"
                      issues={
                        issueByPath.has("defaultLanguage")
                          ? [issueByPath.get("defaultLanguage")!]
                          : []
                      }
                    >
                      <Select
                        fullWidth
                        id="defaultLanguage"
                        name="defaultLanguage"
                        aria-invalid={issueByPath.has("defaultLanguage")}
                        aria-describedby={
                          issueByPath.has("defaultLanguage")
                            ? "defaultLanguage-error"
                            : undefined
                        }
                        selectedKey={settings.defaultLanguage}
                        onSelectionChange={(key) => {
                          if (key === null) return;
                          update({
                            ...settings,
                            defaultLanguage: String(key),
                          });
                        }}
                      >
                        <Select.Trigger className="briefly-language-trigger">
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox aria-label="Default language options">
                            {languageOptions.map((language) => (
                              <ListBox.Item
                                key={language.id}
                                id={language.id}
                                className="briefly-language-option"
                                textValue={`${language.label} (${language.detail})`}
                              >
                                <span>{language.label}</span>
                                <span className="briefly-select-detail mono">
                                  {language.detail}
                                </span>
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    </SettingsField>
                  </div>
                </SettingsCard>

                <div className="alert alert-default" role="note">
                  <AdminIcon name="alert" />
                  <div className="alert-body">
                    These values describe <strong>public content</strong>. They
                    are unrelated to the administrator sign-in email in Account.
                  </div>
                </div>
                <div className="row settings-actions">
                  {state === "submitting" ? (
                    <span className="save-state" role="status">
                      <Spinner size="sm" />
                      Saving…
                    </span>
                  ) : state === "saved" ? (
                    <span className="save-state is-ok" role="status">
                      <AdminIcon name="check" />
                      All changes saved · just now
                    </span>
                  ) : null}
                  <Button type="submit" isPending={disabled}>
                    {disabled ? "Saving…" : "Save changes"}
                  </Button>
                </div>
              </Form>
            )}
          </Drawer.Body>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}
