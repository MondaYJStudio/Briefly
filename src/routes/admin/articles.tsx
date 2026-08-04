import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState } from "react";

import { useAdminContext } from "../../components/admin/admin-context";
import { PreviewDrawer } from "../../components/admin/editor-view";
import { useArticleWorkspace } from "../../components/admin/use-article-workspace";
import type { Article } from "../../articles/articles";
import { ArticlesRouteContextProvider } from "./articles/-context";

export const Route = createFileRoute("/admin/articles")({
  component: ArticlesLayout,
});

function ArticlesLayout() {
  const { siteSettings } = useAdminContext();
  const workspace = useArticleWorkspace();
  const [previewOpen, setPreviewOpen] = useState(false);

  async function previewArticle(article: Article) {
    const loaded = await workspace.loadDraft(article.id);
    if (!loaded) return;
    setPreviewOpen(true);
    await workspace.previewSavedDraft();
  }

  return (
    <ArticlesRouteContextProvider
      value={{
        workspace,
        siteSettings,
        previewOpen,
        setPreviewOpen,
        previewArticle,
      }}
    >
      <Outlet />
      <PreviewDrawer
        workspace={workspace}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />
    </ArticlesRouteContextProvider>
  );
}
