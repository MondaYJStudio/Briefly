import { Alert, Button, Spinner } from "@heroui/react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EditorView } from "../../../components/admin/editor-view";
import { useArticlesRouteContext } from "./-context";

export const Route = createFileRoute("/admin/articles/$articleId")({
  component: ArticleEditorRoute,
});

function ArticleEditorRoute() {
  const { articleId } = Route.useParams();
  const navigate = useNavigate();
  const { workspace, siteSettings, setPreviewOpen } = useArticlesRouteContext();
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed">(
    workspace.selected?.id === articleId ? "ready" : "loading",
  );

  useEffect(() => {
    let active = true;
    if (workspace.selected?.id === articleId) {
      setLoadState("ready");
    } else {
      setLoadState("loading");
      void workspace.loadDraft(articleId).then((article) => {
        if (active) setLoadState(article ? "ready" : "failed");
      });
    }
    // The route parameter is the public loading seam. The workspace owns the
    // request and deliberately exposes a stable command rather than route UI.
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId]);

  useEffect(() => {
    if (workspace.trashActionState === "trashed") {
      void navigate({ to: "/admin/articles", replace: true });
    }
  }, [navigate, workspace.trashActionState]);

  if (workspace.selected?.id !== articleId) {
    return (
      <main className="page" id="admin-main">
        {loadState === "failed" ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>Article unavailable</Alert.Title>
              <Alert.Description>
                The Article may have moved to Trash, or the request failed.
              </Alert.Description>
              <Button
                className="mt-4"
                type="button"
                variant="secondary"
                onPress={() => void navigate({ to: "/admin/articles" })}
              >
                Back to Articles
              </Button>
            </Alert.Content>
          </Alert>
        ) : (
          <div className="card card-pad row" role="status">
            <Spinner aria-label="Loading Article editor" />
            <span>Loading Article editor…</span>
          </div>
        )}
      </main>
    );
  }

  return (
    <EditorView
      workspace={workspace}
      siteSettings={siteSettings}
      onBack={() => void navigate({ to: "/admin/articles" })}
      onPreviewOpenChange={setPreviewOpen}
    />
  );
}
