import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

const administrator = {
  email: "administrator@example.com",
  password: "correct horse battery staple",
};

async function initializeAndSignIn(): Promise<string> {
  const initialization = await SELF.fetch(
    "http://briefly.test/api/initialize",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        setupSecret: env.SETUP_SECRET,
        ...administrator,
      }),
    },
  );
  expect(initialization.status).toBe(201);

  const signIn = await SELF.fetch(
    "http://briefly.test/api/auth/sign-in/email",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://briefly.test",
      },
      body: JSON.stringify(administrator),
    },
  );
  expect(signIn.status).toBe(200);
  const setCookie = signIn.headers.get("set-cookie");
  if (!setCookie) throw new Error("Expected a session cookie");
  return setCookie.split(";", 1)[0];
}

describe("site identity and Byline defaults", () => {
  beforeEach(async () => {
    await env.DB.batch([
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

  it("returns installation-safe initial public metadata to the authenticated Administrator", async () => {
    const cookie = await initializeAndSignIn();

    const response = await SELF.fetch(
      "http://briefly.test/api/admin/site-settings",
      { headers: { cookie } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      siteName: "Briefly",
      siteDescription: null,
      defaultByline: { name: "Briefly", url: null },
      defaultLanguage: "en",
    });
  }, 15_000);

  it("updates explicit public identity without deriving Byline from the Administrator", async () => {
    const cookie = await initializeAndSignIn();
    const update = {
      siteName: "Example Press",
      siteDescription: "Independent writing about software.",
      defaultByline: {
        name: "Editorial Team",
        url: "https://example.com/about",
      },
      defaultLanguage: "zh-Hans",
    };

    const response = await SELF.fetch(
      "http://briefly.test/api/admin/site-settings",
      {
        method: "PUT",
        headers: {
          cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify(update),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(update);
    const readResponse = await SELF.fetch(
      "http://briefly.test/api/admin/site-settings",
      { headers: { cookie } },
    );
    const persisted = await readResponse.json();
    expect(persisted).toEqual(update);
    expect(JSON.stringify(persisted)).not.toContain(administrator.email);
  }, 15_000);

  it("clears nullable description and Byline URL without synthesizing fallbacks", async () => {
    const cookie = await initializeAndSignIn();
    const populated = {
      siteName: "Example Press",
      siteDescription: "A description that will be removed.",
      defaultByline: {
        name: "Editorial Team",
        url: "https://example.com/team",
      },
      defaultLanguage: "en-GB",
    };
    expect(
      (
        await SELF.fetch("http://briefly.test/api/admin/site-settings", {
          method: "PUT",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify(populated),
        })
      ).status,
    ).toBe(200);

    const cleared = {
      ...populated,
      siteDescription: null,
      defaultByline: { ...populated.defaultByline, url: null },
    };
    const response = await SELF.fetch(
      "http://briefly.test/api/admin/site-settings",
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(cleared),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(cleared);
  }, 15_000);

  it("returns actionable private validation issues and preserves the previous settings", async () => {
    const cookie = await initializeAndSignIn();
    const invalid = {
      siteName: "   ",
      siteDescription: "x".repeat(501),
      defaultByline: {
        name: "x".repeat(121),
        url: "javascript:alert(1)",
      },
      defaultLanguage: "not_a_language",
    };

    const response = await SELF.fetch(
      "http://briefly.test/api/admin/site-settings",
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(invalid),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      status: "error",
      code: "SITE_SETTINGS_INVALID",
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "siteName" }),
        expect.objectContaining({ path: "siteDescription" }),
        expect.objectContaining({ path: "defaultByline.name" }),
        expect.objectContaining({
          path: "defaultByline.url",
          message: "Use an HTTP or HTTPS URL.",
        }),
        expect.objectContaining({
          path: "defaultLanguage",
          message: "Use a valid BCP 47 language tag, such as en or zh-Hans.",
        }),
      ]),
    });
    const persisted = await SELF.fetch(
      "http://briefly.test/api/admin/site-settings",
      { headers: { cookie } },
    );
    expect(await persisted.json()).toMatchObject({
      siteName: "Briefly",
      defaultByline: { name: "Briefly", url: null },
      defaultLanguage: "en",
    });
  }, 15_000);

  it("rejects anonymous reads and updates even when the route guard is bypassed", async () => {
    const anonymousUpdate = await SELF.fetch(
      "http://briefly.test/api/admin/site-settings",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const anonymousRead = await SELF.fetch(
      "http://briefly.test/api/admin/site-settings",
    );

    for (const response of [anonymousRead, anonymousUpdate]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        status: "error",
        code: "AUTHENTICATION_REQUIRED",
      });
    }
  });

  it("preserves the single Site Settings record at the persistence boundary", async () => {
    const initial = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM site_settings",
    ).first<{ count: number }>();
    expect(initial?.count).toBe(1);

    await expect(
      env.DB.prepare("INSERT INTO site_settings (id) VALUES (2)").run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        "UPDATE site_settings SET default_byline_url = 'javascript:alert(1)' WHERE id = 1",
      ).run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        "UPDATE site_settings SET default_language = 'not_a_language' WHERE id = 1",
      ).run(),
    ).rejects.toThrow();

    const preserved = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM site_settings WHERE id = 1",
    ).first<{ count: number }>();
    expect(preserved?.count).toBe(1);
  });

  it("presents route-local loading and editing status for Site Settings", async () => {
    const cookie = await initializeAndSignIn();

    const response = await SELF.fetch("http://briefly.test/admin", {
      headers: { cookie },
    });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Site identity and defaults");
    expect(html).toContain("Loading Site Settings");
    expect(html).toContain(
      "These public values are independent of the Administrator account.",
    );
    expect(html).not.toContain(administrator.email);
  }, 15_000);
});
