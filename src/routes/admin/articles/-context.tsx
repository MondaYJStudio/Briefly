import {
  createContext,
  useContext,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { Article } from "../../../articles/articles";
import type { SiteSettings } from "../../../site-settings/site-settings";
import type { ArticleWorkspace } from "../../../components/admin/use-article-workspace";

interface ArticlesRouteContextValue {
  workspace: ArticleWorkspace;
  siteSettings: SiteSettings | null;
  previewOpen: boolean;
  setPreviewOpen: Dispatch<SetStateAction<boolean>>;
  previewArticle: (article: Article) => Promise<void>;
}

const ArticlesRouteContext = createContext<ArticlesRouteContextValue | null>(
  null,
);

export const ArticlesRouteContextProvider = ArticlesRouteContext.Provider;

export function useArticlesRouteContext(): ArticlesRouteContextValue {
  const value = useContext(ArticlesRouteContext);
  if (!value) {
    throw new Error(
      "useArticlesRouteContext must be used inside the Articles route",
    );
  }
  return value;
}
