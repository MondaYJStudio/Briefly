import { createFileRoute, notFound } from "@tanstack/react-router";
import type { CSSProperties } from "react";

import { getApiClient } from "../api.$";
import type { PublicArticle } from "../../articles/articles";
import { PublicSiteShell } from "../../components/public/public-site-shell";
import {
  formatPublicDate,
  publicationTimestamp,
} from "../../components/public/public-date";
import { m } from "../../paraglide/messages.js";
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

function MetaSep() {
  return (
    <span className="article-header__sep" aria-hidden="true">
      ·
    </span>
  );
}

function ArticleUnavailable() {
  return (
    <PublicSiteShell siteName="Briefly" variant="interior">
      <main className="reading">
        <section className="unavailable reveal" style={revealStyle(1)}>
          <div className="section-head">
            <h2>{m.public_article_unavailable()}</h2>
          </div>
          <p>{m.public_article_unavailable_body()}</p>
        </section>
      </main>
    </PublicSiteShell>
  );
}

function ArticlePage() {
  const { site, article } = Route.useLoaderData();
  const publishedLabel = formatPublicDate(article.publishedAt);
  const updatedLabel = formatPublicDate(article.updatedAt);
  const updated = updatedLabel !== publishedLabel;

  return (
    <PublicSiteShell siteName={site.siteName} variant="interior">
      <main className="reading">
        <article lang={article.language}>
          <header className="article-header reveal" style={revealStyle(1)}>
            <h1 className="article-header__title">{article.title}</h1>
            <hr className="article-header__rule" aria-hidden="true" />
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
                {m.public_published()}{" "}
                <time dateTime={publicationTimestamp(article.publishedAt)}>
                  {publishedLabel}
                </time>
              </span>
              {updated ? (
                <>
                  <MetaSep />
                  <span>
                    {m.public_updated()}{" "}
                    <time dateTime={publicationTimestamp(article.updatedAt)}>
                      {updatedLabel}
                    </time>
                  </span>
                </>
              ) : null}
              {article.tags.length > 0 ? (
                <>
                  <span className="article-header__meta-pipe" aria-hidden="true">
                    |
                  </span>
                  <span className="article-header__tags">
                    {article.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </span>
                </>
              ) : null}
            </p>
            {article.summary ? (
              <p className="article-header__summary">{article.summary}</p>
            ) : null}
          </header>
          <div
            className="article-body reveal"
            style={revealStyle(2)}
            // Publication HTML is authored by the sole Administrator and
            // rendered server-side into semantic markup at publish time.
            dangerouslySetInnerHTML={{ __html: article.html }}
          />
        </article>
      </main>
    </PublicSiteShell>
  );
}
