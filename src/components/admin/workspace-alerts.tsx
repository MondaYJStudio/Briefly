import { Alert, Button, TextArea } from "@heroui/react";

import { publicationIssueGuidance } from "./publication-issues";
import type { ArticleWorkspace } from "./use-article-workspace";

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
    <div className="stack" style={{ gap: "var(--space-3)" }}>
      {trashActionState === "restored" ? (
        <Alert status="success" role="status">
          <Alert.Content>
            <Alert.Title>Article restored as unpublished</Alert.Title>
            <Alert.Description>
              Its Draft and Publication history are intact. It has no Current
              Publication and remains unavailable from public endpoints until
              you explicitly publish it again.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : trashActionState === "trash-error" ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>Unable to move Article to Trash</Alert.Title>
            <Alert.Description>
              Briefly did not confirm the transition. The prior Article and
              public visibility state remain authoritative; reload and try
              again.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {blocker.status === "blocked" ? (
        <Alert status="warning" role="alert">
          <Alert.Content>
            <Alert.Title>Unsaved local changes</Alert.Title>
            <Alert.Description>
              Leaving now discards changes that the server has not confirmed.
              <span className="row mt-2">
                <Button
                  type="button"
                  variant="secondary"
                  onPress={blocker.reset}
                >
                  Stay here
                </Button>
                <Button
                  type="button"
                  onPress={() => {
                    clearSelectedArticle();
                    blocker.proceed();
                  }}
                >
                  Leave without saving
                </Button>
              </span>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {state === "failed" ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>Draft save failed</Alert.Title>
            <Alert.Description>
              Your current-tab changes are still available but are not durable.
              <span className="row mt-2">
                <Button
                  type="button"
                  onPress={() => void persistCurrentDraft()}
                >
                  Retry save
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  isDisabled={lifecycleActionPending}
                  onPress={reloadDraft}
                >
                  Reload server Draft
                </Button>
              </span>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : state === "conflict" ? (
        <Alert status="warning" role="alert">
          <Alert.Content>
            <Alert.Title>Draft conflict</Alert.Title>
            <Alert.Description>
              A newer Draft Version is already saved. No automatic rich-text
              merge or overwrite was attempted.
              <span className="row mt-2">
                <Button
                  type="button"
                  isDisabled={lifecycleActionPending}
                  onPress={retryConflict}
                >
                  Deliberately retry local Draft
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  isDisabled={lifecycleActionPending}
                  onPress={reloadDraft}
                >
                  Reload server Draft
                </Button>
              </span>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : state === "slug-conflict" ? (
        <Alert status="warning" role="alert">
          <Alert.Content>
            <Alert.Title>Slug is already claimed</Alert.Title>
            <Alert.Description>
              Another Article owns this slug. Your local Draft remains visible;
              choose a different slug to resume autosave.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : state === "invalid" ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>Draft is invalid</Alert.Title>
            <Alert.Description>
              <ul className="list-disc pl-5">
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
              <Button
                className="mt-2"
                type="button"
                onPress={() => void persistCurrentDraft()}
              >
                Retry save
              </Button>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : state === "offline" ? (
        <Alert status="warning" role="alert">
          <Alert.Content>
            <Alert.Title>Offline — Draft not saved</Alert.Title>
            <Alert.Description>
              Changes remain only in this tab. Briefly does not promise offline
              durability or synchronization. Reconnect, then retry.
              <Button
                className="mt-2"
                type="button"
                onPress={() => void persistCurrentDraft()}
              >
                Retry save
              </Button>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {conflictCopy ? (
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 500 }}>
            Copy the preserved local Draft JSON
          </summary>
          <TextArea
            className="mt-2 font-mono"
            aria-label="Preserved unsaved local Draft JSON"
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
                ? "Article republished"
                : "Article published"}
            </Alert.Title>
            <Alert.Description>
              {publicationAction === "republished"
                ? "The new immutable Publication is public now; earlier Publications remain unchanged."
                : "A new immutable Publication is public now."}
              {publicationReceipt ? (
                <span className="block mt-2">
                  Current Publication {publicationReceipt.publicationId} was
                  confirmed from saved Draft Version{" "}
                  {publicationReceipt.draftVersion}.
                </span>
              ) : null}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : publishState === "invalid" ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>Publication validation failed</Alert.Title>
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
            <Alert.Title>Publication conflict</Alert.Title>
            <Alert.Description>
              The saved Draft Version or observed Current Publication changed.
              Briefly did not retry the command.
              {publicationReconciliationState === "reconciled"
                ? " Briefly reread the authoritative Article and public state. Review the refreshed state before publishing again."
                : " Briefly could not fully reread the authoritative Article and public state. Reload it before publishing again."}
              {publicationReconciliationState === "reconciled" ? (
                <Button
                  className="mt-2"
                  type="button"
                  variant="secondary"
                  onPress={acknowledgePublicationReconciliation}
                >
                  Continue with refreshed state
                </Button>
              ) : (
                <Button
                  className="mt-2"
                  type="button"
                  variant="secondary"
                  onPress={reloadDraft}
                >
                  Reload Article state
                </Button>
              )}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : publishState === "not-completed" ? (
        <Alert status="warning" role="alert">
          <Alert.Content>
            <Alert.Title>Publication was not completed</Alert.Title>
            <Alert.Description>
              The server confirmed that this Publish command made no public
              change. Briefly will not retry it automatically.
              <Button
                className="mt-2"
                type="button"
                onPress={() => void retryPublishDraft()}
              >
                Retry this Publish command
              </Button>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : publishState === "reconciling" ? (
        <Alert status="warning" role="status">
          <Alert.Content>
            <Alert.Title>Checking publication state</Alert.Title>
            <Alert.Description>
              The Publish command is not being repeated. Briefly is rereading
              the Article and its public state.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : publishState === "state-unconfirmed" ||
        publishState === "transport-error" ? (
        <Alert status="warning" role="alert">
          <Alert.Content>
            <Alert.Title>
              {publishState === "state-unconfirmed"
                ? "Publication outcome needs review"
                : "Publish connection was interrupted"}
            </Alert.Title>
            <Alert.Description>
              {publicationReconciliationState === "reconciled"
                ? "Briefly reread the Article and its public endpoint. Review the refreshed Current Publication before issuing another Publish command."
                : "Briefly could not fully reread the Article and public endpoint. Reload the authoritative Article state before issuing another Publish command."}
              {publicationReconciliationState === "reconciled" ? (
                <Button
                  className="mt-2"
                  type="button"
                  variant="secondary"
                  onPress={acknowledgePublicationReconciliation}
                >
                  Continue with refreshed state
                </Button>
              ) : (
                <Button
                  className="mt-2"
                  type="button"
                  variant="secondary"
                  onPress={reloadDraft}
                >
                  Reload Article state
                </Button>
              )}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : publishState === "error" ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>Unable to publish Article</Alert.Title>
            <Alert.Description>
              Briefly could not classify this failure safely. Reload the Article
              state before trying another command.
              <Button
                className="mt-2"
                type="button"
                variant="secondary"
                onPress={reloadDraft}
              >
                Reload Article state
              </Button>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {unpublishState === "unpublished" ? (
        <Alert status="success" role="status">
          <Alert.Content>
            <Alert.Title>Article unpublished</Alert.Title>
            <Alert.Description>
              This Article is private now: it has no Current Publication and is
              unavailable from public content endpoints. Its Draft and
              Publication history remain intact, and it can be published again.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : unpublishState === "error" ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>Unable to unpublish Article</Alert.Title>
            <Alert.Description>
              Briefly did not confirm withdrawal. The existing Current
              Publication remains public; reload and try again.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
    </div>
  );
}
