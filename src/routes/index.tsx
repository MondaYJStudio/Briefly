import { Link, createFileRoute } from "@tanstack/react-router";
import type { CSSProperties } from "react";

import { getApiClient } from "./api.$";
import type { PublicArticleListItem } from "../articles/articles";
import { PublicSiteShell } from "../components/public/public-site-shell";
import { formatPublicDate } from "../components/public/public-date";
import { m } from "../paraglide/messages.js";
import type { SiteSettings } from "../site-settings/site-settings";

export const Route = createFileRoute("/")({
  loader: async () => {
    const client = getApiClient();
    const [site, articles] = await Promise.all([
      client.site.get(),
      client.articles.get({ query: { limit: "20" } }),
    ]);
    // Public endpoints return raw Response objects, so Eden sees the data as
    // an opaque Response; at runtime the JSON body is already parsed.
    const siteSettings = site.data as unknown as SiteSettings | undefined;
    const page = articles.data as unknown as
      | { items: PublicArticleListItem[] }
      | undefined;
    if (site.error || !siteSettings) {
      throw new Error("Site Settings unavailable");
    }
    if (articles.error || !page) {
      throw new Error("Article list unavailable");
    }
    return { site: siteSettings, articles: page.items };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.site.siteName ?? "Briefly" },
      {
        name: "description",
        content:
          loaderData?.site.siteDescription ??
          "A compact, self-hosted publishing system.",
      },
    ],
  }),
  component: Home,
});

function revealStyle(index: number): CSSProperties {
  return { "--i": index } as CSSProperties;
}

function currentSeasonLabel(): string {
  const month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 5) return m.public_season_spring();
  if (month >= 6 && month <= 8) return m.public_season_summer();
  if (month >= 9 && month <= 11) return m.public_season_autumn();
  return m.public_season_winter();
}

function issueLine(articleCount: number): string {
  return m.public_issue_line({
    count: articleCount,
    season: currentSeasonLabel(),
    year: new Date().getFullYear(),
  });
}

function Home() {
  const { site, articles } = Route.useLoaderData();

  return (
    <PublicSiteShell
      siteName={site.siteName}
      issueLine={issueLine(articles.length)}
      variant="home"
    >
      <main>
        {site.siteDescription ? (
          <section
            className="intro reveal"
            style={revealStyle(1)}
            aria-label={m.public_about_site()}
          >
            <p>{site.siteDescription}</p>
          </section>
        ) : null}

        <section
          className="index reveal"
          style={revealStyle(2)}
          id="index"
          aria-labelledby="index-h"
        >
          <div className="section-head">
            <h2 id="index-h">{m.articles()}</h2>
          </div>
          {articles.length === 0 ? (
            <p className="index__empty">{m.public_no_articles()}</p>
          ) : (
            <ol className="article-list" reversed>
              {articles.map((article) => (
                <li key={article.id}>
                  <Link
                    className="article-row"
                    to="/articles/$slug"
                    params={{ slug: article.slug }}
                  >
                    <span
                      className="article-row__date"
                      aria-label={m.public_publication_date()}
                    >
                      {formatPublicDate(article.publishedAt)}
                    </span>
                    <span className="article-row__body">
                      <span
                        className="article-row__meta-date"
                        aria-hidden="true"
                      >
                        {formatPublicDate(article.publishedAt)} ·{" "}
                      </span>
                      <span className="article-row__title">
                        {article.title}
                      </span>
                      {article.summary ? (
                        <span className="article-row__summary">
                          {article.summary}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section
          className="how reveal"
          style={revealStyle(3)}
          id="how"
          aria-labelledby="how-h"
        >
          <div className="section-head">
            <h2 id="how-h">{m.public_how_it_works()}</h2>
          </div>
          <p className="how__note">{m.public_how_it_works_note()}</p>
          <table className="spec">
            <tbody>
              <tr>
                <th scope="row">{m.public_spec_draft()}</th>
                <td>{m.public_spec_draft_body()}</td>
                <td className="spec__foot">{m.public_spec_draft_foot()}</td>
              </tr>
              <tr>
                <th scope="row">{m.public_spec_publication()}</th>
                <td>{m.public_spec_publication_body()}</td>
                <td className="spec__foot">
                  {m.public_spec_publication_foot()}
                </td>
              </tr>
              <tr>
                <th scope="row">{m.public_spec_history()}</th>
                <td>{m.public_spec_history_body()}</td>
                <td className="spec__foot">{m.public_spec_history_foot()}</td>
              </tr>
              <tr>
                <th scope="row">{m.public_spec_media()}</th>
                <td>{m.public_spec_media_body()}</td>
                <td className="spec__foot">{m.public_spec_media_foot()}</td>
              </tr>
              <tr>
                <th scope="row">{m.public_spec_deployment()}</th>
                <td>{m.public_spec_deployment_body()}</td>
                <td className="spec__foot">
                  {m.public_spec_deployment_foot()}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section
          className="console reveal"
          style={revealStyle(4)}
          id="console"
          aria-labelledby="console-h"
        >
          <div className="section-head">
            <h2 id="console-h">{m.public_publishing_console()}</h2>
          </div>
          <p>{m.public_publishing_console_body()}</p>
          <a className="console-link" href="/admin">
            {m.public_enter_console()}
            <svg
              className="arrow"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2 8h12M10 4l4 4-4 4" />
            </svg>
          </a>
        </section>
      </main>
    </PublicSiteShell>
  );
}
