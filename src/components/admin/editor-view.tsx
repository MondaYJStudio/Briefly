import {
  Alert,
  AlertDialog,
  Button,
  Drawer,
  Dropdown,
  Form,
  Input,
  ListBox,
  Modal,
  Select,
  Separator,
  Spinner,
  TextArea,
} from "@heroui/react";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";

import type {
  ArticleCoverUsage,
  ArticlePublicationHistoryEntry,
} from "../../articles/articles";
import {
  slugAfterManualEdit,
  slugAfterReset,
} from "../../articles/slug-follow";
import { commitTagChipInput } from "../../articles/tag-chips";
import type { AssetLibraryEntry, ReadyAsset } from "../../assets/assets";
import {
  VerifiedAssetPicker,
  type VerifiedAssetPickerState,
} from "../../assets/verified-asset-picker";
import { m } from "../../paraglide/messages.js";
import { getApiClient } from "../../routes/api.$";
import type { SiteSettings } from "../../site-settings/site-settings";
import styles from "./editor-view.module.css";
import { SettingsField } from "./fields";
import { AdminIcon } from "./icons";
import { LANGUAGE_OPTIONS } from "./language-options";
import {
  localizePublicationIssue,
  localizeRestorationIssue,
  publicationIssuesForSurface,
  type PublicationIssueSurface,
} from "./publication-issues";
import { StatusChip } from "./status-chip";
import type { ArticleWorkspace } from "./use-article-workspace";
import { WorkspaceAlerts } from "./workspace-alerts";

const ArticleEditor = lazy(async () => {
  const module = await import("../../routes/-article-editor");
  return { default: module.ArticleEditor };
});

function ArticleEditorFallback() {
  return (
    <div className={`${styles.card} ${styles.cardPad}`} role="status">
      {m.loading_text_rich_editor()}
    </div>
  );
}

interface EditorViewProps {
  workspace: ArticleWorkspace;
  siteSettings: SiteSettings | null;
  onBack: () => void;
  onPreviewOpenChange: (open: boolean) => void;
}

/**
 * The editor screen from the prototype: top bar (back / title / save state /
 * preview / publish / more), a centered writing canvas, and a right rail with
 * Settings and History tabs.
 */
export function EditorView({
  workspace,
  siteSettings,
  onBack,
  onPreviewOpenChange,
}: EditorViewProps) {
  const {
    selected,
    state,
    editorLocked,
    lifecycleActionPending,
    editorGeneration,
  } = workspace;
  const [railOpen, setRailOpen] = useState(false);
  const [railTab, setRailTab] = useState<"settings" | "history">("settings");
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [unpublishDialogOpen, setUnpublishDialogOpen] = useState(false);
  const [trashDialogOpen, setTrashDialogOpen] = useState(false);

  useEffect(() => {
    if (
      !selected?.currentPublicationId ||
      !workspace.serverConfirmed ||
      workspace.lifecycleActionPending ||
      workspace.historyState !== "idle"
    ) {
      return;
    }
    void workspace.loadPublicationHistory();
  }, [
    selected?.currentPublicationId,
    selected?.id,
    workspace.historyState,
    workspace.lifecycleActionPending,
    workspace.serverConfirmed,
  ]);

  if (!selected) return null;
  const hasCurrentPublication = selected.currentPublicationId !== null;
  const checkingPublicationState =
    hasCurrentPublication &&
    (workspace.historyState === "idle" || workspace.historyState === "loading");

  function openPreview() {
    void workspace.previewSavedDraft();
    onPreviewOpenChange(true);
  }

  return (
    <main className={styles.editorMain} id="admin-main">
      {/* ===== Top bar ===== */}
      <header className={styles.editorTopbar}>
        <Button
          isIconOnly
          size="sm"
          type="button"
          variant="ghost"
          aria-label={m.back_to_articles()}
          isDisabled={lifecycleActionPending}
          onPress={onBack}
        >
          <AdminIcon name="back" size={18} />
        </Button>
        <div className={styles.titleWrap}>
          <span className={styles.docTitle}>
            {selected.draft.title || m.untitled_article()}
          </span>
          <span className={styles.hideM}>
            {workspace.hasUnsavedChanges ||
            (hasCurrentPublication &&
              workspace.historyHasUnpublishedChanges) ? (
              <StatusChip variant="warning" icon="alert">
                {m.lifecycle_changes_pending()}
              </StatusChip>
            ) : checkingPublicationState ? (
              <StatusChip variant="default" icon="clock">
                {m.checking_live_state()}
              </StatusChip>
            ) : hasCurrentPublication ? (
              <StatusChip variant="success" dot>
                {m.lifecycle_published()}
              </StatusChip>
            ) : (
              <StatusChip variant="default" dot>
                {m.lifecycle_draft()}
              </StatusChip>
            )}
          </span>
        </div>
        <EditorSaveState workspace={workspace} />
        <Button
          className={styles.hideM}
          size="sm"
          type="button"
          variant="outline"
          isDisabled={lifecycleActionPending}
          onPress={openPreview}
        >
          {m.preview()}
        </Button>
        <Button
          size="sm"
          type="button"
          isDisabled={workspace.publishActionDisabled}
          isPending={workspace.publishState === "publishing"}
          onPress={() => setPublishDialogOpen(true)}
        >
          {hasCurrentPublication ? m.republish() : m.publish()}
        </Button>
        <Dropdown.Root>
          <Dropdown.Trigger
            aria-label={m.more_article_actions()}
            className={styles.moreTrigger}
          >
            <AdminIcon name="more" size={18} />
          </Dropdown.Trigger>
          <Dropdown.Popover placement="bottom end">
            <Dropdown.Menu
              aria-label={m.more_article_actions()}
              onAction={(key) => {
                if (key === "save") void workspace.persistCurrentDraft();
                else if (key === "preview") openPreview();
                else if (key === "unpublish") setUnpublishDialogOpen(true);
                else if (key === "trash") setTrashDialogOpen(true);
              }}
            >
              <Dropdown.Item
                id="save"
                textValue={m.save_now()}
                isDisabled={lifecycleActionPending || state === "saving"}
              >
                {m.save_now()}
              </Dropdown.Item>
              <Dropdown.Item
                id="preview"
                textValue={m.preview_saved_draft()}
              >
                {m.preview_saved_draft()}
              </Dropdown.Item>
              <Separator />
              <Dropdown.Item
                id="unpublish"
                textValue={m.unpublish()}
                isDisabled={workspace.unpublishActionDisabled}
              >
                {m.unpublish_ellipsis()}
              </Dropdown.Item>
              <Dropdown.Item
                id="trash"
                textValue={m.move_to_trash()}
                className="text-danger"
                isDisabled={workspace.trashActionDisabled}
              >
                {m.move_to_trash_ellipsis()}
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown.Root>
        <Button
          isIconOnly
          className={styles.railToggle}
          size="sm"
          type="button"
          variant="ghost"
          aria-label={m.open_article_settings()}
          aria-controls="article-settings-rail"
          aria-expanded={railOpen}
          onPress={() => setRailOpen(true)}
        >
          <AdminIcon name="panel" size={18} />
        </Button>
      </header>

      {/* ===== Body: canvas + rail ===== */}
      <div className={styles.editorBody}>
        <div className={styles.editorScroll} id="canvas">
          <div className={styles.editorCanvas}>
            <WorkspaceAlerts workspace={workspace} />
            <Form
              onSubmit={(event) => {
                event.preventDefault();
                void workspace.persistCurrentDraft();
              }}
            >
              <fieldset
                aria-busy={editorLocked}
                disabled={editorLocked}
                className={styles.fieldsetReset}
              >
                {workspace.restoreState === "restoring" ? (
                  <p className={styles.pendingState} role="status">
                    {m.restoring_publication_paused()}
                  </p>
                ) : workspace.trashActionState === "trashing" ? (
                  <p className={styles.pendingState} role="status">
                    {m.moving_to_trash_paused()}
                  </p>
                ) : workspace.trashActionState === "restoring" ? (
                  <p className={styles.pendingState} role="status">
                    {m.restoring_from_trash_paused()}
                  </p>
                ) : null}

                <ClientOnly fallback={<ArticleEditorFallback />}>
                  <Suspense fallback={<ArticleEditorFallback />}>
                    <ArticleEditor
                      key={`${selected.id}:${editorGeneration}`}
                      title={selected.draft.title}
                      document={selected.draft.document}
                      cover={selected.draft.cover}
                      publicationIssues={workspace.publicationIssues}
                      isDisabled={editorLocked}
                      onTitleChange={(title) =>
                        workspace.updateDraft({ title })
                      }
                      onChange={(document) =>
                        workspace.updateDraft({ document })
                      }
                      onCoverChange={(cover) =>
                        workspace.updateDraft({ cover })
                      }
                    />
                  </Suspense>
                </ClientOnly>
              </fieldset>
            </Form>
          </div>
        </div>

        <EditorRail
          workspace={workspace}
          siteSettings={siteSettings}
          railOpen={railOpen}
          tab={railTab}
          onTabChange={setRailTab}
          onClose={() => setRailOpen(false)}
          onOpenPublishDialog={() => setPublishDialogOpen(true)}
          onOpenUnpublishDialog={() => setUnpublishDialogOpen(true)}
          onOpenTrashDialog={() => setTrashDialogOpen(true)}
          onPreview={openPreview}
        />
      </div>

      {/* ===== Publish / republish confirmation ===== */}
      <AlertDialog.Backdrop
        isOpen={publishDialogOpen}
        onOpenChange={setPublishDialogOpen}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>
                {hasCurrentPublication
                  ? m.republish_saved_draft_question()
                  : m.publish_saved_draft_question()}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              {hasCurrentPublication ? (
                <p>
                  {m.republish_saved_draft_body({
                    version: selected.draft.version,
                  })}
                </p>
              ) : (
                <p>
                  {m.publish_saved_draft_body({
                    version: selected.draft.version,
                  })}
                </p>
              )}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button type="button" variant="secondary" slot="close">
                {m.cancel()}
              </Button>
              <Button
                type="button"
                slot="close"
                isDisabled={workspace.publishActionDisabled}
                onPress={() => void workspace.publishDraft()}
              >
                {hasCurrentPublication
                  ? m.republish_saved_draft()
                  : m.publish_saved_draft()}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>

      {/* ===== Unpublish confirmation ===== */}
      <AlertDialog.Backdrop
        isOpen={unpublishDialogOpen}
        onOpenChange={setUnpublishDialogOpen}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>
                {m.unpublish_article_question()}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>{m.unpublish_article_body()}</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button type="button" variant="secondary" slot="close">
                {m.cancel()}
              </Button>
              <Button
                type="button"
                variant="danger-soft"
                slot="close"
                isDisabled={workspace.unpublishActionDisabled}
                onPress={() => void workspace.unpublishCurrentPublication()}
              >
                {m.unpublish_article()}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>

      {/* ===== Move to Trash confirmation ===== */}
      <AlertDialog.Backdrop
        isOpen={trashDialogOpen}
        onOpenChange={setTrashDialogOpen}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>
                {m.move_article_to_trash_question()}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>
                {m.move_article_to_trash_body({
                  title:
                    selected.draft.title ||
                    m.move_article_to_trash_title_fallback(),
                })}
              </p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button type="button" variant="secondary" slot="close">
                {m.cancel()}
              </Button>
              <Button
                type="button"
                variant="danger-soft"
                slot="close"
                isDisabled={workspace.trashActionDisabled}
                onPress={() => void workspace.moveSelectedArticleToTrash()}
              >
                {m.move_article_to_trash()}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </main>
  );
}

/** The truth-telling save indicator from the prototype top bar. */
function EditorSaveState({
  workspace,
}: Readonly<{ workspace: ArticleWorkspace }>) {
  const { selected, state, serverConfirmed } = workspace;
  let tone = "is-ok";
  let icon: ReactNode = <AdminIcon name="check" size={14} strokeWidth={2.2} />;
  let text = m.save_state_saved_draft({
    version: selected?.draft.version ?? 0,
  });
  let compactText = m.save_state_saved();
  if (state === "saving") {
    tone = "";
    text = m.save_state_saving();
    compactText = text;
    icon = <Spinner aria-hidden="true" className={styles.spinner} />;
  } else if (state === "dirty") {
    tone = "";
    text = m.save_state_unsaved_changes();
    compactText = m.save_state_unsaved();
    icon = <AdminIcon name="clock" size={14} strokeWidth={2.2} />;
  } else if (state === "failed") {
    tone = "is-error";
    text = m.save_state_failed();
    compactText = m.save_state_failed_compact();
    icon = <AdminIcon name="alert" size={14} strokeWidth={2.2} />;
  } else if (state === "offline") {
    tone = "is-warn";
    text = m.save_state_offline();
    compactText = text;
    icon = <AdminIcon name="offline" size={14} strokeWidth={2.2} />;
  } else if (state === "conflict") {
    tone = "is-warn";
    text = m.save_state_conflict();
    compactText = text;
    icon = <AdminIcon name="conflict" size={14} strokeWidth={2.2} />;
  } else if (state === "invalid") {
    tone = "is-error";
    text = m.save_state_invalid();
    compactText = text;
    icon = <AdminIcon name="alert" size={14} strokeWidth={2.2} />;
  } else if (state === "slug-conflict") {
    tone = "is-warn";
    text = m.save_state_slug_taken();
    compactText = text;
    icon = <AdminIcon name="alert" size={14} strokeWidth={2.2} />;
  } else if (!serverConfirmed) {
    tone = "";
    text = m.save_state_not_confirmed();
    compactText = m.save_state_pending();
    icon = <AdminIcon name="clock" size={14} strokeWidth={2.2} />;
  }
  return (
    <span
      className={`${styles.saveState}${tone === "is-error" ? ` ${styles.isError}` : tone === "is-warn" ? ` ${styles.isWarn}` : tone === "is-ok" ? ` ${styles.isOk}` : ""}`}
      role="status"
    >
      {icon}
      <span className={styles.saveStateFull}>{text}</span>
      <span className={styles.saveStateCompact}>{compactText}</span>
    </span>
  );
}

function EditorRail({
  workspace,
  siteSettings,
  railOpen,
  tab,
  onTabChange,
  onClose,
  onOpenPublishDialog,
  onOpenUnpublishDialog,
  onOpenTrashDialog,
  onPreview,
}: Readonly<{
  workspace: ArticleWorkspace;
  siteSettings: SiteSettings | null;
  railOpen: boolean;
  tab: "settings" | "history";
  onTabChange: (tab: "settings" | "history") => void;
  onClose: () => void;
  onOpenPublishDialog: () => void;
  onOpenUnpublishDialog: () => void;
  onOpenTrashDialog: () => void;
  onPreview: () => void;
}>) {
  const {
    selected,
    serverConfirmed,
    lifecycleActionPending,
    publicationHistory,
    historyHasUnpublishedChanges,
    historyState,
  } = workspace;
  const [subTab, setSubTab] = useState<"basic" | "advanced">("basic");
  if (!selected) return null;
  const draft = selected.draft;
  const hasCurrentPublication = selected.currentPublicationId !== null;
  const currentPublication = publicationHistory.find(
    (publication) => publication.isCurrent,
  );
  const checkingPublicationState =
    hasCurrentPublication &&
    (historyState === "idle" || historyState === "loading");
  const changesPending =
    hasCurrentPublication &&
    (workspace.hasUnsavedChanges || historyHasUnpublishedChanges);
  const issueMessages = (surface: PublicationIssueSurface) =>
    publicationIssuesForSurface(workspace.publicationIssues, surface).map(
      (issue) => localizePublicationIssue(issue),
    );
  const unpublishDisabledReason =
    workspace.unpublishActionDisabled && !hasCurrentPublication
      ? m.unpublish_disabled_no_current_publication()
      : null;
  const trashDisabledReason =
    workspace.trashActionDisabled && !serverConfirmed
      ? m.trash_disabled_not_server_confirmed()
      : null;

  return (
    <aside
      id="article-settings-rail"
      className={`${styles.rail}${railOpen ? ` ${styles.railOpen}` : ""}`}
      aria-label={m.article_settings()}
    >
      <div className={`${styles.railTabs} ${styles.rowBetween}`}>
        <div
          className={styles.tabsLineList}
          role="tablist"
          aria-label={m.rail_settings_sections()}
        >
          {(
            [
              ["settings", m.rail_tab_settings()],
              ["history", m.rail_tab_history()],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={styles.tabLine}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => onTabChange(id)}
            >
              {label}
              {id === "history" && workspace.publicationHistory.length > 0 ? (
                <span className={styles.tabCount}>
                  {workspace.publicationHistory.length}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <button
          className={`${styles.tabLine} ${styles.railClose}`}
          type="button"
          aria-label={m.close_article_settings()}
          onClick={onClose}
        >
          <AdminIcon name="close" size={16} />
        </button>
      </div>

      {tab === "settings" ? (
        <div role="tabpanel" aria-label={m.rail_tab_settings()}>
          {/* ---- Publish ---- */}
          <section className={styles.railSection}>
            <h3>{m.rail_publish_heading()}</h3>
            <div className={styles.fieldStack}>
              <div className={styles.rowGap2}>
                {changesPending ? (
                  <StatusChip variant="warning" icon="alert">
                    {m.lifecycle_changes_pending()}
                  </StatusChip>
                ) : checkingPublicationState ? (
                  <StatusChip variant="default" icon="clock">
                    {m.checking_live_state()}
                  </StatusChip>
                ) : hasCurrentPublication ? (
                  <StatusChip variant="success" dot>
                    {m.lifecycle_published()}
                  </StatusChip>
                ) : (
                  <StatusChip variant="default" dot>
                    {m.lifecycle_draft()}
                  </StatusChip>
                )}
                <span className="small muted">
                  {changesPending
                    ? m.rail_draft_ahead()
                    : checkingPublicationState
                      ? m.rail_loading_current_publication()
                      : hasCurrentPublication
                        ? m.rail_live_from_current()
                        : m.rail_not_public_yet()}
                </span>
              </div>
              <dl className={styles.pubDetail}>
                <dt>{m.rail_draft_label()}</dt>
                <dd>
                  {serverConfirmed
                    ? m.rail_draft_saved({ version: selected.draft.version })
                    : m.rail_draft_not_confirmed({
                        version: selected.draft.version,
                      })}
                </dd>
                <dt>{m.rail_live_label()}</dt>
                <dd>
                  {currentPublication
                    ? m.rail_live_publication({
                        number: currentPublication.publicationNumber,
                        date: new Date(
                          currentPublication.publishedAt,
                        ).toLocaleDateString(),
                      })
                    : checkingPublicationState
                      ? m.rail_loading_ellipsis()
                      : hasCurrentPublication
                        ? m.current_publication_selected()
                        : m.rail_live_none()}
                </dd>
                <dt>{m.rail_public_slug()}</dt>
                <dd className="mono">
                  {currentPublication
                    ? `/${currentPublication.slug}`
                    : m.rail_em_dash()}
                </dd>
              </dl>
              <Button
                fullWidth
                type="button"
                variant="secondary"
                isDisabled={lifecycleActionPending}
                isPending={workspace.previewState === "loading"}
                onPress={onPreview}
              >
                {m.preview_saved_draft_version({
                  version: selected.draft.version,
                })}
              </Button>
              <Button
                fullWidth
                type="button"
                isDisabled={workspace.publishActionDisabled}
                isPending={workspace.publishState === "publishing"}
                onPress={onOpenPublishDialog}
              >
                {hasCurrentPublication
                  ? m.republish_saved_draft()
                  : m.publish_saved_draft()}
              </Button>
              <p className={`small faint ${styles.previewMeta}`}>
                {m.rail_publishing_footnote()}
              </p>
            </div>
          </section>

          {/* ---- Basic / Advanced switch ---- */}
          <section
            className={`${styles.railSection} ${styles.railSectionFlush}`}
          >
            <div
              className={styles.subNav}
              role="tablist"
              aria-label={m.rail_subnav_label()}
            >
              <button
                type="button"
                role="tab"
                className={styles.subNavButton}
                aria-selected={subTab === "basic"}
                onClick={() => setSubTab("basic")}
              >
                {m.rail_tab_basic()}
              </button>
              <button
                type="button"
                role="tab"
                className={styles.subNavButton}
                aria-selected={subTab === "advanced"}
                onClick={() => setSubTab("advanced")}
              >
                {m.rail_tab_advanced()}
              </button>
            </div>
          </section>

          {subTab === "basic" ? (
            <section
              className={styles.railSection}
              role="tabpanel"
              aria-label={m.rail_tab_basic()}
            >
              <div className={styles.fieldStack}>
                <SettingsField
                  label={m.title_label()}
                  htmlFor="articleTitleRail"
                  issues={issueMessages("title")}
                >
                  <Input
                    fullWidth
                    id="articleTitleRail"
                    value={draft.title}
                    onChange={(event) =>
                      workspace.updateDraft({ title: event.target.value })
                    }
                  />
                </SettingsField>
                <SettingsField
                  label={m.summary_label()}
                  htmlFor="articleSummary"
                >
                  <TextArea
                    fullWidth
                    id="articleSummary"
                    value={draft.summary ?? ""}
                    onChange={(event) =>
                      workspace.updateDraft({
                        summary: event.target.value || null,
                      })
                    }
                  />
                </SettingsField>
                <TagsField
                  tags={draft.tags}
                  disabled={lifecycleActionPending}
                  onChange={(tags) => workspace.updateDraft({ tags })}
                />
                <CoverField
                  cover={draft.cover}
                  disabled={lifecycleActionPending}
                  issues={issueMessages("cover")}
                  onChange={(cover) => workspace.updateDraft({ cover })}
                />
              </div>
            </section>
          ) : (
            <section
              className={styles.railSection}
              role="tabpanel"
              aria-label={m.rail_tab_advanced()}
            >
              <div className={styles.fieldStack}>
                <SettingsField
                  label={m.advanced_slug_label()}
                  htmlFor="articleSlug"
                  issues={issueMessages("slug")}
                  description={
                    <>
                      {m.slug_uniqueness_note()}{" "}
                      {draft.slugIsManual
                        ? m.slug_manual_hint()
                        : m.slug_following_title_hint()}
                    </>
                  }
                >
                  <div className={styles.slugRow}>
                    <Input
                      fullWidth
                      id="articleSlug"
                      value={draft.slug ?? ""}
                      onChange={(event) => {
                        const next = slugAfterManualEdit(event.target.value);
                        workspace.updateDraft({
                          slug: next.slug,
                          slugIsManual: true,
                        });
                      }}
                    />
                    {draft.slugIsManual ? (
                      <Button
                        size="sm"
                        type="button"
                        variant="secondary"
                        isDisabled={lifecycleActionPending}
                        onPress={() =>
                          workspace.updateDraft({
                            slug: slugAfterReset(draft.title).slug,
                            slugIsManual: false,
                          })
                        }
                      >
                        <AdminIcon name="undo" size={14} />
                        {m.reset_slug_to_title()}
                      </Button>
                    ) : null}
                  </div>
                </SettingsField>

                <SettingsField
                  label={m.byline_override_name_label()}
                  htmlFor="articleBylineName"
                  issues={issueMessages("byline")}
                >
                  <Input
                    fullWidth
                    id="articleBylineName"
                    value={draft.byline?.name ?? ""}
                    onChange={(event) =>
                      workspace.updateDraft({
                        byline: event.target.value
                          ? {
                              name: event.target.value,
                              url: draft.byline?.url ?? null,
                            }
                          : null,
                      })
                    }
                  />
                </SettingsField>
                {siteSettings ? (
                  <p className={styles.inheritNote}>
                    {m.inheriting_value({
                      value: siteSettings.defaultByline.name,
                    })}
                  </p>
                ) : null}
                <SettingsField
                  label={m.byline_override_url_label()}
                  htmlFor="articleBylineUrl"
                >
                  <Input
                    fullWidth
                    id="articleBylineUrl"
                    type="url"
                    disabled={!draft.byline}
                    value={draft.byline?.url ?? ""}
                    onChange={(event) =>
                      draft.byline &&
                      workspace.updateDraft({
                        byline: {
                          ...draft.byline,
                          url: event.target.value || null,
                        },
                      })
                    }
                  />
                </SettingsField>
                <SettingsField
                  label={m.language_override_label()}
                  htmlFor="articleLanguage"
                  optional={m.optional()}
                  issues={issueMessages("language")}
                >
                  <Select
                    fullWidth
                    id="articleLanguage"
                    aria-label={m.language_override_label()}
                    selectedKey={draft.language ?? undefined}
                    onSelectionChange={(key) =>
                      workspace.updateDraft({
                        language:
                          key === null || key === "" ? null : String(key),
                      })
                    }
                  >
                    <Select.Trigger className="briefly-language-trigger">
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox aria-label={m.language_override_label()}>
                        <ListBox.Item
                          id=""
                          textValue={m.inherit_default_language()}
                        >
                          {m.inherit_default_language()}
                        </ListBox.Item>
                        {LANGUAGE_OPTIONS.map((language) => (
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
                {siteSettings ? (
                  <p className={styles.inheritNote}>
                    {m.inheriting_value({
                      value: siteSettings.defaultLanguage,
                    })}
                  </p>
                ) : null}
              </div>
            </section>
          )}

          {/* ---- Danger zone ---- */}
          <section
            className={`${styles.railSection} ${styles.railSectionFlush}`}
          >
            <h3>{m.danger_zone_title()}</h3>
            <div className={styles.dangerZone}>
              <div className={styles.dangerZoneHead}>
                {m.danger_zone_caution()}
              </div>
              <div className={styles.dangerRow}>
                <p className={styles.dangerCopy}>
                  <strong>{m.unpublish()}</strong>
                  {m.danger_unpublish_description()}
                  {unpublishDisabledReason ? (
                    <span className={styles.dangerReason}>
                      {unpublishDisabledReason}
                    </span>
                  ) : null}
                </p>
                <Button
                  size="sm"
                  type="button"
                  variant="danger-soft"
                  isDisabled={workspace.unpublishActionDisabled}
                  isPending={workspace.unpublishState === "unpublishing"}
                  onPress={onOpenUnpublishDialog}
                >
                  {m.unpublish()}
                </Button>
              </div>
              <div className={styles.dangerRow}>
                <p className={styles.dangerCopy}>
                  <strong>{m.move_to_trash()}</strong>
                  {m.danger_trash_description()}
                  {trashDisabledReason ? (
                    <span className={styles.dangerReason}>
                      {trashDisabledReason}
                    </span>
                  ) : null}
                </p>
                <Button
                  size="sm"
                  type="button"
                  variant="danger-soft"
                  isDisabled={workspace.trashActionDisabled}
                  isPending={workspace.trashActionState === "trashing"}
                  onPress={onOpenTrashDialog}
                >
                  {m.move_to_trash()}
                </Button>
              </div>
            </div>
          </section>
        </div>
      ) : (
        <HistoryPanel workspace={workspace} />
      )}
    </aside>
  );
}

/** Enter/comma chip entry for flat, normalized Article tags. */
function TagsField({
  tags,
  disabled,
  onChange,
}: Readonly<{
  tags: string[];
  disabled: boolean;
  onChange: (tags: string[]) => void;
}>) {
  const [draftInput, setDraftInput] = useState("");

  function commit(rawInput: string, options?: { flushTrailing?: boolean }) {
    const result = commitTagChipInput(tags, rawInput, options);
    const changed =
      result.tags.length !== tags.length ||
      result.tags.some((tag, index) => tag !== tags[index]);
    if (changed) onChange(result.tags);
    setDraftInput(result.remainder);
  }

  return (
    <SettingsField
      label={m.tags_label()}
      htmlFor="articleTagsRail"
      optional={m.optional()}
    >
      <div className={styles.tagInput}>
        {tags.map((tag) => (
          <span key={tag} className={styles.tagChip}>
            {tag}
            <button
              type="button"
              disabled={disabled}
              aria-label={m.remove_tag({ tag })}
              onClick={() =>
                onChange(tags.filter((existing) => existing !== tag))
              }
            >
              <AdminIcon name="close" size={11} strokeWidth={2.4} />
            </button>
          </span>
        ))}
        <input
          className={styles.tagInputField}
          id="articleTagsRail"
          type="text"
          disabled={disabled}
          placeholder={tags.length === 0 ? m.tags_input_placeholder() : ""}
          value={draftInput}
          onChange={(event) => {
            const value = event.target.value;
            if (value.includes(",")) {
              commit(value, { flushTrailing: false });
            } else {
              setDraftInput(value);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit(draftInput);
            } else if (
              event.key === "Backspace" &&
              draftInput === "" &&
              tags.length > 0
            ) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={() => {
            if (draftInput.trim().length > 0) commit(draftInput);
          }}
        />
      </div>
      <p className={`small faint ${styles.previewMeta}`}>{m.tags_hint()}</p>
    </SettingsField>
  );
}

/** Cover preview, alt state, and Replace/Remove backed by the shared picker. */
function CoverField({
  cover,
  disabled,
  issues,
  onChange,
}: Readonly<{
  cover: ArticleCoverUsage | null;
  disabled: boolean;
  issues: string[];
  onChange: (cover: ArticleCoverUsage | null) => void;
}>) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div>
      <h4 className={styles.subheading}>{m.cover_label()}</h4>
      {issues.length > 0 ? (
        <ul className={styles.issueList} role="alert">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      {cover ? (
        <div className={styles.coverBox}>
          <img src={`/media/private/${cover.assetId}`} alt={cover.alt} />
          <div className={styles.coverMeta}>
            <SettingsField
              label={m.cover_alternative_text()}
              htmlFor="articleCoverAltRail"
            >
              <Input
                fullWidth
                id="articleCoverAltRail"
                disabled={disabled}
                value={cover.alt}
                onChange={(event) =>
                  onChange({ ...cover, alt: event.target.value })
                }
              />
            </SettingsField>
            <div className={styles.coverActions}>
              <Button
                size="sm"
                type="button"
                variant="secondary"
                isDisabled={disabled}
                onPress={() => setPickerOpen(true)}
              >
                {m.replace_cover()}
              </Button>
              <Button
                size="sm"
                type="button"
                variant="secondary"
                isDisabled={disabled}
                onPress={() => onChange(null)}
              >
                {m.remove_cover()}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.coverDrop}>
          <p>{m.no_cover_yet_rail()}</p>
          <Button
            size="sm"
            type="button"
            isDisabled={disabled}
            onPress={() => setPickerOpen(true)}
          >
            {m.choose_cover()}
          </Button>
        </div>
      )}
      <CoverPickerDialog
        open={pickerOpen}
        initialAlt={cover?.alt ?? ""}
        onOpenChange={setPickerOpen}
        onConfirm={(next) => {
          onChange(next);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}

/** The shared verified Asset picker, reused for Cover Replace from the rail. */
function CoverPickerDialog({
  open,
  initialAlt,
  onOpenChange,
  onConfirm,
}: Readonly<{
  open: boolean;
  initialAlt: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (cover: ArticleCoverUsage) => void;
}>) {
  const [assets, setAssets] = useState<ReadyAsset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [state, setState] = useState<VerifiedAssetPickerState>("loading");
  const [alt, setAlt] = useState(initialAlt);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    setAlt(initialAlt);
    setSelectedAssetId(null);
    setStatusMessage("");
    setState("loading");
    let active = true;
    void getApiClient()
      .admin.assets.get()
      .then((response) => {
        if (response.status !== 200 || !response.data)
          throw new Error("Assets unavailable");
        if (active) {
          setAssets(
            response.data.assets.filter(
              (
                asset,
              ): asset is Extract<
                AssetLibraryEntry,
                { lifecycleState: "ready" }
              > => asset.lifecycleState === "ready",
            ),
          );
          setState("ready");
        }
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => {
      active = false;
    };
  }, [open, initialAlt]);

  async function uploadFile(file: File) {
    setState("uploading");
    setStatusMessage(m.uploading_and_verifying_image());
    try {
      const response = await getApiClient().admin.assets.post({ file });
      if (response.status !== 201 || !response.data)
        throw new Error("Upload failed");
      setAssets((current) => [response.data, ...current]);
      setSelectedAssetId(response.data.id);
      setStatusMessage(
        m.filename_uploaded_and_selected({
          filename: response.data.originalFilename,
        }),
      );
      setState("uploaded");
    } catch {
      setStatusMessage(m.image_upload_verify_failed());
      setState("error");
    }
  }

  function confirm() {
    const trimmedAlt = alt.trim();
    if (!selectedAssetId || trimmedAlt.length === 0) {
      setStatusMessage(m.select_asset_and_cover_alt());
      return;
    }
    onConfirm({ assetId: selectedAssetId, alt: trimmedAlt });
  }

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog
          aria-label={m.optional_cover()}
          className="editor-tool-modal editor-tool-modal--wide"
        >
          <Modal.Header>
            <div className="briefly-drawer-head">
              <Modal.Heading>{m.optional_cover()}</Modal.Heading>
              <Modal.CloseTrigger aria-label={m.close_insert_image_dialog()} />
            </div>
          </Modal.Header>
          <Modal.Body>
            <div className="editor-tool-panel space-y-4">
              <VerifiedAssetPicker
                assets={assets}
                selectedAssetId={selectedAssetId}
                state={state === "error" ? "ready" : state}
                uploading={state === "uploading"}
                onSelect={(asset) => {
                  setSelectedAssetId(asset.id);
                  setStatusMessage(
                    m.filename_selected({ filename: asset.originalFilename }),
                  );
                }}
                onUpload={uploadFile}
              />
              <SettingsField
                label={m.cover_alternative_text()}
                htmlFor="coverPickerAltRail"
              >
                <Input
                  fullWidth
                  id="coverPickerAltRail"
                  value={alt}
                  onChange={(event) => setAlt(event.target.value)}
                />
              </SettingsField>
              {statusMessage ? (
                <p className="small muted" role="status" aria-live="polite">
                  {statusMessage}
                </p>
              ) : null}
              <div className="editor-tool-actions">
                <Button type="button" onPress={confirm}>
                  {m.use_selected_asset_as_cover()}
                </Button>
              </div>
            </div>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function HistoryPanel({
  workspace,
}: Readonly<{ workspace: ArticleWorkspace }>) {
  const {
    publicationHistory,
    historyState,
    historyHasUnpublishedChanges,
    restoreState,
    restoreIssues,
    serverConfirmed,
    lifecycleActionPending,
  } = workspace;
  const [restoreTarget, setRestoreTarget] =
    useState<ArticlePublicationHistoryEntry | null>(null);

  return (
    <div role="tabpanel" aria-label={m.rail_tab_history()}>
      <section className={`${styles.railSection} ${styles.railSectionFlush}`}>
        <h3>{m.publication_history()}</h3>
        <div className={styles.fieldStack}>
          {historyHasUnpublishedChanges && historyState === "ready" ? (
            <div
              className={`${styles.alert} ${styles.alertWarning}`}
              role="status"
            >
              <AdminIcon name="alert" strokeWidth={2.2} />
              <div>
                <div className={styles.alertTitle}>
                  {m.unpublished_changes()}
                </div>
                <div className={styles.alertBody}>
                  {m.unpublished_changes_description()}
                </div>
              </div>
            </div>
          ) : null}
          <Button
            fullWidth
            type="button"
            variant="secondary"
            isDisabled={!serverConfirmed || lifecycleActionPending}
            isPending={historyState === "loading"}
            onPress={() => void workspace.loadPublicationHistory()}
          >
            {m.load_retained_publications()}
          </Button>
          {historyState === "error" ? (
            <Alert status="danger" role="alert">
              <Alert.Content>
                <Alert.Title>{m.unable_load_publication_history()}</Alert.Title>
                <Alert.Description>
                  {m.unable_load_publication_history_description()}
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : historyState === "ready" && publicationHistory.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>
                <AdminIcon name="history" size={24} />
              </div>
              <h3>{m.no_publications_yet()}</h3>
              <p>{m.no_publications_yet_description()}</p>
            </div>
          ) : null}
          {restoreState === "restored" ? (
            <Alert status="success" role="status">
              <Alert.Content>
                <Alert.Title>{m.publication_restored_into_draft()}</Alert.Title>
                <Alert.Description>
                  {m.publication_restored_into_draft_description()}
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : restoreState === "conflict" ? (
            <Alert status="warning" role="alert">
              <Alert.Content>
                <Alert.Title>{m.draft_changed_before_restore()}</Alert.Title>
                <Alert.Description>
                  {m.draft_changed_before_restore_description()}
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : restoreState === "invalid" ? (
            <Alert status="danger" role="alert">
              <Alert.Content>
                <Alert.Title>
                  {m.publication_cannot_restore_safely()}
                </Alert.Title>
                <Alert.Description>
                  <ul className="list-disc pl-5">
                    {restoreIssues.map((issue) => (
                      <li key={`${issue.code}:${issue.path}`}>
                        {localizeRestorationIssue(issue)}
                      </li>
                    ))}
                  </ul>
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : restoreState === "error" ? (
            <Alert status="danger" role="alert">
              <Alert.Content>
                <Alert.Title>{m.unable_restore_publication()}</Alert.Title>
                <Alert.Description>
                  {m.unable_restore_publication_description()}
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}

          {publicationHistory.length > 0 ? (
            <ol
              aria-label={m.retained_publications()}
              className={styles.issueListReset}
            >
              {publicationHistory.map((publication) => (
                <li
                  key={publication.id}
                  className={`${styles.pubItem}${publication.isCurrent ? ` ${styles.pubItemLive}` : ""}`}
                >
                  <span className={styles.pubNum}>
                    #{publication.publicationNumber}
                  </span>
                  <div className={styles.grow}>
                    <div className={styles.rowGap2}>
                      <strong className="small">{publication.title}</strong>
                      {publication.isCurrent ? (
                        <StatusChip variant="success" dot>
                          {m.live()}
                        </StatusChip>
                      ) : null}
                    </div>
                    <p className="small faint mono">/{publication.slug}</p>
                    <p className={`small faint ${styles.previewMeta}`}>
                      {new Date(publication.publishedAt).toLocaleString()}
                    </p>
                    <div className={`${styles.rowGap2} ${styles.actionTop}`}>
                      <Button
                        size="sm"
                        type="button"
                        variant="secondary"
                        isDisabled={
                          publication.isCurrent ||
                          !serverConfirmed ||
                          lifecycleActionPending
                        }
                        isPending={restoreState === "restoring"}
                        onPress={() => setRestoreTarget(publication)}
                      >
                        {m.restore_publication({
                          number: publication.publicationNumber,
                        })}
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
          <p className={`small faint ${styles.previewMeta}`}>
            {m.restore_replaces_draft_footnote()}
          </p>
        </div>
      </section>

      <AlertDialog.Backdrop
        isOpen={restoreTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRestoreTarget(null);
        }}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>
                {m.restore_publication_question({
                  number: restoreTarget?.publicationNumber ?? "",
                })}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>
                {historyHasUnpublishedChanges
                  ? m.restore_publication_body_with_changes()
                  : m.restore_publication_body()}
              </p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button type="button" variant="secondary" slot="close">
                {m.cancel()}
              </Button>
              <Button
                type="button"
                variant="danger-soft"
                slot="close"
                isDisabled={!serverConfirmed || lifecycleActionPending}
                onPress={() =>
                  restoreTarget &&
                  void workspace.restoreFromHistory(restoreTarget)
                }
              >
                {m.confirm_and_restore_publication()}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </div>
  );
}

/** Saved-Draft preview as an overlay drawer, per the prototype. */
export function PreviewDrawer({
  workspace,
  open,
  onOpenChange,
}: Readonly<{
  workspace: ArticleWorkspace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const { preview, previewState, previewIssues } = workspace;

  return (
    <Drawer.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Drawer.Content
        placement="right"
        className="briefly-drawer-preview"
        aria-label={m.saved_draft_preview()}
      >
        <Drawer.Dialog aria-label={m.saved_draft_preview()}>
          <Drawer.Header>
            <div className="briefly-drawer-head">
              <div>
                <Drawer.Heading>
                  <strong>{m.draft_preview()}</strong>
                </Drawer.Heading>
                <p className={`small faint ${styles.previewMeta}`}>
                  {m.draft_preview_description()}
                </p>
              </div>
              <Drawer.CloseTrigger aria-label={m.close_preview()} />
            </div>
          </Drawer.Header>
          <Drawer.Body className={styles.previewBody}>
            {previewState === "loading" || previewState === "idle" ? (
              <div className={styles.row} role="status">
                <Spinner aria-label={m.loading_saved_draft_preview()} />
                <span className="small muted">
                  {m.rendering_saved_draft_preview()}
                </span>
              </div>
            ) : previewState === "conflict" ? (
              <Alert status="warning" role="alert">
                <Alert.Content>
                  <Alert.Title>{m.saved_draft_version_changed()}</Alert.Title>
                  <Alert.Description>
                    {m.saved_draft_version_changed_description()}
                  </Alert.Description>
                </Alert.Content>
              </Alert>
            ) : previewState === "invalid" ? (
              <Alert status="danger" role="alert">
                <Alert.Content>
                  <Alert.Title>{m.saved_draft_cannot_preview()}</Alert.Title>
                  <Alert.Description>
                    <ul className="list-disc pl-5">
                      {previewIssues.map((issue) => (
                        <li key={`${issue.code}:${issue.path}`}>
                          {localizePublicationIssue(issue)}
                        </li>
                      ))}
                    </ul>
                  </Alert.Description>
                </Alert.Content>
              </Alert>
            ) : previewState === "error" ? (
              <Alert status="danger" role="alert">
                <Alert.Content>
                  <Alert.Title>
                    {m.unable_load_saved_draft_preview()}
                  </Alert.Title>
                  <Alert.Description>
                    {m.please_try_again()}
                  </Alert.Description>
                </Alert.Content>
              </Alert>
            ) : preview ? (
              <div className={styles.stack}>
                <p className="small muted" role="status">
                  {m.showing_saved_draft_preview({
                    draftVersion: preview.draftVersion,
                    rendererVersion: preview.rendererVersion,
                  })}
                </p>
                <article
                  className={`doc ${styles.card} ${styles.cardPad}`}
                  lang={preview.metadata.language}
                  aria-labelledby="saved-draft-preview-title"
                >
                  <header>
                    <h2
                      id="saved-draft-preview-title"
                      className={styles.previewTitle}
                    >
                      {preview.metadata.title}
                    </h2>
                    <p className="small muted">
                      {m.byline_by({ name: preview.metadata.byline.name })} ·{" "}
                      {preview.metadata.language}
                    </p>
                  </header>
                  <div dangerouslySetInnerHTML={{ __html: preview.html }} />
                </article>
              </div>
            ) : null}
          </Drawer.Body>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}
