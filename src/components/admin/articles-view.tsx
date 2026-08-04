import { Alert, Button, Dropdown, Tooltip } from "@heroui/react";
import { useMemo, useState } from "react";

import type { Article } from "../../articles/articles";
import { AdminIcon } from "./icons";
import { StatusChip } from "./status-chip";
import type { ArticleWorkspace } from "./use-article-workspace";

type ArticleFilter =
  "all" | "with-current-publication" | "without-current-publication";

function articleVisible(article: Article, filter: ArticleFilter): boolean {
  if (filter === "with-current-publication") {
    return article.currentPublicationId !== null;
  }
  if (filter === "without-current-publication") {
    return article.currentPublicationId === null;
  }
  return true;
}

/**
 * Articles index: page head, status filter tabs, future-search marker and the
 * article rows with cover, status chip, metadata and a per-row action menu.
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
  const { articles, state, selected, articleSelectionDisabled } = workspace;
  const [filter, setFilter] = useState<ArticleFilter>("all");

  const counts = useMemo(
    () => ({
      all: articles.length,
      withCurrentPublication: articles.filter(
        (article) => article.currentPublicationId !== null,
      ).length,
      withoutCurrentPublication: articles.filter(
        (article) => article.currentPublicationId === null,
      ).length,
    }),
    [articles],
  );
  const visible = articles.filter((article) => articleVisible(article, filter));

  return (
    <main className="page" id="admin-main">
      <header className="page-head">
        <div>
          <h1 className="page-title">Articles</h1>
          <p className="page-desc">
            Each article has one living Draft. Publishing freezes an immutable
            Publication — editing never touches what’s live.
          </p>
        </div>
        <div className="page-actions">
          <Button
            type="button"
            aria-label="Create Article Draft"
            isPending={state === "creating"}
            isDisabled={
              articleSelectionDisabled ||
              state === "loading" ||
              state === "creating"
            }
            onPress={onCreate}
          >
            <AdminIcon name="plus" size={16} />
            New article
          </Button>
        </div>
      </header>

      {state === "loading" && articles.length === 0 ? (
        <ArticleListSkeleton />
      ) : state === "failed" && articles.length === 0 ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>Unable to load Articles</Alert.Title>
            <Alert.Description>
              Reload this page to retry. No local or public Article state was
              changed.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : articles.length === 0 && state !== "failed" ? (
        <div className="card">
          <div className="empty">
            <div className="empty-icon">
              <AdminIcon name="articles" size={24} />
            </div>
            <h3>No articles yet</h3>
            <p>
              Your first article starts as a private Draft. Nothing goes live
              until you publish it — deliberately.
            </p>
            <div className="empty-actions">
              <Button
                type="button"
                isPending={state === "creating"}
                isDisabled={
                  articleSelectionDisabled ||
                  state === "loading" ||
                  state === "creating"
                }
                onPress={onCreate}
              >
                Write your first article
              </Button>
            </div>
          </div>
        </div>
      ) : articles.length === 0 ? null : (
        <>
          <div className="row-between wrap mb-4">
            <div
              className="tabs-line-list"
              role="tablist"
              aria-label="Filter by status"
              style={{ borderBottom: 0 }}
            >
              {(
                [
                  ["all", "All", counts.all],
                  [
                    "with-current-publication",
                    "Published",
                    counts.withCurrentPublication,
                  ],
                  [
                    "without-current-publication",
                    "Unpublished",
                    counts.withoutCurrentPublication,
                  ],
                ] as const
              ).map(([id, label, count]) => (
                <button
                  key={id}
                  className="tab-line"
                  type="button"
                  role="tab"
                  aria-selected={filter === id}
                  aria-controls="article-panel"
                  onClick={() => setFilter(id)}
                >
                  {label} <span className="count">{count}</span>
                </button>
              ))}
            </div>
            <Tooltip.Root delay={500}>
              <Tooltip.Trigger
                className="input-group"
                style={{
                  width: "16rem",
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                }}
                aria-label="Search articles — planned future capability"
              >
                <AdminIcon
                  name="search"
                  size={16}
                  style={{
                    position: "absolute",
                    left: "0.75rem",
                    color: "var(--foreground-faint)",
                    pointerEvents: "none",
                  }}
                />
                <input
                  className="input"
                  type="search"
                  placeholder="Search articles"
                  disabled
                  aria-disabled="true"
                  aria-describedby="search-note"
                  style={{
                    width: "100%",
                    background: "var(--content2)",
                    border: "1.5px solid transparent",
                    borderRadius: "var(--radius-m)",
                    padding: "0.5rem 0.75rem 0.5rem 2.25rem",
                    height: "2.5rem",
                    font: "inherit",
                    color: "inherit",
                  }}
                />
              </Tooltip.Trigger>
              <Tooltip.Content>
                Full-text search is a future capability — not in this version
              </Tooltip.Content>
            </Tooltip.Root>
          </div>
          <p className="small faint mb-4" id="search-note">
            Search is shown for layout only — it is a planned future capability,
            not implemented in this version.
          </p>

          <div
            className="card"
            role="tabpanel"
            id="article-panel"
            aria-label="Article Drafts"
          >
            <ul className="article-list">
              {visible.map((article) => (
                <ArticleRow
                  key={article.id}
                  article={article}
                  isSelected={selected?.id === article.id}
                  disabled={articleSelectionDisabled}
                  onOpen={() => onOpen(article)}
                  onPreview={() => onPreview(article)}
                />
              ))}
              {visible.length === 0 ? (
                <li
                  className="small muted"
                  style={{ padding: "var(--space-6)", textAlign: "center" }}
                >
                  No articles match this filter.
                </li>
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
  onOpen,
  onPreview,
}: Readonly<{
  article: Article;
  isSelected: boolean;
  disabled: boolean;
  onOpen: () => void;
  onPreview: () => void;
}>) {
  const title = article.draft.title || "Untitled Article";
  const hasCurrentPublication = article.currentPublicationId !== null;
  const cover = article.draft.cover;

  return (
    <li
      className={`article-row${cover ? "" : " no-cover"}`}
      data-selected={isSelected}
    >
      {cover ? (
        <img
          className="cover-thumb"
          src={`/media/private/${cover.assetId}`}
          alt=""
          loading="lazy"
        />
      ) : null}
      <button
        className="article-row-button article-main"
        type="button"
        aria-label={`${title} · Version ${article.draft.version}`}
        disabled={disabled}
        onClick={onOpen}
      >
        <span className="article-title-line">
          <span
            className={`article-title${article.draft.title ? "" : " untitled"}`}
          >
            {title}
          </span>
          {hasCurrentPublication ? (
            <StatusChip variant="success" dot>
              Published
            </StatusChip>
          ) : (
            <StatusChip variant="default" dot>
              Draft
            </StatusChip>
          )}
        </span>
        <span className="article-slug">
          {article.draft.slug ? `/${article.draft.slug}` : "No slug yet"}
        </span>
        <span className="article-meta">
          <span className="m">Draft v{article.draft.version}</span>
          <span className="m">
            <AdminIcon name="clock" size={12} strokeWidth={2.2} />
            Edited{" "}
            <time dateTime={new Date(article.draft.updatedAt).toISOString()}>
              {new Date(article.draft.updatedAt).toLocaleString()}
            </time>
          </span>
          <span className="m">
            {hasCurrentPublication
              ? "Current Publication selected"
              : "No Current Publication selected"}
          </span>
        </span>
      </button>
      <span className="article-side">
        <Button
          className="hide-m"
          size="sm"
          type="button"
          variant="ghost"
          isDisabled={disabled}
          onPress={onOpen}
        >
          Edit
        </Button>
        <Dropdown.Root>
          <Dropdown.Trigger
            className="article-menu-trigger"
            aria-label={`More actions for ${title}`}
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
              aria-label={`Actions for ${title}`}
              disabledKeys={disabled ? ["edit", "preview"] : []}
              onAction={(key) => {
                if (key === "edit") onOpen();
                else if (key === "preview") onPreview();
              }}
            >
              <Dropdown.Item id="edit" textValue="Edit">
                Edit
              </Dropdown.Item>
              <Dropdown.Item id="preview" textValue="Preview saved Draft">
                Preview saved Draft
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
    <div aria-busy="true" role="status" aria-label="Loading Article Drafts">
      <div className="row mb-4">
        <div className="skeleton" style={{ width: "22rem", height: "2rem" }} />
      </div>
      <div className="card">
        <div className="article-list">
          {[40, 55, 35, 48].map((width) => (
            <div className="article-row" key={width}>
              <div className="skeleton cover-thumb" />
              <div className="article-main">
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
