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
import { getLocale } from "../../paraglide/runtime.js";
import {
  APP_LOCALE_OPTIONS,
  type AppLocale,
  canonicalizeAppLocale,
  DEFAULT_APP_LOCALE,
} from "../../locales/registry";
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
import styles from "./settings-drawer.module.css";

interface SettingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: SiteSettings | null;
  onSettingsChange: (settings: SiteSettings) => void;
}

type SettingsState =
  "loading" | "ready" | "submitting" | "saved" | "failed" | "load-failed";

function localizeIssue(path: string, message: string): string {
  if (path.startsWith("siteDescriptions.")) {
    return /use at most \d+ characters\.?$/iu.test(message)
      ? m.site_description_too_long({
          maximum: SITE_DESCRIPTION_MAXIMUM_LENGTH,
        })
      : m.invalid_site_description();
  }
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

function siteDescriptionValue(
  settings: SiteSettings,
  locale: AppLocale,
): string {
  const hasLocalizedValue = Object.prototype.hasOwnProperty.call(
    settings.siteDescriptions ?? {},
    locale,
  );
  if (hasLocalizedValue) {
    return settings.siteDescriptions?.[locale] ?? "";
  }
  return locale === "en" ? (settings.siteDescription ?? "") : "";
}

function initialDescriptionLocale(): AppLocale {
  return canonicalizeAppLocale(getLocale()) ?? DEFAULT_APP_LOCALE;
}

function LoadingState() {
  return (
    <div
      className={`flex flex-col gap-4`}
      role="status"
      aria-label={m.loading_settings()}
    >
      <div className={`${styles.card} p-5`}>
        <div className={`${styles.skeleton} ${styles.skeletonTitle}`} />
        <div className={`${styles.skeleton} ${styles.skeletonInput} mt-4`} />
        <div className={`${styles.skeleton} ${styles.skeletonArea} mt-4`} />
      </div>
      <div className={`${styles.card} p-5`}>
        <div className={`${styles.skeleton} ${styles.skeletonWideTitle}`} />
        <div className={`${styles.skeleton} ${styles.skeletonInput} mt-4`} />
        <div className={`${styles.skeleton} ${styles.skeletonInput} mt-4`} />
        <div className={`${styles.skeleton} ${styles.skeletonPartial} mt-4`} />
      </div>
    </div>
  );
}

function SettingsCard({ children }: Readonly<{ children: ReactNode }>) {
  return <section className={`${styles.card} p-5`}>{children}</section>;
}

function SiteDescriptionField({
  settings,
  descriptionLocale,
  onDescriptionLocaleChange,
  issueByPath,
  onChange,
}: Readonly<{
  settings: SiteSettings;
  descriptionLocale: AppLocale;
  onDescriptionLocaleChange: (locale: AppLocale) => void;
  issueByPath: ReadonlyMap<string, string>;
  onChange: (next: SiteSettings) => void;
}>) {
  const activeOption =
    APP_LOCALE_OPTIONS.find((option) => option.id === descriptionLocale) ??
    APP_LOCALE_OPTIONS[0];
  const fieldId = `siteDescription-${activeOption.id}`;
  const activeIssuePath = `siteDescriptions.${activeOption.id}`;
  const value = siteDescriptionValue(settings, activeOption.id);

  return (
    <SettingsField
      label={m.site_description()}
      htmlFor={fieldId}
      optional={m.optional()}
      issues={
        issueByPath.has(activeIssuePath)
          ? [issueByPath.get(activeIssuePath)!]
          : []
      }
    >
      <div
        className={`${styles.descriptionLocaleTabs} flex flex-wrap gap-1 mb-2`}
        role="tablist"
        aria-label={m.site_description_languages()}
      >
        {APP_LOCALE_OPTIONS.map((option) => {
          const filled =
            siteDescriptionValue(settings, option.id).trim().length > 0;
          const invalid = issueByPath.has(`siteDescriptions.${option.id}`);
          return (
            <button
              key={option.id}
              id={`siteDescription-tab-${option.id}`}
              type="button"
              role="tab"
              className={`${styles.descriptionLocaleTab} inline-flex items-center border-0 bg-transparent cursor-pointer gap-1.5`}
              aria-selected={option.id === activeOption.id}
              aria-controls={`siteDescription-panel-${option.id}`}
              data-invalid={invalid || undefined}
              onClick={() => onDescriptionLocaleChange(option.id)}
            >
              <span>{option.label}</span>
              {filled || invalid ? (
                <span
                  className={styles.descriptionLocaleMark}
                  aria-hidden="true"
                />
              ) : null}
            </button>
          );
        })}
      </div>
      <div
        id={`siteDescription-panel-${activeOption.id}`}
        role="tabpanel"
        aria-labelledby={`siteDescription-tab-${activeOption.id}`}
      >
        <TextArea
          fullWidth
          className={styles.descriptionTextArea}
          id={fieldId}
          name={fieldId}
          maxLength={SITE_DESCRIPTION_MAXIMUM_LENGTH}
          aria-invalid={issueByPath.has(activeIssuePath)}
          aria-describedby={
            issueByPath.has(activeIssuePath) ? `${fieldId}-error` : undefined
          }
          value={value}
          onChange={(e) => {
            // An empty string is an intentional blank for this locale; the
            // API also accepts null when a caller wants the normal English
            // fallback.
            const nextValue = e.target.value;
            onChange({
              ...settings,
              siteDescription:
                activeOption.id === "en"
                  ? nextValue
                  : settings.siteDescription,
              siteDescriptions: {
                ...settings.siteDescriptions,
                [activeOption.id]: nextValue,
              },
            });
          }}
        />
      </div>
    </SettingsField>
  );
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
  const [descriptionLocale, setDescriptionLocale] = useState<AppLocale>(
    initialDescriptionLocale,
  );

  useEffect(() => {
    if (!open) return;
    let active = true;
    setState("loading");
    setIssues([]);
    setDescriptionLocale(initialDescriptionLocale());
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

  useEffect(() => {
    const firstInvalid = APP_LOCALE_OPTIONS.find((option) =>
      issueByPath.has(`siteDescriptions.${option.id}`),
    );
    if (firstInvalid) setDescriptionLocale(firstInvalid.id);
  }, [issueByPath]);

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
  // Site Settings share the Application Locale Registry with localized
  // descriptions.
  const languageOptions: ReadonlyArray<{
    id: string;
    label: string;
    detail: string;
  }> = APP_LOCALE_OPTIONS.some(
    (language) => language.id === settings?.defaultLanguage,
  )
    ? APP_LOCALE_OPTIONS
    : settings
      ? [
          {
            id: settings.defaultLanguage,
            label: settings.defaultLanguage,
            detail: settings.defaultLanguage,
          },
          ...APP_LOCALE_OPTIONS,
        ]
      : APP_LOCALE_OPTIONS;

  return (
    <Drawer.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Drawer.Content placement="right" className="briefly-drawer-wide">
        <Drawer.Dialog aria-label={m.settings_menu()}>
          <Drawer.Header>
            <div className={`flex w-full items-center justify-between gap-3`}>
              <div>
                <Drawer.Heading>
                  <strong>{m.settings_menu()}</strong>
                </Drawer.Heading>
                <p className={`text-xs faint ${styles.description}`}>
                  {m.settings_drawer_description()}
                </p>
              </div>
              <Drawer.CloseTrigger aria-label={m.close_settings()} />
            </div>
          </Drawer.Header>
          <Drawer.Body className={`p-5`}>
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
                className={`flex flex-col gap-4${disabled ? ` ${styles.formDisabled}` : ""}`}
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
                  <h2
                    className={`${styles.sectionTitle} text-base mt-0 mx-0 mb-5`}
                  >
                    {m.site_information()}
                  </h2>
                  <div className={`flex flex-col gap-5`}>
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
                    <SiteDescriptionField
                      settings={settings}
                      descriptionLocale={descriptionLocale}
                      onDescriptionLocaleChange={setDescriptionLocale}
                      issueByPath={issueByPath}
                      onChange={update}
                    />
                  </div>
                </SettingsCard>

                <SettingsCard>
                  <h2
                    className={`${styles.sectionTitle} text-base mt-0 mx-0 mb-5`}
                  >
                    {m.default_public_identity()}
                  </h2>
                  <p className={`text-xs muted -mt-3 mx-0 mb-5`}>
                    {m.default_public_identity_description()}
                  </p>
                  <div className={`flex flex-col gap-5`}>
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
                        <Select.Trigger
                          className={`${styles.languageTrigger} briefly-language-trigger flex items-center`}
                        >
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox aria-label={m.default_language_options()}>
                            {languageOptions.map((language) => (
                              <ListBox.Item
                                key={language.id}
                                id={language.id}
                                className="briefly-language-option flex w-full items-center justify-between gap-4"
                                textValue={`${language.label} (${language.detail})`}
                              >
                                <span>{language.label}</span>
                                <span className="briefly-select-detail text-xs">
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

                <div
                  className={`${styles.note} flex items-start text-sm gap-3 p-4`}
                  role="note"
                >
                  <AdminIcon name="alert" />
                  <div>{m.public_content_note()}</div>
                </div>
                <div
                  className={`${styles.actions} flex flex-wrap items-center justify-between gap-3`}
                >
                  <div className="min-w-0">
                    {state === "submitting" ? (
                      <span
                        className={`${styles.saveState} inline-flex items-center text-sm gap-2`}
                        role="status"
                      >
                        <Spinner size="sm" />
                        {m.saving()}
                      </span>
                    ) : state === "saved" ? (
                      <span
                        className={`${styles.saveState} ${styles.saveStateOk} inline-flex items-center text-sm gap-2`}
                        role="status"
                      >
                        <AdminIcon name="check" />
                        {m.all_changes_saved()}
                      </span>
                    ) : null}
                  </div>
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
