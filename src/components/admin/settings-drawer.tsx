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

import { m } from "../../paraglide/messages.js";
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
import styles from "./settings-drawer.module.css";

interface SettingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: SiteSettings | null;
  onSettingsChange: (settings: SiteSettings) => void;
}

type SettingsState =
  | "loading"
  | "ready"
  | "submitting"
  | "saved"
  | "failed"
  | "load-failed";

function localizeIssue(path: string, message: string): string {
  switch (path) {
    case "siteName":
      return m.enter_site_name();
    case "defaultByline.name":
      return m.enter_default_byline_name();
    case "defaultByline.url":
      return m.invalid_byline_url();
    case "defaultLanguage":
      return m.invalid_default_language();
    default:
      return message;
  }
}

function LoadingState() {
  return (
    <div className={styles.stack} role="status" aria-label={m.loading_settings()}>
      <div className={styles.card}>
        <div className={`${styles.skeleton} ${styles.skeletonTitle}`} />
        <div className={`${styles.skeleton} ${styles.skeletonInput} ${styles.mt4}`} />
        <div className={`${styles.skeleton} ${styles.skeletonArea} ${styles.mt4}`} />
      </div>
      <div className={styles.card}>
        <div className={`${styles.skeleton} ${styles.skeletonWideTitle}`} />
        <div className={`${styles.skeleton} ${styles.skeletonInput} ${styles.mt4}`} />
        <div className={`${styles.skeleton} ${styles.skeletonInput} ${styles.mt4}`} />
        <div
          className={`${styles.skeleton} ${styles.skeletonPartial} ${styles.mt4}`}
        />
      </div>
    </div>
  );
}

function SettingsCard({ children }: Readonly<{ children: ReactNode }>) {
  return <section className={styles.card}>{children}</section>;
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
        if (active) setState("load-failed");
      });
    return () => {
      active = false;
    };
    // Settings are intentionally refreshed whenever the drawer opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const issueByPath = useMemo(
    () =>
      new Map(
        issues.map((issue) => [
          issue.path,
          localizeIssue(issue.path, issue.message),
        ]),
      ),
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
        setState(nextIssues.length > 0 ? "ready" : "failed");
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
        <Drawer.Dialog aria-label={m.settings_menu()}>
          <Drawer.Header>
            <div className={styles.head}>
              <div>
                <Drawer.Heading>
                  <strong>{m.settings_menu()}</strong>
                </Drawer.Heading>
                <p className={`small faint ${styles.description}`}>
                  {m.settings_drawer_description()}
                </p>
              </div>
              <Drawer.CloseTrigger aria-label={m.close_settings()} />
            </div>
          </Drawer.Header>
          <Drawer.Body className={styles.body}>
            {state === "loading" ? (
              <LoadingState />
            ) : state === "load-failed" || !settings ? (
              <Alert status="danger" role="alert">
                <Alert.Content>
                  <Alert.Title>{m.unable_load_settings()}</Alert.Title>
                  <Alert.Description>
                    {m.unable_load_settings_description()}
                  </Alert.Description>
                </Alert.Content>
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => {
                    setState("loading");
                    setIssues([]);
                    void getApiClient()
                      .admin["site-settings"].get()
                      .then((response) => {
                        if (response.status !== 200 || !response.data)
                          throw new Error("unavailable");
                        onSettingsChange(response.data);
                        setState("ready");
                      })
                      .catch(() => setState("load-failed"));
                  }}
                >
                  {m.retry()}
                </Button>
              </Alert>
            ) : (
              <Form
                className={`${styles.stack}${disabled ? ` ${styles.formDisabled}` : ""}`}
                onSubmit={save}
                aria-label={m.site_settings_form()}
                aria-disabled={disabled}
              >
                {hasValidation ? (
                  <Alert status="danger" role="alert">
                    <Alert.Content>
                      <Alert.Title>
                        {issues.length === 1
                          ? m.settings_field_needs_attention()
                          : m.settings_fields_need_attention({
                              count: issues.length,
                            })}
                      </Alert.Title>
                      <Alert.Description>
                        {m.settings_fields_need_attention_description()}
                      </Alert.Description>
                    </Alert.Content>
                  </Alert>
                ) : state === "failed" ? (
                  <Alert
                    status="danger"
                    role="alert"
                    className={styles.retryInAlert}
                  >
                    <Alert.Content>
                      <Alert.Title>{m.couldnt_save_settings()}</Alert.Title>
                      <Alert.Description>
                        {m.couldnt_save_settings_description()}
                      </Alert.Description>
                    </Alert.Content>
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={() => void persistSettings()}
                    >
                      {m.retry()}
                    </Button>
                  </Alert>
                ) : state === "saved" ? (
                  <Alert status="success" role="status">
                    <Alert.Content>
                      <Alert.Title>{m.settings_saved()}</Alert.Title>
                      <Alert.Description>
                        {m.settings_saved_description()}
                      </Alert.Description>
                    </Alert.Content>
                  </Alert>
                ) : null}

                <SettingsCard>
                  <h2 className={styles.sectionTitle}>{m.site_information()}</h2>
                  <div className={styles.fieldStack}>
                    <SettingsField
                      label={m.site_name()}
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
                      label={m.site_description()}
                      htmlFor="siteDescription"
                      optional={m.optional()}
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
                  <h2 className={styles.sectionTitle}>
                    {m.default_public_identity()}
                  </h2>
                  <p className={`small muted ${styles.sectionDescription}`}>
                    {m.default_public_identity_description()}
                  </p>
                  <div className={styles.fieldStack}>
                    <SettingsField
                      label={m.default_byline_name()}
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
                      label={m.byline_link()}
                      htmlFor="defaultBylineUrl"
                      optional={m.optional()}
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
                      label={m.default_language()}
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
                        <Select.Trigger className={styles.languageTrigger}>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox aria-label={m.default_language_options()}>
                            {languageOptions.map((language) => (
                              <ListBox.Item
                                key={language.id}
                                id={language.id}
                                className={styles.languageOption}
                                textValue={`${language.label} (${language.detail})`}
                              >
                                <span>{language.label}</span>
                                <span className={styles.languageDetail}>
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

                <div className={styles.note} role="note">
                  <AdminIcon name="alert" />
                  <div>{m.public_content_note()}</div>
                </div>
                <div className={styles.actions}>
                  {state === "submitting" ? (
                    <span className={styles.saveState} role="status">
                      <Spinner size="sm" />
                      {m.saving()}
                    </span>
                  ) : state === "saved" ? (
                    <span
                      className={`${styles.saveState} ${styles.saveStateOk}`}
                      role="status"
                    >
                      <AdminIcon name="check" />
                      {m.all_changes_saved()}
                    </span>
                  ) : null}
                  <Button type="submit" isPending={disabled}>
                    {disabled ? m.saving() : m.save_changes()}
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
