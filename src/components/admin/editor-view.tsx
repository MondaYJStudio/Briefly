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
import { slugAfterManualEdit, slugAfterReset } from "../../articles/slug-follow";
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
    <div className="card card-pad" role="status">
      Loading the text-rich editor…
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
    <main className="editor-main" id="admin-main">
      {/* ===== Top bar ===== */}
      <header className="editor-topbar">
        <Button
          isIconOnly
          size="sm"
          type="button"
          variant="ghost"
          aria-label="Back to Articles"
          isDisabled={lifecycleActionPending}
          onPress={onBack}
        >
          <AdminIcon name="back" size={18} />
        </Button>
        <div className="title-wrap">
          <span className="doc-title">
            {selected.draft.title || "Untitled Article"}
          </span>
          <span className="hide-m">
            {workspace.hasUnsavedChanges ||
            (hasCurrentPublication &&
              workspace.historyHasUnpublishedChanges) ? (
              <StatusChip variant="warning" icon="alert">
                Changes pending
              </StatusChip>
            ) : checkingPublicationState ? (
              <StatusChip variant="default" icon="clock">
                Checking live state
              </StatusChip>
            ) : hasCurrentPublication ? (
              <StatusChip variant="success" dot>
                Published
              </StatusChip>
            ) : (
              <StatusChip variant="default" dot>
                Draft
              </StatusChip>
            )}
          </span>
        </div>
        <EditorSaveState workspace={workspace} />
        <Button
          className="hide-m"
          size="sm"
          type="button"
          variant="outline"
          isDisabled={lifecycleActionPending}
          onPress={openPreview}
        >
          Preview
        </Button>
        <Button
          size="sm"
          type="button"
          isDisabled={workspace.publishActionDisabled}
          isPending={workspace.publishState === "publishing"}
          onPress={() => setPublishDialogOpen(true)}
        >
          {hasCurrentPublication ? "Republish" : "Publish"}
        </Button>
        <Dropdown.Root>
          <Dropdown.Trigger
            aria-label="More article actions"
            style={{
              width: "2rem",
              height: "2rem",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "var(--radius-s)",
              background: "none",
              border: 0,
              cursor: "pointer",
              color: "var(--foreground-muted)",
            }}
          >
            <AdminIcon name="more" size={18} />
          </Dropdown.Trigger>
          <Dropdown.Popover placement="bottom end">
            <Dropdown.Menu
              aria-label="More article actions"
              onAction={(key) => {
                if (key === "save") void workspace.persistCurrentDraft();
                else if (key === "preview") openPreview();
                else if (key === "unpublish") setUnpublishDialogOpen(true);
                else if (key === "trash") setTrashDialogOpen(true);
              }}
            >
              <Dropdown.Item
                id="save"
                textValue="Save now"
                isDisabled={lifecycleActionPending || state === "saving"}
              >
                Save now
              </Dropdown.Item>
              <Dropdown.Item id="preview" textValue="Preview saved Draft">
                Preview saved Draft
              </Dropdown.Item>
              <Separator />
              <Dropdown.Item
                id="unpublish"
                textValue="Unpublish"
                isDisabled={workspace.unpublishActionDisabled}
              >
                Unpublish…
              </Dropdown.Item>
              <Dropdown.Item
                id="trash"
                textValue="Move to Trash"
                className="text-danger"
                isDisabled={workspace.trashActionDisabled}
              >
                Move to Trash…
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
          aria-label="Open article settings"
          aria-controls="article-settings-rail"
          aria-expanded={railOpen}
          onPress={() => setRailOpen(true)}
        >
          <AdminIcon name="panel" size={18} />
        </Button>
      </header>

      {/* ===== Body: canvas + rail ===== */}
      <div className="editor-body">
        <div className="editor-scroll" id="canvas">
          <div className="editor-canvas">
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
                style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
              >
                {workspace.restoreState === "restoring" ? (
                  <p className="small muted editor-pending-state" role="status">
                    Restoring Publication… Draft editing is temporarily paused.
                  </p>
                ) : workspace.trashActionState === "trashing" ? (
                  <p className="small muted editor-pending-state" role="status">
                    Moving Article to Trash… Draft editing is temporarily
                    paused.
                  </p>
                ) : workspace.trashActionState === "restoring" ? (
                  <p className="small muted editor-pending-state" role="status">
                    Restoring Article from Trash… Draft editing is temporarily
                    paused.
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
                  ? "Republish saved Draft?"
                  : "Publish saved Draft?"}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              {hasCurrentPublication ? (
                <p>
                  Republish saved Draft Version {selected.draft.version} as a
                  new immutable Publication. Earlier Publications remain
                  unchanged, and the Current Publication switches only after the
                  new public read is available.
                </p>
              ) : (
                <p>
                  Publish saved Draft Version {selected.draft.version} as a new
                  immutable Publication. It will be immediately public after the
                  Current Publication switches.
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
                isDisabled={workspace.publishActionDisabled}
                onPress={() => void workspace.publishDraft()}
              >
                {hasCurrentPublication
                  ? "Republish saved Draft"
                  : "Publish saved Draft"}
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
              <AlertDialog.Heading>Unpublish this Article?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>
                Unpublish is reversible. It immediately removes the Current
                Publication from the public list and makes public detail GET and
                HEAD return 404. Draft and Publication history remain intact, so
                you can edit and publish a new immutable Publication later. This
                is not Trash or permanent purge, and previously published media
                remains public.
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
                isDisabled={workspace.unpublishActionDisabled}
                onPress={() => void workspace.unpublishCurrentPublication()}
              >
                Unpublish Article
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
                Move this Article to Trash?
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>
                Move {selected.draft.title || "this Article"} to Trash? This
                reversible action removes it from normal administration and
                public Article list and detail endpoints immediately. If it is
                public, its Current Publication is cleared. Its Draft, retained
                Publications, slug claims, and Asset references stay intact.
                Restoring it leaves it unpublished. This is not permanent purge,
                and previously published media remains public.
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
                isDisabled={workspace.trashActionDisabled}
                onPress={() => void workspace.moveSelectedArticleToTrash()}
              >
                Move Article to Trash
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
  let text = `Saved · Draft v${selected?.draft.version ?? 0}`;
  let compactText = "Saved";
  if (state === "saving") {
    tone = "";
    text = "Saving…";
    compactText = text;
    icon = <Spinner aria-hidden="true" style={{ width: 12, height: 12 }} />;
  } else if (state === "dirty") {
    tone = "";
    text = "Unsaved changes";
    compactText = "Unsaved";
    icon = <AdminIcon name="clock" size={14} strokeWidth={2.2} />;
  } else if (state === "failed") {
    tone = "is-error";
    text = "Save failed";
    compactText = "Failed";
    icon = <AdminIcon name="alert" size={14} strokeWidth={2.2} />;
  } else if (state === "offline") {
    tone = "is-warn";
    text = "Offline";
    compactText = text;
    icon = <AdminIcon name="offline" size={14} strokeWidth={2.2} />;
  } else if (state === "conflict") {
    tone = "is-warn";
    text = "Conflict";
    compactText = text;
    icon = <AdminIcon name="conflict" size={14} strokeWidth={2.2} />;
  } else if (state === "invalid") {
    tone = "is-error";
    text = "Invalid";
    compactText = text;
    icon = <AdminIcon name="alert" size={14} strokeWidth={2.2} />;
  } else if (state === "slug-conflict") {
    tone = "is-warn";
    text = "Slug taken";
    compactText = text;
    icon = <AdminIcon name="alert" size={14} strokeWidth={2.2} />;
  } else if (!serverConfirmed) {
    tone = "";
    text = "Not confirmed";
    compactText = "Pending";
    icon = <AdminIcon name="clock" size={14} strokeWidth={2.2} />;
  }
  return (
    <span className={`save-state${tone ? ` ${tone}` : ""}`} role="status">
      {icon}
      <span className="save-state-full">{text}</span>
      <span className="save-state-compact">{compactText}</span>
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
      (issue) => issue.message,
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
      <div className={`${styles.railTabs} row-between`}>
        <div
          className={styles.tabsLineList}
          role="tablist"
          aria-label={m.rail_settings_sections()}
          style={{ borderBottom: 0 }}
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
            <h3>Publish</h3>
            <div className="field-stack">
              <div className="row" style={{ gap: "var(--space-2)" }}>
                {changesPending ? (
                  <StatusChip variant="warning" icon="alert">
                    Changes pending
                  </StatusChip>
                ) : checkingPublicationState ? (
                  <StatusChip variant="default" icon="clock">
                    Checking live state
                  </StatusChip>
                ) : hasCurrentPublication ? (
                  <StatusChip variant="success" dot>
                    Published
                  </StatusChip>
                ) : (
                  <StatusChip variant="default" dot>
                    Draft
                  </StatusChip>
                )}
                <span className="small muted">
                  {changesPending
                    ? "The Draft is ahead; live content is unchanged."
                    : checkingPublicationState
                      ? "Loading the Current Publication details."
                      : hasCurrentPublication
                        ? "Live from its Current Publication."
                        : "Not public — nothing is live yet."}
                </span>
              </div>
              <dl className={styles.pubDetail}>
                <dt>Draft</dt>
                <dd>
                  v{selected.draft.version}
                  {serverConfirmed ? " · saved" : " · not server-confirmed"}
                </dd>
                <dt>Live</dt>
                <dd>
                  {currentPublication
                    ? `Publication #${currentPublication.publicationNumber} · ${new Date(
                        currentPublication.publishedAt,
                      ).toLocaleDateString()}`
                    : checkingPublicationState
                      ? "Loading…"
                      : hasCurrentPublication
                        ? "Current Publication selected"
                        : "None"}
                </dd>
                <dt>Public slug</dt>
                <dd className="mono">
                  {currentPublication ? `/${currentPublication.slug}` : "—"}
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
                Preview saved Draft Version {selected.draft.version}
              </Button>
              <Button
                fullWidth
                type="button"
                isDisabled={workspace.publishActionDisabled}
                isPending={workspace.publishState === "publishing"}
                onPress={onOpenPublishDialog}
              >
                {hasCurrentPublication
                  ? "Republish saved Draft"
                  : "Publish saved Draft"}
              </Button>
              <p className="small faint">
                Publishing is available only for a server-confirmed Draft
                Version. Republishing creates a new immutable Publication;
                earlier history is preserved.
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
              <div className="field-stack">
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
              <div className="field-stack">
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
                  optional="optional"
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
      optional="optional"
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
      <p className="small faint">{m.tags_hint()}</p>
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
        <h3>Publication history</h3>
        <div className="field-stack">
          {historyHasUnpublishedChanges && historyState === "ready" ? (
            <div className="alert alert-warning" role="status">
              <AdminIcon name="alert" strokeWidth={2.2} />
              <div>
                <div className="alert-title">Unpublished changes</div>
                <div className="alert-body">
                  The Draft is ahead of the Current Publication.
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
            Load retained Publications
          </Button>
          {historyState === "error" ? (
            <Alert status="danger" role="alert">
              <Alert.Content>
                <Alert.Title>Unable to load Publication History</Alert.Title>
                <Alert.Description>
                  Please reload the history.
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : historyState === "ready" && publicationHistory.length === 0 ? (
            <div
              className="empty"
              style={{ padding: "var(--space-8) var(--space-4)" }}
            >
              <div className="empty-icon">
                <AdminIcon name="history" size={24} />
              </div>
              <h3>No Publications yet</h3>
              <p>This Article has no retained Publications yet.</p>
            </div>
          ) : null}
          {restoreState === "restored" ? (
            <Alert status="success" role="status">
              <Alert.Content>
                <Alert.Title>Publication restored into the Draft</Alert.Title>
                <Alert.Description>
                  Draft Version advanced. Preview it privately, then publish
                  only when it is ready to replace the Current Publication.
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
                      <li key={`${issue.code}:${issue.path}`}>
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
            <ol
              aria-label="Retained Publications"
              style={{ listStyle: "none", margin: 0, padding: 0 }}
            >
              {publicationHistory.map((publication) => (
                <li
                  key={publication.id}
                  className={`${styles.pubItem}${publication.isCurrent ? ` ${styles.pubItemLive}` : ""}`}
                >
                  <span className={styles.pubNum}>
                    #{publication.publicationNumber}
                  </span>
                  <div className="grow">
                    <div className="row" style={{ gap: "var(--space-2)" }}>
                      <strong className="small">{publication.title}</strong>
                      {publication.isCurrent ? (
                        <StatusChip variant="success" dot>
                          Live
                        </StatusChip>
                      ) : null}
                    </div>
                    <p className="small faint mono">/{publication.slug}</p>
                    <p className="small faint">
                      {new Date(publication.publishedAt).toLocaleString()}
                    </p>
                    <div className="row mt-2" style={{ gap: "var(--space-2)" }}>
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
                        Restore Publication {publication.publicationNumber}
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
          <p className="small faint">
            Restoring permanently replaces the current Draft with a new Draft
            Version; the public Current Publication stays unchanged until you
            republish deliberately.
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
                Restore Publication {restoreTarget?.publicationNumber}?
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>
                {historyHasUnpublishedChanges
                  ? "This Article has unpublished Draft changes. Restoring this immutable source permanently replaces them with a new Draft Version."
                  : "Restoring this immutable source replaces the current Draft with a new Draft Version."}{" "}
                The selected Publication, Current Publication, public
                timestamps, and anonymous output remain unchanged.
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
                isDisabled={!serverConfirmed || lifecycleActionPending}
                onPress={() =>
                  restoreTarget &&
                  void workspace.restoreFromHistory(restoreTarget)
                }
              >
                Confirm and restore Publication
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
        aria-label="Saved Draft Preview"
      >
        <Drawer.Dialog aria-label="Saved Draft Preview">
          <Drawer.Header>
            <div className="briefly-drawer-head">
              <div>
                <Drawer.Heading>
                  <strong>Draft preview</strong>
                </Drawer.Heading>
                <p className="small faint" style={{ marginTop: 2 }}>
                  Renders the server-confirmed Draft only — never unsaved
                  keystrokes.
                </p>
              </div>
              <Drawer.CloseTrigger aria-label="Close preview" />
            </div>
          </Drawer.Header>
          <Drawer.Body style={{ padding: "var(--space-5)" }}>
            {previewState === "loading" || previewState === "idle" ? (
              <div className="row" role="status">
                <Spinner aria-label="Loading saved Draft preview" />
                <span className="small muted">
                  Rendering saved Draft preview…
                </span>
              </div>
            ) : previewState === "conflict" ? (
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
            ) : preview ? (
              <div className="stack">
                <p className="small muted" role="status">
                  Showing saved Draft Version {preview.draftVersion} with
                  Renderer Version {preview.rendererVersion}.
                </p>
                <article
                  className="doc card card-pad"
                  lang={preview.metadata.language}
                  aria-labelledby="saved-draft-preview-title"
                >
                  <header>
                    <h2
                      id="saved-draft-preview-title"
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontSize: "1.8rem",
                        fontWeight: 700,
                        letterSpacing: "-0.015em",
                      }}
                    >
                      {preview.metadata.title}
                    </h2>
                    <p className="small muted">
                      By {preview.metadata.byline.name} ·{" "}
                      {preview.metadata.language}
                    </p>
                  </header>
                  {preview.coverHtml ? (
                    <div
                      dangerouslySetInnerHTML={{ __html: preview.coverHtml }}
                    />
                  ) : null}
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
