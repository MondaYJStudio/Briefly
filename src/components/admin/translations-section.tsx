import { Button, Input, ListBox, Modal, Select } from "@heroui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Article } from "../../articles/articles";
import {
  translationLanguageKey,
  type ArticleTranslation,
} from "../../articles/translation-groups";
import {
  createAdminArticleTranslation,
  linkAdminArticleTranslation,
  listAdminArticleTranslations,
  listAdminTranslationCandidates,
  unlinkAdminArticleTranslation,
} from "../../articles/translations-client";
import { APP_LOCALE_OPTIONS } from "../../locales/registry";
import { m } from "../../paraglide/messages.js";
import editorStyles from "./editor-view.module.css";
import { SettingsField } from "./fields";
import { AdminIcon } from "./icons";
import { LifecycleChip } from "./status-chip";
import styles from "./translations-section.module.css";

type LoadState = "loading" | "ready" | "error";

/**
 * The open Article's Translation Group in the editor rail: the other members,
 * linking an existing Article, starting a translation from the saved Draft,
 * and leaving or shrinking the group. Membership is not Draft content, so it
 * never waits for or disturbs auto-save.
 */
export function TranslationsSection({
  articleId,
  language,
  disabled,
  canCreate,
  onOpenArticle,
  onCreated,
}: Readonly<{
  articleId: string;
  /** The open Article's effective Draft language. */
  language: string | null;
  disabled: boolean;
  /** Whether the saved Draft matches the editor, so a copy is current. */
  canCreate: boolean;
  onOpenArticle: (articleId: string) => void;
  /** A translation was created; the caller opens it. */
  onCreated: (article: Article) => void;
}>) {
  const [state, setState] = useState<LoadState>("loading");
  const [translations, setTranslations] = useState<ArticleTranslation[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setState("loading");
    const listed = await listAdminArticleTranslations(articleId);
    if (generation !== loadGeneration.current) return;
    if (listed) {
      setTranslations(listed);
      setState("ready");
    } else {
      setState("error");
    }
  }, [articleId]);

  useEffect(() => {
    setFeedback(null);
    void load();
  }, [load]);

  const usedLanguageKeys = useMemo(
    () =>
      new Set(
        [language, ...translations.map((translation) => translation.language)]
          .filter((tag): tag is string => tag !== null)
          .map(translationLanguageKey),
      ),
    [language, translations],
  );

  async function unlink(memberId: string) {
    setFeedback(null);
    setPendingId(memberId);
    const unlinked = await unlinkAdminArticleTranslation(memberId);
    setPendingId(null);
    if (!unlinked) {
      setFeedback(m.translations_unlink_failed());
      return;
    }
    await load();
    // The pressed control is gone; keep keyboard focus inside the section.
    headingRef.current?.focus();
  }

  const busy = disabled || pendingId !== null;

  return (
    <section
      className={`${editorStyles.railSection} py-5 px-4`}
      aria-labelledby="article-translations-heading"
    >
      <h3
        ref={headingRef}
        id="article-translations-heading"
        tabIndex={-1}
        className={`${editorStyles.railSectionHeading} text-xs mb-4`}
      >
        {m.translations_heading()}
      </h3>
      <div className="flex flex-col gap-4">
        {state === "loading" ? (
          <p className="text-xs muted" role="status">
            {m.translations_loading()}
          </p>
        ) : state === "error" ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={`${styles.feedback} text-xs`} role="alert">
              {m.translations_load_failed()}
            </p>
            <Button
              size="sm"
              type="button"
              variant="secondary"
              onPress={() => void load()}
            >
              {m.retry()}
            </Button>
          </div>
        ) : translations.length === 0 ? (
          <p className="text-xs muted">{m.translations_empty()}</p>
        ) : (
          <ul className={styles.list} aria-label={m.translations_heading()}>
            {translations.map((translation) => {
              const title = translation.title || m.untitled_article();
              return (
                <li
                  key={translation.id}
                  className={`${styles.item} flex items-start justify-between gap-2 py-2`}
                >
                  <div className="min-w-0 flex flex-col gap-1">
                    <button
                      type="button"
                      className={`${styles.open} text-sm`}
                      onClick={() => onOpenArticle(translation.id)}
                    >
                      {title}
                    </button>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="mono text-xs muted">
                        {translation.language}
                      </span>
                      <LifecycleChip
                        projection={translation.lifecycleProjection}
                      />
                    </div>
                  </div>
                  <Button
                    isIconOnly
                    size="sm"
                    type="button"
                    variant="ghost"
                    aria-label={m.translations_remove({ title })}
                    isDisabled={busy}
                    isPending={pendingId === translation.id}
                    onPress={() => void unlink(translation.id)}
                  >
                    <AdminIcon name="close" size={14} />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {feedback ? (
          <p className={`${styles.feedback} text-xs`} role="alert">
            {feedback}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            type="button"
            variant="secondary"
            isDisabled={busy || state !== "ready"}
            onPress={() => setLinkOpen(true)}
          >
            <AdminIcon name="link" size={14} />
            {m.translations_link()}
          </Button>
          <Button
            size="sm"
            type="button"
            variant="secondary"
            isDisabled={busy || state !== "ready" || !canCreate}
            onPress={() => setCreateOpen(true)}
          >
            <AdminIcon name="plus" size={14} />
            {m.translations_create()}
          </Button>
        </div>
        {!canCreate ? (
          <p className="text-xs faint">{m.translations_create_needs_save()}</p>
        ) : null}
        {state === "ready" && translations.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs faint">{m.translations_public_note()}</p>
            <div>
              <Button
                size="sm"
                type="button"
                variant="ghost"
                isDisabled={busy}
                isPending={pendingId === articleId}
                onPress={() => void unlink(articleId)}
              >
                {m.translations_leave()}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      <LinkTranslationDialog
        articleId={articleId}
        open={linkOpen}
        onOpenChange={setLinkOpen}
        onLinked={(next) => {
          setFeedback(null);
          setTranslations(next);
          setState("ready");
          setLinkOpen(false);
        }}
      />
      <CreateTranslationDialog
        articleId={articleId}
        open={createOpen}
        usedLanguageKeys={usedLanguageKeys}
        onOpenChange={setCreateOpen}
        onCreated={(article) => {
          setCreateOpen(false);
          onCreated(article);
        }}
      />
    </section>
  );
}

function LinkTranslationDialog({
  articleId,
  open,
  onOpenChange,
  onLinked,
}: Readonly<{
  articleId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked: (translations: ArticleTranslation[]) => void;
}>) {
  const [state, setState] = useState<LoadState>("loading");
  const [candidates, setCandidates] = useState<ArticleTranslation[]>([]);
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setQuery("");
    setFeedback(null);
    setState("loading");
    void listAdminTranslationCandidates(articleId).then((listed) => {
      if (!active) return;
      if (listed) {
        setCandidates(listed);
        setState("ready");
      } else {
        setState("error");
      }
    });
    return () => {
      active = false;
    };
  }, [articleId, open]);

  const needle = query.trim().toLocaleLowerCase();
  const visible = needle
    ? candidates.filter((candidate) =>
        candidate.title.toLocaleLowerCase().includes(needle),
      )
    : candidates;

  async function link(candidate: ArticleTranslation) {
    setFeedback(null);
    setPendingId(candidate.id);
    const result = await linkAdminArticleTranslation(articleId, candidate.id);
    setPendingId(null);
    if (result.ok) {
      onLinked(result.translations);
      return;
    }
    switch (result.reason) {
      case "already-linked":
        setFeedback(m.translations_already_linked());
        break;
      case "language-taken":
        setFeedback(m.translations_public_language_taken());
        break;
      case "not-found":
        setFeedback(m.translations_not_found());
        break;
      case "error":
        setFeedback(m.translations_failed());
        break;
    }
  }

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog
          aria-label={m.translations_link_title()}
          className="editor-tool-modal"
        >
          <Modal.Header>
            <div className="briefly-drawer-head flex items-center justify-between gap-3 w-full">
              <Modal.Heading>{m.translations_link_title()}</Modal.Heading>
              <Modal.CloseTrigger aria-label={m.translations_close_dialog()} />
            </div>
          </Modal.Header>
          <Modal.Body>
            <div className="editor-tool-panel space-y-4">
              <p className="text-xs muted">
                {m.translations_link_description()}
              </p>
              <SettingsField
                label={m.translations_search_label()}
                htmlFor="translationCandidateSearch"
              >
                <Input
                  fullWidth
                  id="translationCandidateSearch"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </SettingsField>
              {state === "loading" ? (
                <p className="text-xs muted" role="status">
                  {m.translations_candidates_loading()}
                </p>
              ) : state === "error" ? (
                <p className={`${styles.feedback} text-xs`} role="alert">
                  {m.translations_candidates_failed()}
                </p>
              ) : visible.length === 0 ? (
                <p className="text-xs muted" role="status">
                  {candidates.length === 0
                    ? m.translations_candidates_empty()
                    : m.translations_candidates_no_match()}
                </p>
              ) : (
                <ul
                  className={styles.candidates}
                  aria-label={m.translations_link_title()}
                >
                  {visible.map((candidate) => {
                    const title = candidate.title || m.untitled_article();
                    return (
                      <li key={candidate.id}>
                        <button
                          type="button"
                          className={`${styles.candidate} flex items-center justify-between gap-3 py-2 px-3`}
                          aria-label={m.translations_link_item({
                            title,
                            language: candidate.language,
                          })}
                          disabled={pendingId !== null}
                          onClick={() => void link(candidate)}
                        >
                          <span className="min-w-0 text-sm">{title}</span>
                          <span className="flex flex-none items-center gap-2">
                            <span className="mono text-xs muted">
                              {candidate.language}
                            </span>
                            <LifecycleChip
                              projection={candidate.lifecycleProjection}
                            />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {feedback ? (
                <p className={`${styles.feedback} text-xs`} role="alert">
                  {feedback}
                </p>
              ) : null}
            </div>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function CreateTranslationDialog({
  articleId,
  open,
  usedLanguageKeys,
  onOpenChange,
  onCreated,
}: Readonly<{
  articleId: string;
  open: boolean;
  usedLanguageKeys: ReadonlySet<string>;
  onOpenChange: (open: boolean) => void;
  onCreated: (article: Article) => void;
}>) {
  const available = APP_LOCALE_OPTIONS.filter(
    (option) => !usedLanguageKeys.has(translationLanguageKey(option.id)),
  );
  const [language, setLanguage] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFeedback(null);
    setLanguage(null);
  }, [open]);

  async function create() {
    if (!language) return;
    setFeedback(null);
    setPending(true);
    const result = await createAdminArticleTranslation(articleId, language);
    setPending(false);
    if (result.ok) {
      onCreated(result.article);
      return;
    }
    switch (result.reason) {
      case "language-taken":
        setFeedback(m.translations_draft_language_taken());
        break;
      case "not-found":
        setFeedback(m.translations_not_found());
        break;
      case "error":
        setFeedback(m.translations_failed());
        break;
    }
  }

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog
          aria-label={m.translations_create_title()}
          className="editor-tool-modal"
        >
          <Modal.Header>
            <div className="briefly-drawer-head flex items-center justify-between gap-3 w-full">
              <Modal.Heading>{m.translations_create_title()}</Modal.Heading>
              <Modal.CloseTrigger aria-label={m.translations_close_dialog()} />
            </div>
          </Modal.Header>
          <Modal.Body>
            <div className="editor-tool-panel space-y-4">
              <p className="text-xs muted">
                {m.translations_create_description()}
              </p>
              {available.length === 0 ? (
                <p className="text-xs muted" role="status">
                  {m.translations_no_languages()}
                </p>
              ) : (
                <SettingsField
                  label={m.translations_language_label()}
                  htmlFor="translationLanguage"
                >
                  <Select
                    fullWidth
                    id="translationLanguage"
                    aria-label={m.translations_language_label()}
                    selectedKey={language ?? undefined}
                    onSelectionChange={(key) =>
                      setLanguage(key === null ? null : String(key))
                    }
                  >
                    <Select.Trigger className="briefly-language-trigger flex items-center">
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox aria-label={m.translations_language_label()}>
                        {available.map((option) => (
                          <ListBox.Item
                            key={option.id}
                            id={option.id}
                            className="briefly-language-option flex w-full items-center justify-between gap-4"
                            textValue={`${option.label} (${option.detail})`}
                          >
                            <span>{option.label}</span>
                            <span className="briefly-select-detail text-xs">
                              {option.detail}
                            </span>
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                </SettingsField>
              )}
              {feedback ? (
                <p className={`${styles.feedback} text-xs`} role="alert">
                  {feedback}
                </p>
              ) : null}
              <div className="editor-tool-actions flex justify-end flex-wrap gap-2 max-[860px]:flex-col-reverse max-[860px]:[&>*]:w-full">
                <Button
                  type="button"
                  variant="secondary"
                  onPress={() => onOpenChange(false)}
                >
                  {m.cancel()}
                </Button>
                <Button
                  type="button"
                  isDisabled={language === null}
                  isPending={pending}
                  onPress={() => void create()}
                >
                  {m.translations_create_submit()}
                </Button>
              </div>
            </div>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
