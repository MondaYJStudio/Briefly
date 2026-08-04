import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import type { CSSProperties } from "react";

import { getApiClient } from "../api.$";
import type { PublicArticle } from "../../articles/articles";
import { PublicSiteShell } from "../../components/public/public-site-shell";
import type { SiteSettings } from "../../site-settings/site-settings";

export const Route = createFileRoute("/articles/$slug")({
  loader: async ({ params }) => {
    const client = getApiClient();
    const [site, article] = await Promise.all([
      client.site.get(),
      client.articles({ slug: params.slug }).get(),
    ]);
    // Public endpoints return raw Response objects, so Eden sees the data as
    // an opaque Response; at runtime the JSON body is already parsed.
    const siteSettings = site.data as unknown as SiteSettings | undefined;
    const detail = article.data as unknown as PublicArticle | undefined;
    if (site.error || !siteSettings) {
      throw new Error("Site Settings unavailable");
    }
    if (article.status === 404 || article.status === 410) {
      throw notFound();
    }
    if (article.error || !detail) {
      throw new Error("Article unavailable");
    }
    return { site: siteSettings, article: detail };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `${loaderData.article.title} · ${loaderData.site.siteName}`
          : "Briefly",
      },
      ...(loaderData?.article.summary
        ? [{ name: "description", content: loaderData.article.summary }]
        : []),
    ],
  }),
  notFoundComponent: ArticleUnavailable,
  component: ArticlePage,
});

function revealStyle(index: number): CSSProperties {
  return { "--i": index } as CSSProperties;
}

function publicationDate(iso: string): string {
  // Eden treaty revives ISO date strings into Date objects, so normalize
  // through Date before formatting.
  return new Date(iso).toISOString().slice(0, 10);
}

function publicationTimestamp(iso: string): string {
  return new Date(iso).toISOString();
}

function ArticleUnavailable() {
  return (
    <PublicSiteShell siteName="Briefly" variant="interior">
      <main>
        <Link className="back-link" to="/">
          ← 返回首页
        </Link>
        <section className="unavailable reveal" style={revealStyle(1)}>
          <div className="section-head">
            <h2>文章不可用</h2>
          </div>
          <p>这篇文章不存在，或者当前没有对外发布。</p>
        </section>
      </main>
    </PublicSiteShell>
  );
}

function ArticlePage() {
  const { site, article } = Route.useLoaderData();
  const updated =
    publicationDate(article.updatedAt) !== publicationDate(article.publishedAt);

  return (
    <PublicSiteShell siteName={site.siteName} variant="interior">
      <main>
        <Link className="back-link reveal" style={revealStyle(1)} to="/">
          ← 返回首页
        </Link>
        <article lang={article.language}>
          <header className="article-header reveal" style={revealStyle(2)}>
            <h1 className="article-header__title">{article.title}</h1>
            <p className="article-header__meta">
              <span>
                {article.byline.url ? (
                  <a
                    href={article.byline.url}
                    rel="author"
                    target="_blank"
                    referrerPolicy="no-referrer"
                  >
                    {article.byline.name}
                  </a>
                ) : (
                  article.byline.name
                )}
              </span>
              <span>
                发布于{" "}
                <time dateTime={publicationTimestamp(article.publishedAt)}>
                  {publicationDate(article.publishedAt)}
                </time>
              </span>
              {updated ? (
                <span>
                  更新于{" "}
                  <time dateTime={publicationTimestamp(article.updatedAt)}>
                    {publicationDate(article.updatedAt)}
                  </time>
                </span>
              ) : null}
            </p>
            {article.summary ? (
              <p className="article-header__summary">{article.summary}</p>
            ) : null}
          </header>
          <div
            className="article-body reveal"
            style={revealStyle(3)}
            // Publication HTML is authored by the sole Administrator and
            // rendered server-side into semantic markup at publish time.
            dangerouslySetInnerHTML={{ __html: article.html }}
          />
        </article>
      </main>
    </PublicSiteShell>
  );
}
