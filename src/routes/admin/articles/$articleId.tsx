import { Alert, Button, Spinner } from "@heroui/react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EditorView } from "../../../components/admin/editor-view";
import pageStyles from "../../../components/admin/articles-view.module.css";
import { m } from "../../../paraglide/messages.js";
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
      <main
        className={`flex min-w-0 flex-1 flex-col max-w-6xl w-full mx-auto pt-8 px-10 pb-16 max-[860px]:pt-5 max-[860px]:px-4 max-[860px]:pb-12`}
        id="admin-main"
      >
        {loadState === "failed" ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>{m.article_unavailable()}</Alert.Title>
              <Alert.Description>
                {m.article_unavailable_description()}
              </Alert.Description>
              <Button
                className={`mt-4`}
                type="button"
                variant="secondary"
                onPress={() => void navigate({ to: "/admin/articles" })}
              >
                {m.back_to_articles()}
              </Button>
            </Alert.Content>
          </Alert>
        ) : (
          <div
            className={`${pageStyles.card} p-6 flex items-center gap-3`}
            role="status"
          >
            <Spinner aria-label={m.loading_article_editor()} />
            <span>{m.loading_article_editor_ellipsis()}</span>
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
