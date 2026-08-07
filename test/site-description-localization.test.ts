import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { initializeAndSignIn } from "./administrator-fixture";
import { normalizeSiteDescriptionTranslations } from "../src/site-settings/site-settings";

const initialDescription =
  "A modern, self-hosted content engine with editable drafts and an immutable version history.";

describe("localized Site Description responses", () => {
  it("treats locale keys case-insensitively when preserving an explicit null", () => {
    expect(
      normalizeSiteDescriptionTranslations({ EN: null }, "legacy English"),
    ).toMatchObject({ en: null });
    expect(
      normalizeSiteDescriptionTranslations(
        { "ZH-HANS": "简体中文" },
        "legacy English",
      ),
    ).toMatchObject({ en: "legacy English", "zh-Hans": "简体中文" });
    expect(
      normalizeSiteDescriptionTranslations({
        "ZH-HANS": "canonical",
        "zh-CN": "alias",
      }),
    ).toMatchObject({ "zh-Hans": "canonical" });
    expect(
      normalizeSiteDescriptionTranslations({
        "ZH-HANS": "case variant",
        "zh-Hans": "canonical",
      }),
    ).toMatchObject({ "zh-Hans": "canonical" });
    expect(
      normalizeSiteDescriptionTranslations({
        "zh-Hans": "canonical",
        "ZH-HANS": "case variant",
      }),
    ).toMatchObject({ "zh-Hans": "canonical" });
    expect(
      normalizeSiteDescriptionTranslations({
        "ZH-HANS": "first",
        "zh-hans": "second",
      }),
    ).toMatchObject({ "zh-Hans": "first" });
    expect(
      normalizeSiteDescriptionTranslations({
        "zh-hans": "second",
        "ZH-HANS": "first",
      }),
    ).toMatchObject({ "zh-Hans": "first" });
  });

  it("seeds English for a partial legacy map but respects an explicit null", () => {
    expect(
      normalizeSiteDescriptionTranslations(
        { "zh-Hans": "简体中文" },
        "legacy English",
      ),
    ).toMatchObject({ en: "legacy English", "zh-Hans": "简体中文" });
    expect(
      normalizeSiteDescriptionTranslations(
        { en: null, "zh-Hans": "简体中文" },
        "legacy English",
      ),
    ).toMatchObject({ en: null, "zh-Hans": "简体中文" });
  });

  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM auth_session"),
      env.DB.prepare("DELETE FROM auth_account"),
      env.DB.prepare("DELETE FROM auth_user"),
      env.DB.prepare("DELETE FROM auth_rate_limit"),
      env.DB.prepare(
        `UPDATE site_settings
         SET site_name = 'Briefly',
             site_description = ?,
             site_descriptions = json_object('en', ?),
             default_byline_name = 'Briefly', default_byline_url = NULL,
             default_language = 'en'
         WHERE id = 1`,
      ).bind(initialDescription, initialDescription),
    ]);
  });

  it("matches the shared registry and reports the selected translation", async () => {
    const cookie = await initializeAndSignIn();
    const update = {
      siteName: "Briefly",
      siteDescriptions: {
        en: "English description",
        "zh-Hans": "简体中文描述",
        "zh-Hant": "繁體中文描述",
        ja: null,
        ko: null,
      },
      defaultByline: { name: "Briefly", url: null },
      defaultLanguage: "en",
    };

    const saved = await SELF.fetch(
      "http://briefly.test/api/admin/site-settings",
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(update),
      },
    );
    expect(saved.status).toBe(200);
    const savedBody = await saved.json<{
      siteDescriptions: Record<string, string | null>;
    }>();
    expect(savedBody.siteDescriptions).toEqual(update.siteDescriptions);

    const traditional = await SELF.fetch("http://briefly.test/api/site", {
      headers: { "accept-language": "zh-TW, en;q=0.5" },
    });
    expect(traditional.status).toBe(200);
    expect(traditional.headers.get("content-language")).toBe("zh-Hant");
    expect(traditional.headers.get("vary")).toContain("Accept-Language");
    expect(traditional.headers.get("vary")).toContain("Cookie");
    expect(
      (await traditional.json<{ siteDescription: string | null }>())
        .siteDescription,
    ).toBe("繁體中文描述");

    const page = await SELF.fetch("http://briefly.test/", {
      headers: { "accept-language": "zh-TW, en;q=0.5" },
    });
    const pageHtml = await page.text();
    expect(page.headers.get("content-language")).toBe("zh-Hant");
    expect(page.headers.get("vary")).toContain("Accept-Language");
    expect(pageHtml).toContain('<html lang="zh-Hant"');
    expect(pageHtml).toContain("繁體中文描述");

    const english = await SELF.fetch("http://briefly.test/api/site", {
      headers: {
        cookie: "PARAGLIDE_LOCALE=ja",
        "accept-language": "zh-Hant",
      },
    });
    expect(english.headers.get("content-language")).toBe("en");
    expect(
      (await english.json<{ siteDescription: string | null }>())
        .siteDescription,
    ).toBe("English description");
    expect(english.headers.get("etag")).not.toBe(
      traditional.headers.get("etag"),
    );
  });

  it("keeps the legacy English projection for a partial persisted map", async () => {
    await env.DB.prepare(
      `UPDATE site_settings
       SET site_description = ?,
           site_descriptions = json_object('zh-Hans', ?)
       WHERE id = 1`,
    )
      .bind("Legacy English description", "简体中文描述")
      .run();

    const response = await SELF.fetch("http://briefly.test/api/site", {
      headers: { "accept-language": "ja" },
    });

    expect(response.headers.get("content-language")).toBe("en");
    expect(
      (await response.json<{ siteDescription: string | null }>())
        .siteDescription,
    ).toBe("Legacy English description");
  });

  it("prefers a newer legacy scalar during a rolling deployment mismatch", async () => {
    await env.DB.prepare(
      `UPDATE site_settings
       SET site_description = ?,
           site_descriptions = json_object('en', ?, 'zh-Hans', ?)
       WHERE id = 1`,
    )
      .bind(
        "Written by the old Worker",
        "Written by the new Worker",
        "简体中文描述",
      )
      .run();

    const response = await SELF.fetch("http://briefly.test/api/site");
    expect(response.status).toBe(200);
    expect(
      (await response.json<{ siteDescription: string }>()).siteDescription,
    ).toBe("Written by the old Worker");
  });

  it("accepts the legacy zh-CN key but persists the zh-Hans canonical key", async () => {
    const cookie = await initializeAndSignIn();
    const response = await SELF.fetch(
      "http://briefly.test/api/admin/site-settings",
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          siteName: "Briefly",
          siteDescriptions: { "zh-CN": "兼容中文" },
          defaultByline: { name: "Briefly", url: null },
          defaultLanguage: "en",
        }),
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json<{
      siteDescriptions: Record<string, string | null>;
    }>();
    expect(body.siteDescriptions).toMatchObject({
      "zh-Hans": "兼容中文",
    });
    expect(body.siteDescriptions).not.toHaveProperty("zh-CN");
  });

  it("merges a partial translation patch without dropping other locales", async () => {
    const cookie = await initializeAndSignIn();
    const initial = await SELF.fetch(
      "http://briefly.test/api/admin/site-settings",
      { headers: { cookie } },
    );
    const settings = await initial.json<Record<string, unknown>>();
    const response = await SELF.fetch(
      "http://briefly.test/api/admin/site-settings",
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          siteName: settings.siteName,
          siteDescriptions: { "zh-Hans": "只更新简体中文" },
          defaultByline: settings.defaultByline,
          defaultLanguage: settings.defaultLanguage,
        }),
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json<{
      siteDescriptions: Record<string, string | null>;
    }>();
    expect(body.siteDescriptions.en).toBe(initialDescription);
    expect(body.siteDescriptions["zh-Hans"]).toBe("只更新简体中文");
  });

  it("keeps a manual locale on an unprefixed SSR request", async () => {
    const response = await SELF.fetch("http://briefly.test/", {
      headers: {
        cookie: "PARAGLIDE_LOCALE=zh-Hant",
        "accept-language": "ja",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-language")).toBe("zh-Hant");
    expect(await response.text()).toContain('<html lang="zh-Hant"');
  });

  it("rejects ambiguous alias and canonical translation keys", async () => {
    const cookie = await initializeAndSignIn();
    const response = await SELF.fetch(
      "http://briefly.test/api/admin/site-settings",
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          siteName: "Briefly",
          siteDescriptions: {
            "zh-CN": "legacy",
            "zh-Hans": "canonical",
          },
          defaultByline: { name: "Briefly", url: null },
          defaultLanguage: "en",
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "SITE_SETTINGS_INVALID",
      issues: [expect.objectContaining({ path: "siteDescriptions.zh-Hans" })],
    });
  });
});
