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
         SET site_name = 'Briefly', site_description = NULL,
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
        body: JSON.stringify({ version: 2 }),
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
      rendererVersion: 1,
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

  it("returns an actionable issue for an invalid unsaved Draft Version", async () => {
    const cookie = await initializeAndSignIn();
    const created = await (
      await SELF.fetch("http://briefly.test/api/admin/articles", {
        method: "POST",
        headers: { cookie },
      })
    ).json<{ id: string }>();

    const response = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${created.id}/preview`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ version: 0 }),
      },
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      status: "error",
      code: "ARTICLE_PREVIEW_INVALID",
      issues: [
        {
          code: "INVALID_DRAFT_VERSION",
          path: "version",
          message: "Draft Version must be a positive integer",
        },
      ],
    });
  }, 15_000);

  it("returns every incomplete publication-context issue without partial HTML", async () => {
    const cookie = await initializeAndSignIn();
    const created = await (
      await SELF.fetch("http://briefly.test/api/admin/articles", {
        method: "POST",
        headers: { cookie },
      })
    ).json<{ id: string }>();

    const response = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${created.id}/preview`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ version: 1 }),
      },
    );

    expect(response.status).toBe(400);
    const failure = await response.json();
    expect(failure).toEqual({
      status: "error",
      code: "ARTICLE_PREVIEW_INVALID",
      issues: [
        {
          code: "TITLE_REQUIRED",
          path: "metadata.title",
          message: "A title is required",
        },
        {
          code: "SLUG_REQUIRED",
          path: "metadata.slug",
          message: "A slug is required",
        },
        {
          code: "BODY_REQUIRED",
          path: "doc",
          message: "Substantive body content is required",
        },
      ],
    });
    expect(JSON.stringify(failure)).not.toContain("html");
  }, 15_000);

  it("returns a content-safe structured issue for an invalid saved document envelope", async () => {
    const cookie = await initializeAndSignIn();
    const created = await (
      await SELF.fetch("http://briefly.test/api/admin/articles", {
        method: "POST",
        headers: { cookie },
      })
    ).json<{ id: string }>();
    const privateBody = "private Draft body must not escape";
    const saved = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${created.id}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          title: "Invalid saved Draft",
          slug: "invalid-saved-draft",
          summary: null,
          tags: [],
          byline: null,
          language: null,
          document: {
            documentSchemaVersion: 1,
            doc: { type: "doc", content: [{ type: "paragraph" }] },
          },
        }),
      },
    );
    expect(saved.status).toBe(200);
    await env.DB.prepare(
      "UPDATE article_draft SET document = ? WHERE article_id = ?",
    )
      .bind(`{"privateBody":${JSON.stringify(privateBody)}}`, created.id)
      .run();

    const response = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${created.id}/preview`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ version: 2 }),
      },
    );

    expect(response.status).toBe(400);
    const responseText = await response.text();
    expect(JSON.parse(responseText)).toEqual({
      status: "error",
      code: "ARTICLE_PREVIEW_INVALID",
      issues: [
        {
          code: "INVALID_SAVED_DRAFT",
          path: "draft.document",
          message: "The saved Draft document envelope is invalid",
        },
      ],
    });
    expect(responseText).not.toContain(privateBody);
    expect(responseText).not.toContain("html");
    expect(responseText).not.toContain(cookie);
  }, 15_000);

  it("identifies invalid saved metadata without misreporting the document", async () => {
    const cookie = await initializeAndSignIn();
    const created = await (
      await SELF.fetch("http://briefly.test/api/admin/articles", {
        method: "POST",
        headers: { cookie },
      })
    ).json<{ id: string }>();
    await env.DB.prepare(
      "UPDATE article_draft SET byline = ? WHERE article_id = ?",
    )
      .bind(JSON.stringify({ name: "", url: null }), created.id)
      .run();

    const response = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${created.id}/preview`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ version: 1 }),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      status: "error",
      code: "ARTICLE_PREVIEW_INVALID",
      issues: [
        {
          code: "INVALID_SAVED_DRAFT",
          path: "metadata.byline",
          message: "The saved Draft metadata is invalid",
        },
      ],
    });
  }, 15_000);

  it("returns a structured issue when Site Settings cannot resolve preview metadata", async () => {
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
          title: "Missing defaults",
          slug: "missing-defaults",
          summary: null,
          tags: [],
          byline: null,
          language: null,
          document: {
            documentSchemaVersion: 1,
            doc: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Saved text" }],
                },
              ],
            },
          },
        }),
      },
    );
    expect(saved.status).toBe(200);
    await env.DB.prepare(
      "UPDATE site_settings SET default_byline_name = '' WHERE id = 1",
    ).run();

    const response = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${created.id}/preview`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ version: 2 }),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      status: "error",
      code: "ARTICLE_PREVIEW_INVALID",
      issues: [
        {
          code: "INVALID_SITE_SETTINGS",
          path: "metadata",
          message: "Site Settings cannot resolve preview metadata",
        },
      ],
    });
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
            body: JSON.stringify({ version: 2 }),
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
            body: JSON.stringify({ version: 1 }),
          },
        ),
        status: 404,
        code: "ARTICLE_NOT_FOUND",
      },
      ...[1, 3].map((version) => ({
        response: SELF.fetch(
          `http://briefly.test/api/admin/articles/${created.id}/preview`,
          {
            method: "POST",
            headers: { cookie, "content-type": "application/json" },
            body: JSON.stringify({ version }),
          },
        ),
        status: 409,
        code: "ARTICLE_DRAFT_VERSION_CONFLICT",
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

  it("uses saved Article Byline and language overrides instead of changed defaults", async () => {
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
          title: "Overridden metadata",
          slug: "overridden-metadata",
          summary: null,
          tags: [],
          byline: {
            name: "Guest Writer",
            url: "https://guest.example.com/profile",
          },
          language: "fr-CA",
          document: {
            documentSchemaVersion: 1,
            doc: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Texte enregistré" }],
                },
              ],
            },
          },
        }),
      },
    );
    expect(saved.status).toBe(200);
    await env.DB.prepare(
      `UPDATE site_settings
       SET default_byline_name = 'Changed Default', default_byline_url = NULL,
           default_language = 'de'
       WHERE id = 1`,
    ).run();

    const response = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${created.id}/preview`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ version: 2 }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      draftVersion: 2,
      metadata: {
        byline: {
          name: "Guest Writer",
          url: "https://guest.example.com/profile",
        },
        language: "fr-CA",
      },
      html: "<p>Texte enregistré</p>",
    });
  }, 15_000);

  it("returns renderer issues without partial HTML", async () => {
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
          title: "Unsafe link",
          slug: "unsafe-link",
          summary: null,
          tags: [],
          byline: null,
          language: null,
        }),
      },
    );
    expect(saved.status).toBe(200);
    await env.DB.prepare(
      "UPDATE article_draft SET document = ? WHERE article_id = ?",
    )
      .bind(
        JSON.stringify({
          documentSchemaVersion: 1,
          doc: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Private text",
                    marks: [
                      {
                        type: "link",
                        attrs: { href: "javascript:alert(1)" },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        }),
        created.id,
      )
      .run();

    const response = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${created.id}/preview`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ version: 2 }),
      },
    );

    expect(response.status).toBe(400);
    const failure = await response.json();
    expect(failure).toEqual({
      status: "error",
      code: "ARTICLE_PREVIEW_INVALID",
      issues: [
        {
          code: "UNSAFE_LINK",
          path: "doc.content.0.content.0.marks.0.attrs.href",
          message: "Link must use an allowed absolute URL protocol",
        },
      ],
    });
    expect(JSON.stringify(failure)).not.toContain("html");
  }, 15_000);

  it("returns unsupported-schema and invalid-structure renderer issues through HTTP", async () => {
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
          title: "Renderer validation",
          slug: "renderer-validation",
          summary: null,
          tags: [],
          byline: null,
          language: null,
        }),
      },
    );
    expect(saved.status).toBe(200);

    const cases = [
      {
        document: {
          documentSchemaVersion: 99,
          doc: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Unsupported version" }],
              },
            ],
          },
        },
        issue: {
          code: "UNSUPPORTED_DOCUMENT_SCHEMA_VERSION",
          path: "documentSchemaVersion",
          message: "Document Schema Version 99 is not supported",
        },
      },
      {
        document: {
          documentSchemaVersion: 1,
          doc: {
            type: "doc",
            content: [
              {
                type: "bulletList",
                content: [
                  {
                    type: "listItem",
                    content: [
                      {
                        type: "heading",
                        attrs: { level: 2 },
                        content: [
                          { type: "text", text: "Invalid list nesting" },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
        issue: {
          code: "INVALID_DOCUMENT_STRUCTURE",
          path: "doc",
          message: "Document content does not satisfy the Publication schema",
        },
      },
    ];

    for (const fixture of cases) {
      await env.DB.prepare(
        "UPDATE article_draft SET document = ? WHERE article_id = ?",
      )
        .bind(JSON.stringify(fixture.document), created.id)
        .run();
      const response = await SELF.fetch(
        `http://briefly.test/api/admin/articles/${created.id}/preview`,
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ version: 2 }),
        },
      );

      expect(response.status).toBe(400);
      const failure = await response.json();
      expect(failure).toEqual({
        status: "error",
        code: "ARTICLE_PREVIEW_INVALID",
        issues: [fixture.issue],
      });
      expect(JSON.stringify(failure)).not.toContain("html");
    }
  }, 15_000);

  it("presents a route-local control for previewing only a saved Draft Version", async () => {
    const cookie = await initializeAndSignIn();

    const response = await SELF.fetch("http://briefly.test/admin", {
      headers: { cookie },
    });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Saved Draft Preview");
    expect(html).toContain(
      "Select an Article to preview an exact server-confirmed Draft Version.",
    );
  }, 15_000);
});
