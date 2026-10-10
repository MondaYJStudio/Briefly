import { describe, expect, it } from "vitest";

import { channelIntegrationPrompt } from "../src/channels/channel-prompt";

describe("channelIntegrationPrompt", () => {
  it("points the agent at the Channel-filtered public list and detail endpoints", () => {
    const prompt = channelIntegrationPrompt({
      origin: "https://news.example.test/",
      name: "Tech News",
      slug: "tech-news",
      locale: "en",
    });

    expect(prompt).toContain('"Tech News" Channel (slug: tech-news)');
    expect(prompt).toContain(
      "GET https://news.example.test/api/articles?channel=tech-news&limit=20",
    );
    expect(prompt).toContain("GET https://news.example.test/api/articles/{slug}");
    expect(prompt).toContain("https://news.example.test/api/openapi.json");
    expect(prompt).toContain("nextCursor");
    expect(prompt).toContain("ARTICLE_LIST_CURSOR_STALE");
  });

  it("explains how to fetch a single article safely", () => {
    for (const locale of ["en", "zh-CN"]) {
      const prompt = channelIntegrationPrompt({
        origin: "https://news.example.test",
        name: "Tech News",
        slug: "tech-news",
        locale,
      });

      expect(prompt).toContain("encodeURIComponent");
      expect(prompt).toContain('channel.slug');
      expect(prompt).toContain('"tech-news"');
      expect(prompt).toContain("ARTICLE_NOT_FOUND");
      expect(prompt).toContain("ARTICLE_GONE");
      expect(prompt).toContain("308");
    }
  });

  it("percent-encodes non-ASCII slugs in the list URL", () => {
    const prompt = channelIntegrationPrompt({
      origin: "https://news.example.test",
      name: "科技",
      slug: "科技",
      locale: "zh-CN",
    });

    expect(prompt).toContain("「科技」频道（slug: 科技）");
    expect(prompt).toContain(
      `/api/articles?channel=${encodeURIComponent("科技")}&limit=20`,
    );
  });

  it("uses the Chinese template for every zh locale", () => {
    for (const locale of ["zh-CN", "zh-Hans"]) {
      expect(
        channelIntegrationPrompt({
          origin: "https://news.example.test",
          name: "Life",
          slug: "life",
          locale,
        }),
      ).toContain("## 接口");
    }
  });
});
