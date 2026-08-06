import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import type { AdminArticleListItem } from "../src/articles/articles";
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

async function createArticle(cookie: string): Promise<string> {
  const response = await SELF.fetch("http://briefly.test/api/admin/articles", {
    method: "POST",
    headers: { cookie },
  });
  expect(response.status).toBe(201);
  return (await response.json<{ id: string }>()).id;
}

async function saveDraft(
  cookie: string,
  articleId: string,
  input: {
    version: number;
    title: string;
    slug: string;
    summary?: string | null;
    tags?: string[];
    byline?: { name: string; url: string | null } | null;
    language?: string | null;
    document?: unknown;
  },
): Promise<number> {
  const response = await SELF.fetch(
    `http://briefly.test/api/admin/articles/${articleId}/draft`,
    {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        summary: null,
        tags: [],
        byline: null,
        language: null,
        document: textDocument(input.title),
        ...input,
      }),
    },
  );
  expect(response.status).toBe(200);
  return (await response.json<{ draft: { version: number } }>()).draft.version;
}

async function publish(
  cookie: string,
  articleId: string,
  draftVersion: number,
  expectedCurrentPublicationId: string | null,
): Promise<string> {
  const response = await SELF.fetch(
    `http://briefly.test/api/admin/articles/${articleId}/publications`,
    {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ draftVersion, expectedCurrentPublicationId }),
    },
  );
  expect(response.status).toBe(201);
  return (await response.json<{ publicationId: string }>()).publicationId;
}

async function unpublish(cookie: string, articleId: string): Promise<void> {
  const response = await SELF.fetch(
    `http://briefly.test/api/admin/articles/${articleId}/current-publication`,
    { method: "DELETE", headers: { cookie } },
  );
  expect(response.status).toBe(200);
}

async function listArticles(cookie: string): Promise<AdminArticleListItem[]> {
  const response = await SELF.fetch("http://briefly.test/api/admin/articles", {
    headers: { cookie },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json<{ articles: AdminArticleListItem[] }>();
  return body.articles;
}

describe("Admin Article list lifecycle projection", () => {
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
             site_description = 'A modern, self-hosted content engine with editable drafts and an immutable version history.',
             default_byline_name = 'Briefly', default_byline_url = NULL,
             default_language = 'en'
         WHERE id = 1`,
      ),
    ]);
  });

  it("projects Draft, Published, Changes pending, and Unpublished without a persisted status column", async () => {
    const cookie = await initializeAndSignIn();

    const draftId = await createArticle(cookie);
    await saveDraft(cookie, draftId, {
      version: 1,
      title: "Never published",
      slug: "never-published",
    });

    const publishedId = await createArticle(cookie);
    const publishedVersion = await saveDraft(cookie, publishedId, {
      version: 1,
      title: "Live and matching",
      slug: "live-and-matching",
    });
    await publish(cookie, publishedId, publishedVersion, null);

    const pendingId = await createArticle(cookie);
    const pendingPublishVersion = await saveDraft(cookie, pendingId, {
      version: 1,
      title: "Will diverge",
      slug: "will-diverge",
    });
    const pendingPublicationId = await publish(
      cookie,
      pendingId,
      pendingPublishVersion,
      null,
    );
    await saveDraft(cookie, pendingId, {
      version: pendingPublishVersion,
      title: "Already diverged",
      slug: "will-diverge",
    });

    const unpublishedId = await createArticle(cookie);
    const unpublishedVersion = await saveDraft(cookie, unpublishedId, {
      version: 1,
      title: "Was public",
      slug: "was-public",
    });
    await publish(cookie, unpublishedId, unpublishedVersion, null);
    await unpublish(cookie, unpublishedId);

    const articles = await listArticles(cookie);
    const byId = Object.fromEntries(
      articles.map((article) => [article.id, article]),
    );

    expect(byId[draftId]?.lifecycleProjection).toBe("draft");
    expect(byId[publishedId]?.lifecycleProjection).toBe("published");
    expect(byId[pendingId]?.lifecycleProjection).toBe("changes-pending");
    expect(byId[unpublishedId]?.lifecycleProjection).toBe("unpublished");

    expect(byId[pendingId]?.currentPublicationId).toBe(pendingPublicationId);
    expect(byId[unpublishedId]?.currentPublicationId).toBeNull();
  }, 30_000);

  it("marks Changes pending when inherited Site Settings diverge from the Current Publication", async () => {
    const cookie = await initializeAndSignIn();
    const articleId = await createArticle(cookie);
    const draftVersion = await saveDraft(cookie, articleId, {
      version: 1,
      title: "Inherits defaults",
      slug: "inherits-defaults",
      byline: null,
      language: null,
    });
    await publish(cookie, articleId, draftVersion, null);

    expect(
      (await listArticles(cookie)).find((article) => article.id === articleId)
        ?.lifecycleProjection,
    ).toBe("published");

    const settingsUpdate = await SELF.fetch(
      "http://briefly.test/api/admin/site-settings",
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          siteName: "Briefly",
          siteDescription:
            "A modern, self-hosted content engine with editable drafts and an immutable version history.",
          defaultByline: {
            name: "Editorial Desk",
            url: "https://example.com/desk",
          },
          defaultLanguage: "en",
        }),
      },
    );
    expect(settingsUpdate.status).toBe(200);

    const listed = await listArticles(cookie);
    expect(
      listed.find((article) => article.id === articleId)?.lifecycleProjection,
    ).toBe("changes-pending");
  }, 30_000);
});
