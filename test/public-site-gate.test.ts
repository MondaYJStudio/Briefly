import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { initializeAndSignIn } from "./administrator-fixture";
import { uploadOnePixelPngAsset } from "./asset-fixture";

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

async function readAdminSiteSettings(cookie: string) {
  const response = await SELF.fetch(
    "http://briefly.test/api/admin/site-settings",
    { headers: { cookie } },
  );
  expect(response.status).toBe(200);
  return response.json<{
    siteName: string;
    siteDescription: string | null;
    siteDescriptions: Record<string, string | null>;
    defaultByline: { name: string; url: string | null };
    defaultLanguage: string;
    publicSiteEnabled: boolean;
  }>();
}

async function putAdminSiteSettings(
  cookie: string,
  settings: {
    siteName: string;
    siteDescription: string | null;
    siteDescriptions?: Record<string, string | null>;
    defaultByline: { name: string; url: string | null };
    defaultLanguage: string;
    publicSiteEnabled?: boolean;
  },
) {
  const response = await SELF.fetch(
    "http://briefly.test/api/admin/site-settings",
    {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(settings),
    },
  );
  expect(response.status).toBe(200);
  return response.json<{ publicSiteEnabled: boolean }>();
}

async function publishArticle(
  cookie: string,
  input: {
    slug: string;
    title: string;
    body: string;
    coverAssetId?: string;
  },
): Promise<{ coverUrl: string | null }> {
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
        byline: { name: "Gate Author", url: null },
        language: "en",
        cover: input.coverAssetId
          ? { assetId: input.coverAssetId, alt: "Gate cover" }
          : null,
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
  const receipt = await published.json<{
    article: { cover: { url: string } | null };
  }>();
  return { coverUrl: receipt.article.cover?.url ?? null };
}

describe("Public Site Enabled gate", () => {
  beforeEach(async () => {
    const { results } = await env.DB.prepare(
      "SELECT object_key FROM asset",
    ).all<{ object_key: string }>();
    await Promise.all(
      results.map(({ object_key }) => env.MEDIA_BUCKET.delete(object_key)),
    );
    await env.DB.batch([
      env.DB.prepare("DROP TRIGGER IF EXISTS reject_asset_publication_pointer"),
      env.DB.prepare("UPDATE article SET current_publication_id = NULL"),
      env.DB.prepare("DELETE FROM publication"),
      env.DB.prepare("DELETE FROM article_draft"),
      env.DB.prepare("DELETE FROM article"),
      env.DB.prepare("DELETE FROM asset"),
      env.DB.prepare("DELETE FROM auth_session"),
      env.DB.prepare("DELETE FROM auth_account"),
      env.DB.prepare("DELETE FROM auth_user"),
      env.DB.prepare("DELETE FROM auth_rate_limit"),
      env.DB.prepare(
        `UPDATE site_settings
         SET site_name = 'Briefly',
             site_description = 'A modern, self-hosted content engine.',
             site_descriptions = json_object('en', 'A modern, self-hosted content engine.'),
             default_byline_name = 'Briefly', default_byline_url = NULL,
             default_language = 'en',
             public_site_enabled = 1
         WHERE id = 1`,
      ),
    ]);
  });

  it("defaults Public Site Enabled on and serves the Built-in Public Site at /", async () => {
    const cookie = await initializeAndSignIn();
    const settings = await readAdminSiteSettings(cookie);
    expect(settings.publicSiteEnabled).toBe(true);

    const home = await SELF.fetch("http://briefly.test/", {
      redirect: "manual",
    });
    expect(home.status).toBe(200);
    expect(home.headers.get("location")).toBeNull();
  }, 15_000);

  it("redirects public reader HTML to /admin when Public Site Enabled is off", async () => {
    const cookie = await initializeAndSignIn();
    await publishArticle(cookie, {
      slug: "gated-article",
      title: "Gated Article",
      body: "Still available over the public API.",
    });
    const current = await readAdminSiteSettings(cookie);
    await putAdminSiteSettings(cookie, {
      ...current,
      publicSiteEnabled: false,
    });

    for (const path of ["/", "/articles/gated-article", "/zh-Hans/"]) {
      const response = await SELF.fetch(`http://briefly.test${path}`, {
        redirect: "manual",
      });
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        "http://briefly.test/admin",
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  }, 20_000);

  it("keeps public content API and media available while the reader site is off", async () => {
    const cookie = await initializeAndSignIn();
    const asset = await uploadOnePixelPngAsset(cookie, "gate.png");
    const { coverUrl } = await publishArticle(cookie, {
      slug: "api-still-open",
      title: "API Still Open",
      body: "Headless readers keep working.",
      coverAssetId: asset.id,
    });
    expect(coverUrl).toMatch(/^http:\/\/briefly\.test\/media\//u);

    const current = await readAdminSiteSettings(cookie);
    await putAdminSiteSettings(cookie, {
      ...current,
      publicSiteEnabled: false,
    });

    const site = await SELF.fetch("http://briefly.test/api/site");
    expect(site.status).toBe(200);
    const siteBody = await site.json<Record<string, unknown>>();
    expect(siteBody).not.toHaveProperty("publicSiteEnabled");
    expect(siteBody.siteName).toBe("Briefly");

    const publicArticle = await SELF.fetch(
      "http://briefly.test/api/articles/api-still-open",
    );
    expect(publicArticle.status).toBe(200);

    const media = await SELF.fetch(coverUrl!);
    expect(media.status).toBe(200);
  }, 25_000);

  it("still serves administration surfaces when the public reader site is off", async () => {
    const cookie = await initializeAndSignIn();
    const current = await readAdminSiteSettings(cookie);
    await putAdminSiteSettings(cookie, {
      ...current,
      publicSiteEnabled: false,
    });

    const login = await SELF.fetch("http://briefly.test/admin/login", {
      redirect: "manual",
    });
    expect(login.status).toBe(200);

    const admin = await SELF.fetch("http://briefly.test/admin/articles", {
      headers: { cookie },
      redirect: "manual",
    });
    expect(admin.status).toBe(200);
  }, 15_000);

  it("persists Public Site Enabled through the administration Site Settings API", async () => {
    const cookie = await initializeAndSignIn();
    const current = await readAdminSiteSettings(cookie);
    expect(current.publicSiteEnabled).toBe(true);

    const updated = await putAdminSiteSettings(cookie, {
      ...current,
      publicSiteEnabled: false,
    });
    expect(updated.publicSiteEnabled).toBe(false);

    const reread = await readAdminSiteSettings(cookie);
    expect(reread.publicSiteEnabled).toBe(false);

    const restored = await putAdminSiteSettings(cookie, {
      ...reread,
      publicSiteEnabled: true,
    });
    expect(restored.publicSiteEnabled).toBe(true);
  }, 15_000);
});
