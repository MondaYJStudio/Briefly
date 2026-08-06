import { Alert, AlertDialog, Button, Spinner } from "@heroui/react";
import { useState } from "react";

import type { ArticleTrashEntry } from "../../articles/articles";
import { AdminIcon } from "./icons";
import { StatusChip } from "./status-chip";
import type { ArticleWorkspace } from "./use-article-workspace";

/**
 * Trash: trashed articles with restore and permanent-purge confirmations,
 * plus the prototype's "three different verbs" explainer card.
 */
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

  return (
    <main className="page" id="admin-main">
      <header className="page-head">
        <div>
          <h1 className="page-title">Trash</h1>
          <p className="page-desc">
            Trashed articles keep their Draft, all Publications, slug records
            and media references — but leave the normal list. Nothing here is
            public.
          </p>
        </div>
      </header>

      <div className="stack">
        {trashActionState === "trashed" ? (
          <Alert status="success" role="status">
            <Alert.Content>
              <Alert.Title>Article moved to Trash</Alert.Title>
              <Alert.Description>
                It is absent from normal administration and public Article
                endpoints. Its recoverable work is intact; restoring it will
                leave it unpublished.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : trashActionState === "purged" ? (
          <div className="card">
            <div className="empty">
              <div className="empty-icon is-success">
                <AdminIcon name="check" size={24} />
              </div>
              <h3>Deleted permanently</h3>
              <p>
                The article, its Draft and all Publications are gone. Its media
                files were not touched. Formerly public slugs answer{" "}
                <strong>410 Gone</strong> and can never be used again.
              </p>
            </div>
          </div>
        ) : trashActionState === "purge-error" ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>Unable to permanently purge Article</Alert.Title>
              <Alert.Description>
                Briefly did not confirm the destructive operation. The Article
                remains in Trash and can be retried safely.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : trashActionState === "restore-error" ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>Unable to restore Article</Alert.Title>
              <Alert.Description>
                Briefly did not confirm the restore. The Article remains in
                Trash; reload the Trash view and try again.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}

        {trashViewState === "loading" ? (
          <div className="card card-pad row" role="status">
            <Spinner aria-label="Loading Trash" />
            <span>Loading Trash…</span>
          </div>
        ) : trashViewState === "error" ? (
          <div className="card">
            <div className="empty">
              <div className="empty-icon is-danger">
                <AdminIcon name="alert" size={24} />
              </div>
              <h3>Couldn’t load Trash</h3>
              <p>
                The request failed. Nothing was changed — this is only a display
                problem.
              </p>
              <div className="empty-actions">
                <Button type="button" onPress={() => void reloadTrashView()}>
                  Retry
                </Button>
              </div>
            </div>
          </div>
        ) : trashedArticles.length === 0 ? (
          <div className="card">
            <div className="empty">
              <div className="empty-icon">
                <AdminIcon name="trash" size={24} />
              </div>
              <h3>Trash is empty</h3>
              <p>
                Articles you move to Trash appear here with their full history
                intact, waiting to be restored or permanently deleted.
              </p>
            </div>
          </div>
        ) : (
          <div className="card">
            <ul className="article-list" aria-label="Articles in Trash">
              {trashedArticles.map((article) => (
                <li key={article.id} className="article-row no-cover">
                  <div className="article-main">
                    <div className="article-title-line">
                      <span
                        className={`article-title${article.title ? "" : " untitled"}`}
                      >
                        {article.title || "Untitled Article"}
                      </span>
                      <StatusChip variant="default" dot>
                        {article.publicationCount > 0
                          ? "Was published"
                          : "Never published"}
                      </StatusChip>
                    </div>
                    <span className="article-meta">
                      <span className="m">
                        Trashed{" "}
                        <time
                          dateTime={new Date(article.trashedAt).toISOString()}
                        >
                          {new Date(article.trashedAt).toLocaleString()}
                        </time>
                      </span>
                      <span className="m">Draft v{article.draftVersion}</span>
                      <span className="m">
                        {article.publicationCount} retained Publication
                        {article.publicationCount === 1 ? "" : "s"}
                      </span>
                    </span>
                  </div>
                  <div className="article-side">
                    <Button
                      size="sm"
                      type="button"
                      variant="secondary"
                      aria-label={`Restore ${article.title || article.id} from Trash`}
                      isDisabled={articleSelectionDisabled}
                      isPending={trashActionState === "restoring"}
                      onPress={() => setRestoreTarget(article)}
                    >
                      Restore
                    </Button>
                    <Button
                      size="sm"
                      type="button"
                      variant="danger-soft"
                      aria-label={`Permanently purge ${article.title || article.id}`}
                      isDisabled={articleSelectionDisabled}
                      isPending={trashActionState === "purging"}
                      onPress={() => setPurgeTarget(article)}
                    >
                      Delete permanently…
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {trashedArticles.length > 0 ? (
          <div className="card card-pad">
            <h2
              style={{
                fontSize: "var(--text-small)",
                fontWeight: 650,
                marginBottom: "var(--space-3)",
              }}
            >
              Three different verbs
            </h2>
            <div className="stack" style={{ gap: "var(--space-2)" }}>
              <p className="small muted">
                <StatusChip variant="warning">Unpublish</StatusChip> Article
                stays in the normal list — Draft and history kept, republish
                anytime.
              </p>
              <p className="small muted">
                <StatusChip variant="default">Move to Trash</StatusChip> Article
                leaves the normal list and goes offline — restorable, always
                returns unpublished.
              </p>
              <p className="small muted">
                <StatusChip variant="danger">Delete permanently</StatusChip>{" "}
                Only possible here in Trash. Cannot be undone.
              </p>
            </div>
          </div>
        ) : null}
      </div>

      {/* ===== Restore confirmation ===== */}
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
                Restore this Article from Trash?
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>
                Restore {restoreTarget?.title || restoreTarget?.id} to normal
                administration? Its Draft and Publication history remain intact
                and editable, but it will have no Current Publication. You must
                explicitly publish it again before anonymous Article endpoints
                can see it.
              </p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button type="button" variant="secondary" slot="close">
                Cancel
              </Button>
              <Button
                type="button"
                slot="close"
                isDisabled={articleSelectionDisabled}
                onPress={() =>
                  restoreTarget && void restoreArticleFromTrash(restoreTarget)
                }
              >
                Restore Article
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>

      {/* ===== Permanent purge confirmation ===== */}
      <AlertDialog.Backdrop
        isOpen={purgeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPurgeTarget(null);
        }}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>
                Permanently purge this Article?
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>
                Permanently purge Article ID {purgeTarget?.id}? This cannot be
                undone. Its Draft and all Publication history, including title,
                body, summary, tags, Byline, language, and rendered HTML, will
                be deleted and cannot be restored. Formerly public slugs remain
                reserved and return 410 Gone. Asset objects are not deleted
                automatically.
              </p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button type="button" variant="secondary" slot="close">
                Cancel — keep Article
              </Button>
              <Button
                type="button"
                variant="danger"
                slot="close"
                isDisabled={articleSelectionDisabled}
                onPress={() =>
                  purgeTarget && void purgeArticleFromTrash(purgeTarget)
                }
              >
                Confirm permanent purge
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </main>
  );
}
