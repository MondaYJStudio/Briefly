import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { ArticlesView } from "../../../components/admin/articles-view";
import type { Article } from "../../../articles/articles";
import { useArticlesRouteContext } from "./-context";

const articlesSearchSchema = z.object({
  channel: z.string().min(1).optional(),
});

export const Route = createFileRoute("/admin/articles/")({
  validateSearch: (search) => articlesSearchSchema.parse(search),
  component: ArticlesIndexRoute,
});

function ArticlesIndexRoute() {
  const navigate = useNavigate();
  const { channel } = Route.useSearch();
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
      channelFilter={channel ?? null}
      onChannelFilterChange={(next) => {
        void navigate({
          to: "/admin/articles",
          search: next ? { channel: next } : {},
        });
      }}
      onCreate={() => void createArticle()}
      onOpen={openArticle}
      onPreview={(article) => void previewArticle(article)}
    />
  );
}
