import { Alert, Button, TextArea } from "@heroui/react";

import { m } from "../../paraglide/messages.js";
import { publicationIssueGuidance } from "./publication-issues";
import type { ArticleWorkspace } from "./use-article-workspace";
import styles from "./workspace-alerts.module.css";

/**
 * The workspace-wide feedback stack: trash lifecycle, leave guard, autosave
 * states, publish and unpublish outcomes. Rendered above the active view so
 * the user never loses the result of a deliberate action.
 */
export function WorkspaceAlerts({
  workspace,
}: Readonly<{ workspace: ArticleWorkspace }>) {
  const {
    state,
    issues,
    conflictCopy,
    blocker,
    publishState,
    publicationAction,
    publicationIssues,
    publicationReceipt,
    publicationReconciliationState,
    unpublishState,
    trashActionState,
    lifecycleActionPending,
    persistCurrentDraft,
    reloadDraft,
    retryConflict,
    retryPublishDraft,
    acknowledgePublicationReconciliation,
    clearSelectedArticle,
  } = workspace;

  return (
    <div className={styles.stack}>
      {trashActionState === "restored" ? (
        <Alert status="success" role="status">
          <Alert.Content>
            <Alert.Title>{m.alert_article_restored_unpublished()}</Alert.Title>
            <Alert.Description>
              {m.alert_article_restored_unpublished_description()}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : trashActionState === "trash-error" ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>{m.alert_unable_move_to_trash()}</Alert.Title>
            <Alert.Description>
              {m.alert_unable_move_to_trash_description()}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {blocker.status === "blocked" ? (
        <Alert status="warning" role="alert">
          <Alert.Content>
            <Alert.Title>{m.alert_unsaved_local_changes()}</Alert.Title>
            <Alert.Description>
              {m.alert_unsaved_local_changes_description()}
              <span className={styles.actions}>
                <Button
                  type="button"
                  variant="secondary"
                  onPress={blocker.reset}
                >
                  {m.alert_stay_here()}
                </Button>
                <Button
                  type="button"
                  onPress={() => {
                    clearSelectedArticle();
                    blocker.proceed();
                  }}
                >
                  {m.alert_leave_without_saving()}
                </Button>
              </span>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {state === "failed" ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>{m.alert_draft_save_failed()}</Alert.Title>
            <Alert.Description>
              {m.alert_draft_save_failed_description()}
              <span className={styles.actions}>
                <Button
                  type="button"
                  onPress={() => void persistCurrentDraft()}
                >
                  {m.alert_retry_save()}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  isDisabled={lifecycleActionPending}
                  onPress={reloadDraft}
                >
                  {m.alert_reload_server_draft()}
                </Button>
              </span>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : state === "conflict" ? (
        <Alert status="warning" role="alert">
          <Alert.Content>
            <Alert.Title>{m.alert_draft_conflict()}</Alert.Title>
            <Alert.Description>
              {m.alert_draft_conflict_description()}
              <span className={styles.actions}>
                <Button
                  type="button"
                  isDisabled={lifecycleActionPending}
                  onPress={retryConflict}
                >
                  {m.alert_retry_local_draft()}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  isDisabled={lifecycleActionPending}
                  onPress={reloadDraft}
                >
                  {m.alert_reload_server_draft()}
                </Button>
              </span>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : state === "slug-conflict" ? (
        <Alert status="warning" role="alert">
          <Alert.Content>
            <Alert.Title>{m.alert_slug_claimed()}</Alert.Title>
            <Alert.Description>
              {m.alert_slug_claimed_description()}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : state === "invalid" ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>{m.alert_draft_invalid()}</Alert.Title>
            <Alert.Description>
              <ul className="list-disc pl-5">
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
              <Button
                className={styles.actionTop}
                type="button"
                onPress={() => void persistCurrentDraft()}
              >
                {m.alert_retry_save()}
              </Button>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : state === "offline" ? (
        <Alert status="warning" role="alert">
          <Alert.Content>
            <Alert.Title>{m.alert_offline_draft_not_saved()}</Alert.Title>
            <Alert.Description>
              {m.alert_offline_draft_not_saved_description()}
              <Button
                className={styles.actionTop}
                type="button"
                onPress={() => void persistCurrentDraft()}
              >
                {m.alert_retry_save()}
              </Button>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {conflictCopy ? (
        <details>
          <summary className={styles.conflictSummary}>
            {m.alert_copy_preserved_draft_json()}
          </summary>
          <TextArea
            className={`${styles.actionTop} font-mono`}
            aria-label={m.alert_preserved_draft_json_label()}
            readOnly
            value={JSON.stringify(conflictCopy, null, 2)}
          />
        </details>
      ) : null}

      {publicationAction !== null ? (
        <Alert status="success" role="status">
          <Alert.Content>
            <Alert.Title>
              {publicationAction === "republished"
                ? m.alert_article_republished()
                : m.alert_article_published()}
            </Alert.Title>
            <Alert.Description>
              {publicationAction === "republished"
                ? m.alert_article_republished_description()
                : m.alert_article_published_description()}
              {publicationReceipt ? (
                <span className={styles.receipt}>
                  {m.alert_publication_receipt({
                    publicationId: publicationReceipt.publicationId,
                    draftVersion: String(publicationReceipt.draftVersion),
                  })}
                </span>
              ) : null}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : publishState === "invalid" ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>{m.alert_publication_validation_failed()}</Alert.Title>
            <Alert.Description>
              <ul className="list-disc pl-5">
                {publicationIssues.map((issue) => (
                  <li key={`${issue.code}:${issue.path}`}>
                    {publicationIssueGuidance(issue)}
                  </li>
                ))}
              </ul>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : publishState === "conflict" ? (
        <Alert status="warning" role="alert">
          <Alert.Content>
            <Alert.Title>{m.alert_publication_conflict()}</Alert.Title>
            <Alert.Description>
              {publicationReconciliationState === "reconciled"
                ? m.alert_publication_conflict_reconciled()
                : m.alert_publication_conflict_unreconciled()}
              {publicationReconciliationState === "reconciled" ? (
                <Button
                  className={styles.actionTop}
                  type="button"
                  variant="secondary"
                  onPress={acknowledgePublicationReconciliation}
                >
                  {m.alert_continue_refreshed_state()}
                </Button>
              ) : (
                <Button
                  className={styles.actionTop}
                  type="button"
                  variant="secondary"
                  onPress={reloadDraft}
                >
                  {m.alert_reload_article_state()}
                </Button>
              )}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : publishState === "not-completed" ? (
        <Alert status="warning" role="alert">
          <Alert.Content>
            <Alert.Title>{m.alert_publication_not_completed()}</Alert.Title>
            <Alert.Description>
              {m.alert_publication_not_completed_description()}
              <Button
                className={styles.actionTop}
                type="button"
                onPress={() => void retryPublishDraft()}
              >
                {m.alert_retry_publish_command()}
              </Button>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : publishState === "reconciling" ? (
        <Alert status="warning" role="status">
          <Alert.Content>
            <Alert.Title>{m.alert_checking_publication_state()}</Alert.Title>
            <Alert.Description>
              {m.alert_checking_publication_state_description()}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : publishState === "state-unconfirmed" ||
        publishState === "transport-error" ? (
        <Alert status="warning" role="alert">
          <Alert.Content>
            <Alert.Title>
              {publishState === "state-unconfirmed"
                ? m.alert_publication_outcome_needs_review()
                : m.alert_publish_connection_interrupted()}
            </Alert.Title>
            <Alert.Description>
              {publicationReconciliationState === "reconciled"
                ? m.alert_publish_outcome_reconciled()
                : m.alert_publish_outcome_unreconciled()}
              {publicationReconciliationState === "reconciled" ? (
                <Button
                  className={styles.actionTop}
                  type="button"
                  variant="secondary"
                  onPress={acknowledgePublicationReconciliation}
                >
                  {m.alert_continue_refreshed_state()}
                </Button>
              ) : (
                <Button
                  className={styles.actionTop}
                  type="button"
                  variant="secondary"
                  onPress={reloadDraft}
                >
                  {m.alert_reload_article_state()}
                </Button>
              )}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : publishState === "error" ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>{m.alert_unable_to_publish()}</Alert.Title>
            <Alert.Description>
              {m.alert_unable_to_publish_description()}
              <Button
                className={styles.actionTop}
                type="button"
                variant="secondary"
                onPress={reloadDraft}
              >
                {m.alert_reload_article_state()}
              </Button>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {unpublishState === "unpublished" ? (
        <Alert status="success" role="status">
          <Alert.Content>
            <Alert.Title>{m.alert_article_unpublished()}</Alert.Title>
            <Alert.Description>
              {m.alert_article_unpublished_description()}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : unpublishState === "error" ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>{m.alert_unable_to_unpublish()}</Alert.Title>
            <Alert.Description>
              {m.alert_unable_to_unpublish_description()}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
    </div>
  );
}
