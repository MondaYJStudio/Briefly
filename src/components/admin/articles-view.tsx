import { Alert, Button, Dropdown, Tooltip } from "@heroui/react";
import { useMemo, useState } from "react";

import type {
  Article,
  ArticleLifecycleProjection,
} from "../../articles/articles";
import { m } from "../../paraglide/messages.js";
import { AdminIcon } from "./icons";
import styles from "./articles-view.module.css";
import { StatusChip } from "./status-chip";
import {
  articleLifecycleProjection,
  type ArticleWorkspace,
} from "./use-article-workspace";

type ArticleFilter = "all" | ArticleLifecycleProjection;

function articleVisible(article: Article, filter: ArticleFilter): boolean {
  if (filter === "all") return true;
  return articleLifecycleProjection(article) === filter;
}

function lifecycleChip(projection: ArticleLifecycleProjection) {
  switch (projection) {
    case "published":
      return (
        <StatusChip variant="success" dot>
          {m.lifecycle_published()}
        </StatusChip>
      );
    case "changes-pending":
      return (
        <StatusChip variant="warning" dot>
          {m.lifecycle_changes_pending()}
        </StatusChip>
      );
    case "unpublished":
      return (
        <StatusChip variant="default" dot>
          {m.lifecycle_unpublished()}
        </StatusChip>
      );
    case "draft":
      return (
        <StatusChip variant="default" dot>
          {m.lifecycle_draft()}
        </StatusChip>
      );
  }
}

/**
 * Articles index: page head, lifecycle filter tabs, future-search marker and
 * article rows with cover, lifecycle chip, metadata and a per-row action menu.
 */
export function ArticlesView({
  workspace,
  onCreate,
  onOpen,
  onPreview,
}: Readonly<{
  workspace: ArticleWorkspace;
  onCreate: () => void;
  onOpen: (article: Article) => void;
  onPreview: (article: Article) => void;
}>) {
  const {
    articles,
    state,
    selected,
    articleSelectionDisabled,
    listError,
    createError,
    listActionPendingId,
    reloadArticles,
    publishListedArticle,
    unpublishListedArticle,
    moveListedArticleToTrash,
  } = workspace;
  const [filter, setFilter] = useState<ArticleFilter>("all");

  const counts = useMemo(() => {
    const next = {
      all: articles.length,
      draft: 0,
      published: 0,
      "changes-pending": 0,
      unpublished: 0,
    };
    for (const article of articles) {
      next[articleLifecycleProjection(article)] += 1;
    }
    return next;
  }, [articles]);
  const visible = articles.filter((article) => articleVisible(article, filter));
  const creating = state === "creating";
  const loadingEmpty = state === "loading" && articles.length === 0;
  const failedEmpty = state === "failed" && articles.length === 0;

  return (
    <main className={styles.page} id="admin-main">
      <header className={styles.pageHead}>
        <div>
          <h1 className={styles.pageTitle}>{m.articles()}</h1>
          <p className={styles.pageDesc}>{m.articles_page_description()}</p>
        </div>
        <div className={styles.pageActions}>
          <Button
            type="button"
            aria-label={m.create_article_draft()}
            isPending={creating}
            isDisabled={articleSelectionDisabled || loadingEmpty || creating}
            onPress={onCreate}
          >
            <AdminIcon name="plus" size={16} />
            {m.new_article()}
          </Button>
        </div>
      </header>

      {listError && articles.length > 0 ? (
        <Alert status="danger" role="alert" className={styles.feedback}>
          <Alert.Content>
            <Alert.Title>{m.articles_load_failed()}</Alert.Title>
            <Alert.Description>
              {m.articles_load_failed_description()}
            </Alert.Description>
          </Alert.Content>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label={m.reload_articles()}
            onPress={() => void reloadArticles({ soft: true })}
          >
            {m.retry()}
          </Button>
        </Alert>
      ) : null}

      {createError ? (
        <Alert status="danger" role="alert" className={styles.feedback}>
          <Alert.Content>
            <Alert.Title>{m.articles_create_failed()}</Alert.Title>
            <Alert.Description>
              {m.articles_create_failed_description()}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {loadingEmpty ? (
        <ArticleListSkeleton />
      ) : failedEmpty ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>{m.articles_load_failed()}</Alert.Title>
            <Alert.Description>
              {m.articles_load_failed_description()}
            </Alert.Description>
          </Alert.Content>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label={m.reload_articles()}
            onPress={() => void reloadArticles()}
          >
            {m.retry()}
          </Button>
        </Alert>
      ) : articles.length === 0 ? (
        <div className={styles.card}>
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>
              <AdminIcon name="articles" size={24} />
            </div>
            <h3>{m.articles_empty_title()}</h3>
            <p>{m.articles_empty_description()}</p>
            <div className={styles.emptyActions}>
              <Button
                type="button"
                isPending={creating}
                isDisabled={articleSelectionDisabled || creating}
                onPress={onCreate}
              >
                {m.write_first_article()}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.toolbar}>
            <div
              className={styles.tabs}
              role="tablist"
              aria-label={m.filter_by_lifecycle()}
            >
              {(
                [
                  ["all", m.filter_all(), counts.all],
                  ["published", m.lifecycle_published(), counts.published],
                  [
                    "unpublished",
                    m.lifecycle_unpublished(),
                    counts.unpublished,
                  ],
                  [
                    "changes-pending",
                    m.lifecycle_changes_pending(),
                    counts["changes-pending"],
                  ],
                ] as const
              ).map(([id, label, count]) => (
                <button
                  key={id}
                  className={styles.tab}
                  type="button"
                  role="tab"
                  aria-selected={filter === id}
                  aria-controls="article-panel"
                  onClick={() => setFilter(id)}
                >
                  {label} <span className={styles.count}>{count}</span>
                </button>
              ))}
            </div>
            <Tooltip.Root delay={500}>
              <Tooltip.Trigger
                className={styles.searchMarker}
                aria-label={m.search_articles_future()}
              >
                <AdminIcon
                  name="search"
                  size={16}
                  className={styles.searchIcon}
                />
                <input
                  className={styles.searchInput}
                  type="search"
                  placeholder={m.search_articles_placeholder()}
                  disabled
                  aria-disabled="true"
                />
              </Tooltip.Trigger>
              <Tooltip.Content>{m.search_articles_future()}</Tooltip.Content>
            </Tooltip.Root>
          </div>

          <div
            className={styles.card}
            role="tabpanel"
            id="article-panel"
            aria-label={m.article_drafts_panel()}
          >
            <ul className={styles.list}>
              {visible.map((article) => (
                <ArticleRow
                  key={article.id}
                  article={article}
                  isSelected={selected?.id === article.id}
                  disabled={
                    articleSelectionDisabled ||
                    listActionPendingId === article.id
                  }
                  actionPending={listActionPendingId === article.id}
                  onOpen={() => onOpen(article)}
                  onPreview={() => onPreview(article)}
                  onPublish={() => void publishListedArticle(article)}
                  onUnpublish={() => void unpublishListedArticle(article)}
                  onTrash={() => void moveListedArticleToTrash(article)}
                />
              ))}
              {visible.length === 0 ? (
                <li className={styles.filterEmpty}>{m.no_articles_match()}</li>
              ) : null}
            </ul>
          </div>
        </>
      )}
    </main>
  );
}

function ArticleRow({
  article,
  isSelected,
  disabled,
  actionPending,
  onOpen,
  onPreview,
  onPublish,
  onUnpublish,
  onTrash,
}: Readonly<{
  article: Article;
  isSelected: boolean;
  disabled: boolean;
  actionPending: boolean;
  onOpen: () => void;
  onPreview: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onTrash: () => void;
}>) {
  const title = article.draft.title || m.untitled_article();
  const projection = articleLifecycleProjection(article);
  const cover = article.draft.cover;
  const canUnpublish = article.currentPublicationId !== null;
  const publishLabel =
    projection === "published" || projection === "changes-pending"
      ? m.republish()
      : m.publish();
  const unpublishReason = m.unpublish_disabled_no_current_publication();

  return (
    <li
      className={`${styles.row}${cover ? "" : ` ${styles.rowNoCover}`}`}
      data-selected={isSelected}
    >
      {cover ? (
        <img
          className={styles.coverThumb}
          src={`/media/private/${cover.assetId}`}
          alt=""
          loading="lazy"
        />
      ) : null}
      <button
        className={`${styles.rowButton} ${styles.main}`}
        type="button"
        aria-label={`${title} · ${m.draft_version({ version: String(article.draft.version) })}`}
        disabled={disabled}
        onClick={onOpen}
      >
        <span className={styles.titleLine}>
          <span
            className={`${styles.title}${article.draft.title ? "" : ` ${styles.titleUntitled}`}`}
          >
            {title}
          </span>
          {lifecycleChip(projection)}
        </span>
        <span className={styles.slug}>
          {article.draft.slug ? `/${article.draft.slug}` : m.no_slug_yet()}
        </span>
        <span className={styles.meta}>
          <span className={styles.metaItem}>
            {m.draft_version({ version: String(article.draft.version) })}
          </span>
          <span className={styles.metaItem}>
            <AdminIcon name="clock" size={12} strokeWidth={2.2} />
            {m.edited()}{" "}
            <time dateTime={new Date(article.draft.updatedAt).toISOString()}>
              {new Date(article.draft.updatedAt).toLocaleString()}
            </time>
          </span>
          <span className={styles.metaItem}>
            {canUnpublish
              ? m.current_publication_selected()
              : m.no_current_publication_selected()}
          </span>
        </span>
      </button>
      <span className={styles.side}>
        <Button
          className={styles.editDesktop}
          size="sm"
          type="button"
          variant="ghost"
          isDisabled={disabled}
          onPress={onOpen}
        >
          {m.edit()}
        </Button>
        <Dropdown.Root>
          <Dropdown.Trigger
            className={styles.menuTrigger}
            aria-label={m.more_actions_for({ title })}
            isDisabled={disabled && !actionPending}
          >
            <AdminIcon name="more" size={18} />
          </Dropdown.Trigger>
          <Dropdown.Popover placement="bottom end">
            <Dropdown.Menu
              aria-label={m.actions_for({ title })}
              disabledKeys={[
                ...(disabled ? ["edit", "preview", "publish", "trash"] : []),
                ...(!canUnpublish || disabled ? ["unpublish"] : []),
              ]}
              onAction={(key) => {
                if (key === "edit") onOpen();
                else if (key === "preview") onPreview();
                else if (key === "publish") onPublish();
                else if (key === "unpublish") onUnpublish();
                else if (key === "trash") onTrash();
              }}
            >
              <Dropdown.Item id="edit" textValue={m.edit()}>
                {m.edit()}
              </Dropdown.Item>
              <Dropdown.Item id="preview" textValue={m.preview_saved_draft()}>
                {m.preview_saved_draft()}
              </Dropdown.Item>
              <Dropdown.Item id="publish" textValue={publishLabel}>
                {publishLabel}
              </Dropdown.Item>
              <Dropdown.Item
                id="unpublish"
                textValue={
                  canUnpublish
                    ? m.unpublish()
                    : `${m.unpublish()} — ${unpublishReason}`
                }
                aria-label={
                  canUnpublish
                    ? m.unpublish()
                    : `${m.unpublish()}: ${unpublishReason}`
                }
              >
                {canUnpublish
                  ? m.unpublish()
                  : `${m.unpublish()} — ${unpublishReason}`}
              </Dropdown.Item>
              <Dropdown.Item id="trash" textValue={m.move_to_trash()}>
                {m.move_to_trash()}
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown.Root>
      </span>
    </li>
  );
}

function ArticleListSkeleton() {
  return (
    <div aria-busy="true" role="status" aria-label={m.loading_article_drafts()}>
      <div className={styles.toolbar}>
        <div className="skeleton" style={{ width: "22rem", height: "2rem" }} />
      </div>
      <div className={styles.card}>
        <div className={styles.list}>
          {[40, 55, 35, 48].map((width) => (
            <div className={styles.skeletonRow} key={width}>
              <div className={`skeleton ${styles.coverThumb}`} />
              <div className={styles.skeletonStack}>
                <div
                  className="skeleton"
                  style={{ width: `${width}%`, height: "1rem" }}
                />
                <div
                  className="skeleton"
                  style={{ width: "24%", height: "0.75rem" }}
                />
                <div
                  className="skeleton"
                  style={{ width: "60%", height: "0.75rem" }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
