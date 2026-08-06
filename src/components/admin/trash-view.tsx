import { Alert, AlertDialog, Button, Input, Label } from "@heroui/react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";

import type { ArticleTrashEntry } from "../../articles/articles";
import { purgeConfirmationMatches } from "../../articles/article-trash";
import { m } from "../../paraglide/messages.js";
import { getLocale } from "../../paraglide/runtime.js";
import { AdminIcon } from "./icons";
import { StatusChip } from "./status-chip";
import styles from "./trash-view.module.css";
import type { ArticleWorkspace } from "./use-article-workspace";

function displayTitle(article: ArticleTrashEntry): string {
  return article.title || m.trash_untitled();
}

function formatTrashedAt(trashedAt: string | Date): string {
  const date = new Date(trashedAt);
  return date.toLocaleString(getLocale());
}

/** Trash: trashed articles with restore and permanent-purge confirmations. */
export function TrashView({
  workspace,
}: Readonly<{ workspace: ArticleWorkspace }>) {
  const {
    trashedArticles,
    trashViewState,
    trashActionState,
    articleSelectionDisabled,
    reloadTrashView,
    restoreArticleFromTrash,
    purgeArticleFromTrash,
  } = workspace;
  const [restoreTarget, setRestoreTarget] = useState<ArticleTrashEntry | null>(
    null,
  );
  const [purgeTarget, setPurgeTarget] = useState<ArticleTrashEntry | null>(
    null,
  );
  const [purgeConfirmation, setPurgeConfirmation] = useState("");
  const restoreTriggerRef = useRef<HTMLElement | null>(null);
  const purgeTriggerRef = useRef<HTMLElement | null>(null);
  const confirmInputId = useId();
  const navigate = useNavigate();
  const confirmPhrase = m.trash_purge_confirm_phrase();
  const purgeConfirmed = purgeConfirmationMatches({
    confirmationTitle: purgeConfirmation,
  });

  useEffect(() => {
    if (purgeTarget === null) setPurgeConfirmation("");
  }, [purgeTarget]);

  const showPurgedOutcome =
    trashActionState === "purged" && trashedArticles.length === 0;

  return (
    <main
      className={`flex min-w-0 flex-1 flex-col max-w-6xl w-full mx-auto pt-8 px-10 pb-16 max-[860px]:pt-5 max-[860px]:px-4 max-[860px]:pb-10`}
      id="admin-main"
    >
      <header className={`flex flex-wrap items-end justify-between mb-8 gap-4`}>
        <div>
          <h1 className={`${styles.pageTitle} text-2xl`}>
            {m.trash_page_title()}
          </h1>
          <p className={`${styles.pageDesc} mt-2`}>
            {m.trash_page_description()}
          </p>
        </div>
      </header>

      <div className={`flex flex-col gap-4`}>
        {trashActionState === "trashed" ? (
          <Alert status="success" role="status">
            <Alert.Content>
              <Alert.Title>{m.trash_moved_title()}</Alert.Title>
              <Alert.Description>
                {m.trash_moved_description()}
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : trashActionState === "restored" ? (
          <Alert status="success" role="status">
            <Alert.Content>
              <Alert.Title>{m.trash_restored_title()}</Alert.Title>
              <Alert.Description>
                {m.trash_restored_description()}
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : trashActionState === "purged" && !showPurgedOutcome ? (
          <Alert status="success" role="status">
            <Alert.Content>
              <Alert.Title>{m.trash_purged_title()}</Alert.Title>
              <Alert.Description>
                {m.trash_purged_description()}
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : trashActionState === "purge-error" ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>{m.trash_purge_error_title()}</Alert.Title>
              <Alert.Description>
                {m.trash_purge_error_description()}
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : trashActionState === "restore-error" ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>{m.trash_restore_error_title()}</Alert.Title>
              <Alert.Description>
                {m.trash_restore_error_description()}
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}

        {showPurgedOutcome ? (
          <div className={styles.card}>
            <div
              className={`flex flex-col items-center text-center py-16 px-6`}
            >
              <div className={`${styles.emptyIcon} ${styles.emptyIconSuccess}`}>
                <AdminIcon name="check" size={24} />
              </div>
              <h3 className={`${styles.emptyTitle} text-base`}>
                {m.trash_purged_title()}
              </h3>
              <p className={`${styles.emptyCopy} mt-1`}>
                {m.trash_purged_description()}
              </p>
              <div className={`flex mt-5 gap-2`}>
                <Button
                  type="button"
                  variant="secondary"
                  onPress={() => void navigate({ to: "/admin/articles" })}
                >
                  {m.trash_back_to_articles()}
                </Button>
              </div>
            </div>
          </div>
        ) : trashViewState === "loading" ? (
          <TrashListSkeleton />
        ) : trashViewState === "error" ? (
          <div className={styles.card}>
            <div
              className={`flex flex-col items-center text-center py-16 px-6`}
            >
              <div className={`${styles.emptyIcon} ${styles.emptyIconDanger}`}>
                <AdminIcon name="alert" size={24} />
              </div>
              <h3 className={`${styles.emptyTitle} text-base`}>
                {m.trash_load_failed_title()}
              </h3>
              <p className={`${styles.emptyCopy} mt-1`}>
                {m.trash_load_failed_description()}
              </p>
              <div className={`flex mt-5 gap-2`}>
                <Button type="button" onPress={() => void reloadTrashView()}>
                  {m.trash_retry()}
                </Button>
              </div>
            </div>
          </div>
        ) : trashedArticles.length === 0 ? (
          <div className={styles.card}>
            <div
              className={`flex flex-col items-center text-center py-16 px-6`}
            >
              <div
                className={`${styles.emptyIcon} grid place-items-center mb-4`}
              >
                <AdminIcon name="trash" size={24} />
              </div>
              <h3 className={`${styles.emptyTitle} text-base`}>
                {m.trash_empty_title()}
              </h3>
              <p className={`${styles.emptyCopy} mt-1`}>
                {m.trash_empty_description()}
              </p>
              <div className={`flex mt-5 gap-2`}>
                <Button
                  type="button"
                  variant="secondary"
                  onPress={() => void navigate({ to: "/admin/articles" })}
                >
                  {m.trash_back_to_articles()}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.card}>
            <ul
              className={`${styles.list} m-0 p-0`}
              aria-label={m.trash_list_label()}
            >
              {trashedArticles.map((article) => {
                const title = displayTitle(article);
                return (
                  <li
                    key={article.id}
                    className={`${styles.row} flex flex-wrap items-start justify-between gap-4 py-4 px-5`}
                  >
                    <div className={`min-w-0 flex-1`}>
                      <div className={`flex flex-wrap items-center gap-2 mb-1`}>
                        <span
                          className={`${styles.title} text-base${article.title ? "" : ` ${styles.untitled}`}`}
                        >
                          {title}
                        </span>
                        <StatusChip variant="default" dot>
                          {article.publicationCount > 0
                            ? m.trash_was_published()
                            : m.trash_never_published()}
                        </StatusChip>
                      </div>
                      <span
                        className={`${styles.meta} flex flex-wrap text-sm gap-3`}
                      >
                        <span>
                          {m.trash_trashed_at({
                            when: formatTrashedAt(article.trashedAt),
                          })}
                        </span>
                        <span>
                          {m.trash_draft_version({
                            version: String(article.draftVersion),
                          })}
                        </span>
                        <span>
                          {article.publicationCount === 1
                            ? m.trash_retained_publications({
                                count: String(article.publicationCount),
                              })
                            : m.trash_retained_publications_plural({
                                count: String(article.publicationCount),
                              })}
                        </span>
                      </span>
                    </div>
                    <div
                      className={`flex flex-wrap items-center shrink-0 gap-2`}
                    >
                      <Button
                        size="sm"
                        type="button"
                        variant="secondary"
                        aria-label={m.trash_restore_article({ title })}
                        isDisabled={articleSelectionDisabled}
                        isPending={trashActionState === "restoring"}
                        onPress={(event) => {
                          const target = event.target;
                          restoreTriggerRef.current =
                            target instanceof HTMLElement ? target : null;
                          setRestoreTarget(article);
                        }}
                      >
                        {m.trash_restore()}
                      </Button>
                      <Button
                        size="sm"
                        type="button"
                        variant="danger-soft"
                        aria-label={m.trash_purge_article({ title })}
                        isDisabled={articleSelectionDisabled}
                        isPending={trashActionState === "purging"}
                        onPress={(event) => {
                          const target = event.target;
                          purgeTriggerRef.current =
                            target instanceof HTMLElement ? target : null;
                          setPurgeTarget(article);
                        }}
                      >
                        {m.trash_delete_permanently()}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <AlertDialog.Backdrop
        isOpen={restoreTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRestoreTarget(null);
            queueMicrotask(() => restoreTriggerRef.current?.focus());
          }
        }}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>
                {m.trash_restore_heading()}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>
                {m.trash_restore_body({
                  title: restoreTarget ? displayTitle(restoreTarget) : "",
                })}
              </p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button type="button" variant="secondary" slot="close">
                {m.trash_cancel()}
              </Button>
              <Button
                type="button"
                slot="close"
                isDisabled={articleSelectionDisabled}
                onPress={() =>
                  restoreTarget && void restoreArticleFromTrash(restoreTarget)
                }
              >
                {m.trash_restore_confirm()}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>

      <AlertDialog.Backdrop
        isOpen={purgeTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPurgeTarget(null);
            queueMicrotask(() => purgeTriggerRef.current?.focus());
          }
        }}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>
                {m.trash_purge_heading()}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p className={`${styles.purgeWarning} text-xs`}>
                {m.trash_purge_warning({
                  title: purgeTarget ? displayTitle(purgeTarget) : "",
                })}
              </p>
              <ul className={`${styles.purgePoints} text-xs mt-3`}>
                <li>{m.trash_purge_point_content()}</li>
                <li>{m.trash_purge_point_media()}</li>
                <li>{m.trash_purge_point_tombstone()}</li>
              </ul>
              <div className={`flex flex-col gap-2 mt-5`}>
                <Label htmlFor={confirmInputId}>
                  {m.trash_purge_type_phrase({ phrase: confirmPhrase })}
                </Label>
                <Input
                  fullWidth
                  id={confirmInputId}
                  value={purgeConfirmation}
                  autoComplete="off"
                  placeholder={confirmPhrase}
                  onChange={(event) =>
                    setPurgeConfirmation(event.currentTarget.value)
                  }
                />
              </div>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button type="button" variant="secondary" slot="close">
                {m.trash_purge_cancel()}
              </Button>
              <Button
                type="button"
                variant="danger"
                slot="close"
                isDisabled={articleSelectionDisabled || !purgeConfirmed}
                aria-disabled={!purgeConfirmed}
                onPress={() => {
                  if (!purgeTarget || !purgeConfirmed) return;
                  void purgeArticleFromTrash(purgeTarget, purgeConfirmation);
                }}
              >
                {m.trash_purge_confirm()}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </main>
  );
}

const trashSkeletonRows = [
  { title: "40%", meta: ["28%", "18%", "32%"] },
  { title: "55%", meta: ["24%", "20%", "36%"] },
  { title: "35%", meta: ["30%", "22%", "28%"] },
] as const;

function TrashListSkeleton() {
  return (
    <div
      className={styles.card}
      aria-busy="true"
      role="status"
      aria-label={m.trash_loading_label()}
    >
      <div className={`${styles.list} m-0 p-0`} aria-hidden="true">
        {trashSkeletonRows.map((row) => (
          <div
            className={`${styles.skeletonRow} flex flex-wrap items-start justify-between gap-4 py-4 px-5`}
            key={row.title}
          >
            <div className={`min-w-0 flex-1 flex flex-col gap-2`}>
              <div className={`flex flex-wrap items-center gap-2`}>
                <div
                  className={styles.skeleton}
                  style={{ width: row.title, height: "1rem" }}
                />
                <div
                  className={styles.skeleton}
                  style={{ width: "5.5rem", height: "1.25rem" }}
                />
              </div>
              <div className={`flex flex-wrap gap-3`}>
                {row.meta.map((width) => (
                  <div
                    key={width}
                    className={styles.skeleton}
                    style={{ width, height: "0.75rem" }}
                  />
                ))}
              </div>
            </div>
            <div className={`flex shrink-0 items-center gap-2`}>
              <div
                className={styles.skeleton}
                style={{ width: "4rem", height: "2rem" }}
              />
              <div
                className={styles.skeleton}
                style={{ width: "5.5rem", height: "2rem" }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
