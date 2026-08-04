import { createFileRoute } from "@tanstack/react-router";

import { TrashView } from "../../components/admin/trash-view";
import { useArticleWorkspace } from "../../components/admin/use-article-workspace";

export const Route = createFileRoute("/admin/trash")({
  component: TrashRoute,
});

function TrashRoute() {
  const workspace = useArticleWorkspace();

  return <TrashView workspace={workspace} />;
}
