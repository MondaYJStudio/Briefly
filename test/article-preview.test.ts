import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { initializeAndSignIn } from "./administrator-fixture";

describe("private saved Draft preview", () => {
  beforeEach(async () => {
    await env.DB.batch([
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
             site_description = 'A modern, self-hosted content engine with editable drafts and an immutable version history.',
             default_byline_name = 'Briefly', default_byline_url = NULL,
             default_language = 'en'
         WHERE id = 1`,
      ),
    ]);
  });

  it("renders the requested saved text Draft with resolved metadata and no public side effects", async () => {
    const cookie = await initializeAndSignIn();
    const settings = await SELF.fetch(
      "http://briefly.test/api/admin/site-settings",
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          siteName: "Briefly",
          siteDescription: null,
          defaultByline: {
            name: "Default Writer",
            url: "https://example.com/writers/default",
          },
          defaultLanguage: "zh-Hans",
        }),
      },
    );
    expect(settings.status).toBe(200);

    const created = await (
      await SELF.fetch("http://briefly.test/api/admin/articles", {
        method: "POST",
        headers: { cookie },
      })
    ).json<{ id: string }>();
    const saved = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${created.id}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          title: "Saved preview",
          slug: "saved-preview",
          summary: "The server-confirmed Draft",
          tags: ["Preview"],
          byline: null,
          language: null,
          document: {
            documentSchemaVersion: 1,
            doc: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Server-confirmed <Draft>" }],
                },
              ],
            },
          },
        }),
      },
    );
    expect(saved.status).toBe(200);

    const before = await (
      await SELF.fetch(`http://briefly.test/api/admin/articles/${created.id}`, {
        headers: { cookie },
      })
    ).json();
    const response = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${created.id}/preview`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ draftVersion: 2 }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(await response.json()).toEqual({
      articleId: created.id,
      draftVersion: 2,
      documentSchemaVersion: 1,
      metadata: {
        title: "Saved preview",
        slug: "saved-preview",
        summary: "The server-confirmed Draft",
        tags: ["preview"],
        byline: {
          name: "Default Writer",
          url: "https://example.com/writers/default",
        },
        language: "zh-Hans",
      },
      rendererVersion: 3,
      coverHtml: null,
      html: "<p>Server-confirmed &lt;Draft&gt;</p>",
    });
    const after = await (
      await SELF.fetch(`http://briefly.test/api/admin/articles/${created.id}`, {
        headers: { cookie },
      })
    ).json();
    expect(after).toEqual(before);
  }, 15_000);

  it("independently rejects unauthorized, unknown, stale, and future version requests", async () => {
    const cookie = await initializeAndSignIn();
    const created = await (
      await SELF.fetch("http://briefly.test/api/admin/articles", {
        method: "POST",
        headers: { cookie },
      })
    ).json<{ id: string }>();
    const saved = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${created.id}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          title: "Version selection",
          slug: "version-selection",
          summary: null,
          tags: [],
          byline: null,
          language: null,
        }),
      },
    );
    expect(saved.status).toBe(200);

    const requests = [
      {
        response: SELF.fetch(
          `http://briefly.test/api/admin/articles/${created.id}/preview`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ draftVersion: 2 }),
          },
        ),
        status: 401,
        code: "AUTHENTICATION_REQUIRED",
      },
      {
        response: SELF.fetch(
          "http://briefly.test/api/admin/articles/00000000-0000-4000-8000-000000000000/preview",
          {
            method: "POST",
            headers: { cookie, "content-type": "application/json" },
            body: JSON.stringify({ draftVersion: 1 }),
          },
        ),
        status: 404,
        code: "ARTICLE_NOT_FOUND",
      },
      ...[1, 3].map((draftVersion) => ({
        response: SELF.fetch(
          `http://briefly.test/api/admin/articles/${created.id}/preview`,
          {
            method: "POST",
            headers: { cookie, "content-type": "application/json" },
            body: JSON.stringify({ draftVersion }),
          },
        ),
        status: 409,
        code: "PUBLICATION_CONFLICT",
      })),
    ];

    for (const request of requests) {
      const response = await request.response;
      expect(response.status).toBe(request.status);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const failure = await response.json<{
        status: string;
        code: string;
      }>();
      expect(failure).toEqual({ status: "error", code: request.code });
      expect(JSON.stringify(failure)).not.toContain("html");
    }
  }, 15_000);

  it("serves the Article editor route while client-side preview controls load", async () => {
    const cookie = await initializeAndSignIn();
    const article = await (
      await SELF.fetch("http://briefly.test/api/admin/articles", {
        method: "POST",
        headers: { cookie },
      })
    ).json<{ id: string }>();

    const response = await SELF.fetch(
      `http://briefly.test/admin/articles/${article.id}`,
      { headers: { cookie } },
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(html).toContain("Loading Article editor");
  }, 30_000);
});
