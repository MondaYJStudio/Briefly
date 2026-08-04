import { Link, createFileRoute } from "@tanstack/react-router";
import type { CSSProperties } from "react";

import { getApiClient } from "./api.$";
import type { PublicArticleListItem } from "../articles/articles";
import { PublicSiteShell } from "../components/public/public-site-shell";
import type { SiteSettings } from "../site-settings/site-settings";

export const Route = createFileRoute("/zh-CN")({
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
      { items: PublicArticleListItem[] } | undefined;
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
          "A compact, self-hosted publication system.",
      },
    ],
  }),
  component: Home,
});

function revealStyle(index: number): CSSProperties {
  return { "--i": index } as CSSProperties;
}

function publicationDate(iso: string): string {
  // Eden treaty revives ISO date strings into Date objects, so normalize
  // through Date before formatting.
  return new Date(iso).toISOString().slice(0, 10);
}

function currentSeason(): string {
  const month = new Date().getMonth() + 1; // 1-12
  if (month >= 3 && month <= 5) return "春";
  if (month >= 6 && month <= 8) return "夏";
  if (month >= 9 && month <= 11) return "秋";
  return "冬";
}

function issueLine(articleCount: number): string {
  const year = new Date().getFullYear();
  const season = currentSeason();
  return `Vol. ${articleCount} · ${year} 年${season}`;
}

function Home() {
  const { site, articles } = Route.useLoaderData();

  return (
    <PublicSiteShell
      siteName={site.siteName}
      issueLine={issueLine(articles.length)}
      locale="zh-CN"
      variant="home"
    >
      <main>
        {site.siteDescription ? (
          <section
            className="intro reveal"
            style={revealStyle(1)}
            aria-label="站点说明"
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
            <h2 id="index-h">文章</h2>
          </div>
          {articles.length === 0 ? (
            <p className="index__empty">还没有发布的文章。</p>
          ) : (
            <ol className="article-list" reversed>
              {articles.map((article) => (
                <li key={article.id}>
                  <Link
                    className="article-row"
                    to="/articles/$slug"
                    params={{ slug: article.slug }}
                  >
                    <span className="article-row__date" aria-label="发布日期">
                      {publicationDate(article.publishedAt)}
                    </span>
                    <span className="article-row__body">
                      <span
                        className="article-row__meta-date"
                        aria-hidden="true"
                      >
                        {publicationDate(article.publishedAt)} ·{" "}
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
            <h2 id="how-h">核心机制</h2>
          </div>
          <p className="how__note">
            每篇文章对应一份可变草稿和一系列不可变版本。
          </p>
          <table className="spec">
            <tbody>
              <tr>
                <th scope="row">草稿</th>
                <td>持续可编辑的工作副本</td>
                <td className="spec__foot">对外不可见</td>
              </tr>
              <tr>
                <th scope="row">版本</th>
                <td>验证后生成的不可变记录</td>
                <td className="spec__foot">原子性切换为当前版本</td>
              </tr>
              <tr>
                <th scope="row">历史</th>
                <td>完整保留每次修订</td>
                <td className="spec__foot">可回溯至任意版本</td>
              </tr>
              <tr>
                <th scope="row">媒体</th>
                <td>私有资源，永久 URL</td>
                <td className="spec__foot">受控交付</td>
              </tr>
              <tr>
                <th scope="row">部署</th>
                <td>单一 Cloudflare Worker</td>
                <td className="spec__foot">边缘分发，无服务器</td>
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
            <h2 id="console-h">管理界面</h2>
          </div>
          <p>富文本编辑、版本管理与媒体资源。</p>
          <a className="console-link" href="/admin">
            进入控制台
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
