import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { ArticlesView } from "../../../components/admin/articles-view";
import type { Article } from "../../../articles/articles";
import { useArticlesRouteContext } from "./-context";

export const Route = createFileRoute("/admin/articles/")({
  component: ArticlesIndexRoute,
});

function ArticlesIndexRoute() {
  const navigate = useNavigate();
  const { workspace, previewArticle } = useArticlesRouteContext();

  async function createArticle() {
    const article = await workspace.createDraft();
    if (article) {
      await navigate({
        to: "/admin/articles/$articleId",
        params: { articleId: article.id },
      });
    }
  }

  function openArticle(article: Article) {
    void navigate({
      to: "/admin/articles/$articleId",
      params: { articleId: article.id },
    });
  }

  return (
    <ArticlesView
      workspace={workspace}
      onCreate={() => void createArticle()}
      onOpen={openArticle}
      onPreview={(article) => void previewArticle(article)}
    />
  );
}
