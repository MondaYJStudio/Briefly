import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { initializeAndSignIn } from "./administrator-fixture";

function textDocument(text: string) {
  return {
    documentSchemaVersion: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text }],
        },
      ],
    },
  };
}

async function publishArticle(
  cookie: string,
  input: {
    slug: string;
    title: string;
    language: string;
    body: string;
    bylineName: string;
  },
): Promise<void> {
  const created = await SELF.fetch("http://briefly.test/api/admin/articles", {
    method: "POST",
    headers: { cookie },
  });
  expect(created.status).toBe(201);
  const { id } = await created.json<{ id: string }>();

  const saved = await SELF.fetch(
    `http://briefly.test/api/admin/articles/${id}/draft`,
    {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        title: input.title,
        slug: input.slug,
        summary: null,
        tags: [],
        byline: { name: input.bylineName, url: null },
        language: input.language,
        cover: null,
        document: textDocument(input.body),
      }),
    },
  );
  expect(saved.status).toBe(200);

  const published = await SELF.fetch(
    `http://briefly.test/api/admin/articles/${id}/publications`,
    {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        draftVersion: 2,
        expectedCurrentPublicationId: null,
      }),
    },
  );
  expect(published.status).toBe(201);
}

describe("public Interface Locale routes", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("UPDATE article SET current_publication_id = NULL"),
      env.DB.prepare("DELETE FROM publication"),
      env.DB.prepare("DELETE FROM article_draft"),
      env.DB.prepare("DELETE FROM article"),
      env.DB.prepare("DELETE FROM auth_session"),
      env.DB.prepare("DELETE FROM auth_account"),
      env.DB.prepare("DELETE FROM auth_user"),
      env.DB.prepare("DELETE FROM auth_rate_limit"),
      env.DB.prepare(
        "UPDATE installation SET state = 'uninitialized', initialized_at = NULL WHERE id = 1",
      ),
      env.DB.prepare(
        `UPDATE site_settings
         SET site_name = 'Briefly',
             site_description = 'A modern, self-hosted content engine.',
             default_byline_name = 'Briefly', default_byline_url = NULL,
             default_language = 'en'
         WHERE id = 1`,
      ),
    ]);
  });

  it("serves English article-reading chrome at the unprefixed path", async () => {
    const cookie = await initializeAndSignIn();
    await publishArticle(cookie, {
      slug: "locale-reading",
      title: "Locale Reading Title",
      language: "fr",
      body: "Contenu français distinct.",
      bylineName: "Public Writer",
    });

    const response = await SELF.fetch(
      "http://briefly.test/articles/locale-reading",
    );
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).toContain('<html lang="en"');
    expect(html).toMatch(/masthead__name"><a href="\/"/);
    expect(html).not.toContain("Back to home");
    expect(html).toContain("Published");
    const englishDate = html.match(
      /Published(?:<!--\s*-->)?\s*<time dateTime="([^"]+)">([^<]+)<\/time>/,
    );
    expect(englishDate).toBeTruthy();
    expect(englishDate![2]).toBe(
      new Intl.DateTimeFormat("en", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(new Date(englishDate![1])),
    );
    expect(html).not.toContain("返回首页");
    expect(html).not.toContain("发布于");
    expect(html).toContain('lang="fr"');
    expect(html).toContain("Locale Reading Title");
    expect(html).toContain("Public Writer");
    expect(html).toContain("Contenu français distinct.");
  });

  it("serves Chinese article-reading chrome at the locale-prefixed path", async () => {
    const cookie = await initializeAndSignIn();
    await publishArticle(cookie, {
      slug: "locale-reading-zh",
      title: "中文壳层标题",
      language: "en",
      body: "English body stays English.",
      bylineName: "Public Writer",
    });

    const response = await SELF.fetch(
      "http://briefly.test/zh-CN/articles/locale-reading-zh",
    );
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).toContain('<html lang="zh-CN"');
    expect(html).toMatch(/masthead__name"><a href="\/zh-CN\/?"/);
    expect(html).not.toContain("返回首页");
    expect(html).toContain("发布于");
    const chineseDate = html.match(
      /发布于(?:<!--\s*-->)?\s*<time dateTime="([^"]+)">([^<]+)<\/time>/,
    );
    expect(chineseDate).toBeTruthy();
    expect(chineseDate![2]).toBe(
      new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(new Date(chineseDate![1])),
    );
    expect(html).not.toContain("Back to home");
    expect(html).toContain('lang="en"');
    expect(html).toContain("中文壳层标题");
    expect(html).toContain("English body stays English.");
  });

  it("localizes missing-Article chrome on both locale URLs", async () => {
    const english = await SELF.fetch(
      "http://briefly.test/articles/does-not-exist",
    );
    expect(english.status).toBe(404);
    const englishHtml = await english.text();
    expect(englishHtml).toContain('<html lang="en"');
    expect(englishHtml).toContain("Article unavailable");
    expect(englishHtml).toMatch(/masthead__name"><a href="\/"/);
    expect(englishHtml).not.toContain("Back to home");

    const chinese = await SELF.fetch(
      "http://briefly.test/zh-CN/articles/does-not-exist",
    );
    expect(chinese.status).toBe(404);
    const chineseHtml = await chinese.text();
    expect(chineseHtml).toContain('<html lang="zh-CN"');
    expect(chineseHtml).toContain("文章不可用");
    expect(chineseHtml).toMatch(/masthead__name"><a href="\/zh-CN\/?"/);
    expect(chineseHtml).not.toContain("返回首页");
  });

  it("localizes the home chrome for both locale URLs", async () => {
    const english = await SELF.fetch("http://briefly.test/");
    expect(english.status).toBe(200);
    const englishHtml = await english.text();
    expect(englishHtml).toContain('<html lang="en"');
    expect(englishHtml).toContain("How it works");
    expect(englishHtml).toContain("No articles have been published yet.");
    expect(englishHtml).not.toContain("核心机制");

    const chinese = await SELF.fetch("http://briefly.test/zh-CN");
    expect(chinese.status).toBe(200);
    const chineseHtml = await chinese.text();
    expect(chineseHtml).toContain('<html lang="zh-CN"');
    expect(chineseHtml).toContain("核心机制");
    expect(chineseHtml).toContain("还没有发布的文章。");
    expect(chineseHtml).not.toContain("How it works");
  });
});
