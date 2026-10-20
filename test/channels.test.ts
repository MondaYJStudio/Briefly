import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { initializeAndSignIn } from "./administrator-fixture";

async function resetTables() {
  await env.DB.prepare(
    "UPDATE article SET current_publication_id = NULL",
  ).run();
  await env.DB.prepare("UPDATE article_draft SET channel_slug = NULL").run();
  await env.DB.prepare("DELETE FROM publication_asset_reference").run();
  await env.DB.prepare("DELETE FROM article_draft_asset_reference").run();
  await env.DB.prepare("DELETE FROM publication").run();
  await env.DB.prepare("DELETE FROM article_draft").run();
  await env.DB.prepare("DELETE FROM article_slug").run();
  await env.DB.prepare("DELETE FROM purged_article_slug").run();
  await env.DB.prepare("DELETE FROM article").run();
  await env.DB.prepare("DELETE FROM channel").run();
  await env.DB.prepare("DELETE FROM auth_session").run();
  await env.DB.prepare("DELETE FROM auth_account").run();
  await env.DB.prepare("DELETE FROM auth_user").run();
  await env.DB.prepare("DELETE FROM auth_rate_limit").run();
}

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

async function createChannel(
  cookie: string,
  slug: string,
  name: string,
): Promise<{ id: string; slug: string; name: string }> {
  const created = await SELF.fetch("http://briefly.test/api/admin/channels", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ slug, name }),
  });
  expect(created.status).toBe(201);
  return created.json();
}

async function saveAndPublish(
  cookie: string,
  input: {
    slug: string;
    title: string;
    channelSlug?: string | null;
    tags?: string[];
  },
): Promise<{ id: string; publicationId: string }> {
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
        tags: input.tags ?? [],
        byline: { name: "Public Writer", url: null },
        language: "en",
        channelSlug: input.channelSlug === undefined ? null : input.channelSlug,
        cover: null,
        document: textDocument(`Body for ${input.title}`),
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
  const { publicationId } = await published.json<{ publicationId: string }>();
  return { id, publicationId };
}

describe("Channel registry", () => {
  beforeEach(async () => {
    await resetTables();
  });

  it("creates and lists Channels for the authenticated Administrator", async () => {
    const cookie = await initializeAndSignIn();

    const created = await SELF.fetch("http://briefly.test/api/admin/channels", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ slug: "docs", name: "Documentation" }),
    });
    expect(created.status).toBe(201);
    const channel = await created.json<{
      id: string;
      slug: string;
      name: string;
    }>();
    expect(channel).toMatchObject({ slug: "docs", name: "Documentation" });
    expect(channel.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );

    const listed = await SELF.fetch("http://briefly.test/api/admin/channels", {
      headers: { cookie },
    });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({
      channels: [
        {
          id: channel.id,
          slug: "docs",
          name: "Documentation",
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
      ],
    });
  });

  it("rejects anonymous Channel registry access", async () => {
    const response = await SELF.fetch("http://briefly.test/api/admin/channels");
    expect(response.status).toBe(401);
  });

  it("updates display name but refuses slug changes and deletes while referenced", async () => {
    const cookie = await initializeAndSignIn();
    const channel = await createChannel(cookie, "docs", "Documentation");

    const renamed = await SELF.fetch(
      `http://briefly.test/api/admin/channels/${channel.id}`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ name: "Product Docs" }),
      },
    );
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({
      id: channel.id,
      slug: "docs",
      name: "Product Docs",
    });

    const { id: articleId } = await saveAndPublish(cookie, {
      slug: "channel-guide",
      title: "Channel Guide",
      channelSlug: "docs",
    });

    const blocked = await SELF.fetch(
      `http://briefly.test/api/admin/channels/${channel.id}`,
      { method: "DELETE", headers: { cookie } },
    );
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual({
      status: "error",
      code: "CHANNEL_IN_USE",
      references: {
        draftCount: 1,
        currentPublicationCount: 1,
      },
    });

    const cleared = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${articleId}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          version: 2,
          title: "Channel Guide",
          slug: "channel-guide",
          summary: null,
          tags: [],
          byline: { name: "Public Writer", url: null },
          language: "en",
          channelSlug: null,
          cover: null,
          document: textDocument("Body for Channel Guide"),
        }),
      },
    );
    expect(cleared.status).toBe(200);

    const stillBlocked = await SELF.fetch(
      `http://briefly.test/api/admin/channels/${channel.id}`,
      { method: "DELETE", headers: { cookie } },
    );
    expect(stillBlocked.status).toBe(409);

    const unpublished = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${articleId}/current-publication`,
      { method: "DELETE", headers: { cookie } },
    );
    expect(unpublished.status).toBe(200);

    const deleted = await SELF.fetch(
      `http://briefly.test/api/admin/channels/${channel.id}`,
      { method: "DELETE", headers: { cookie } },
    );
    expect(deleted.status).toBe(204);
  });
});

describe("Channel on Draft, Publish, and public API", () => {
  beforeEach(async () => {
    await resetTables();
  });

  it("filters public lists by Publication Channel and freezes name at Publish", async () => {
    const cookie = await initializeAndSignIn();
    const docs = await createChannel(cookie, "docs", "Documentation");
    await createChannel(cookie, "blog", "Blog");

    await saveAndPublish(cookie, {
      slug: "docs-one",
      title: "Docs One",
      channelSlug: "docs",
    });
    await saveAndPublish(cookie, {
      slug: "blog-one",
      title: "Blog One",
      channelSlug: "blog",
    });
    await saveAndPublish(cookie, {
      slug: "unscoped",
      title: "Unscoped",
      channelSlug: null,
    });

    const all = await SELF.fetch("http://briefly.test/api/articles?limit=20");
    expect(all.status).toBe(200);
    const allPage = await all.json<{
      items: Array<{
        slug: string;
        channel: { slug: string; name: string } | null;
      }>;
    }>();
    expect(allPage.items.map((item) => item.slug).sort()).toEqual([
      "blog-one",
      "docs-one",
      "unscoped",
    ]);
    expect(
      allPage.items.find((item) => item.slug === "docs-one")?.channel,
    ).toEqual({ slug: "docs", name: "Documentation" });
    expect(
      allPage.items.find((item) => item.slug === "unscoped")?.channel,
    ).toBeNull();

    const filtered = await SELF.fetch(
      "http://briefly.test/api/articles?channel=docs",
    );
    expect(filtered.status).toBe(200);
    const filteredPage = await filtered.json<{
      items: Array<{ slug: string }>;
    }>();
    expect(filteredPage.items.map((item) => item.slug)).toEqual(["docs-one"]);

    const unknown = await SELF.fetch(
      "http://briefly.test/api/articles?channel=missing",
    );
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({ items: [], nextCursor: null });

    const detail = await SELF.fetch(
      "http://briefly.test/api/articles/docs-one",
    );
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      slug: "docs-one",
      channel: { slug: "docs", name: "Documentation" },
    });

    const renamed = await SELF.fetch(
      `http://briefly.test/api/admin/channels/${docs.id}`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ name: "Product Docs" }),
      },
    );
    expect(renamed.status).toBe(200);

    const detailAfterRename = await SELF.fetch(
      "http://briefly.test/api/articles/docs-one",
    );
    expect(await detailAfterRename.json()).toMatchObject({
      channel: { slug: "docs", name: "Documentation" },
    });
  });

  it("keeps public Channel filter on the Current Publication until republish", async () => {
    const cookie = await initializeAndSignIn();
    await createChannel(cookie, "docs", "Documentation");
    await createChannel(cookie, "blog", "Blog");

    const { id, publicationId } = await saveAndPublish(cookie, {
      slug: "moving",
      title: "Moving",
      channelSlug: "docs",
    });

    const before = await SELF.fetch(
      "http://briefly.test/api/articles?channel=docs",
    );
    expect(
      (await before.json<{ items: Array<{ slug: string }> }>()).items.map(
        (item) => item.slug,
      ),
    ).toEqual(["moving"]);

    const movedDraft = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${id}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          version: 2,
          title: "Moving",
          slug: "moving",
          summary: null,
          tags: [],
          byline: { name: "Public Writer", url: null },
          language: "en",
          channelSlug: "blog",
          cover: null,
          document: textDocument("Body for Moving"),
        }),
      },
    );
    expect(movedDraft.status).toBe(200);

    const stillDocs = await SELF.fetch(
      "http://briefly.test/api/articles?channel=docs",
    );
    expect(
      (await stillDocs.json<{ items: Array<{ slug: string }> }>()).items.map(
        (item) => item.slug,
      ),
    ).toEqual(["moving"]);

    const republished = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${id}/publications`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          draftVersion: 3,
          expectedCurrentPublicationId: publicationId,
        }),
      },
    );
    expect(republished.status).toBe(201);

    const docsAfter = await SELF.fetch(
      "http://briefly.test/api/articles?channel=docs",
    );
    expect(await docsAfter.json()).toEqual({ items: [], nextCursor: null });

    const blogAfter = await SELF.fetch(
      "http://briefly.test/api/articles?channel=blog",
    );
    expect(
      (await blogAfter.json<{ items: Array<{ slug: string }> }>()).items.map(
        (item) => item.slug,
      ),
    ).toEqual(["moving"]);
  });

  it("filters the admin article list by Draft Channel", async () => {
    const cookie = await initializeAndSignIn();
    await createChannel(cookie, "docs", "Documentation");
    await createChannel(cookie, "blog", "Blog");

    await saveAndPublish(cookie, {
      slug: "docs-one",
      title: "Docs One",
      channelSlug: "docs",
    });
    await saveAndPublish(cookie, {
      slug: "blog-one",
      title: "Blog One",
      channelSlug: "blog",
    });

    const filtered = await SELF.fetch(
      "http://briefly.test/api/admin/articles?channel=docs",
      { headers: { cookie } },
    );
    expect(filtered.status).toBe(200);
    const body = await filtered.json<{
      articles: Array<{
        draft: { slug: string | null; channelSlug: string | null };
      }>;
    }>();
    expect(body.articles.map((article) => article.draft.slug)).toEqual([
      "docs-one",
    ]);
    expect(body.articles[0]?.draft.channelSlug).toBe("docs");
  });
});
