import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { OpenAPIV3_1 } from "openapi-types";
import { beforeEach, describe, expect, it } from "vitest";

import { administrator, initializeAndSignIn } from "./administrator-fixture";
import { expectResponseMatchesContract } from "./openapi-contract";

describe("public Site Settings API", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM auth_session"),
      env.DB.prepare("DELETE FROM auth_account"),
      env.DB.prepare("DELETE FROM auth_user"),
      env.DB.prepare("DELETE FROM auth_rate_limit"),
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

  it("serves the public site identity without authentication", async () => {
    const response = await SELF.fetch("http://briefly.test/api/site");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("etag")).toBeTruthy();
    expect(await response.json()).toEqual({
      siteName: "Briefly",
      siteDescription:
        "A modern, self-hosted content engine with editable drafts and an immutable version history.",
      defaultByline: { name: "Briefly", url: null },
      defaultLanguage: "en",
    });
  });

  it("matches the OpenAPI contract and supports conditional requests", async () => {
    const contract = await (
      await SELF.fetch("http://briefly.test/api/openapi.json")
    ).json<OpenAPIV3_1.Document>();
    expectResponseMatchesContract(contract, "/api/site", "get", 200, {
      siteName: "Briefly",
      siteDescription:
        "A modern, self-hosted content engine with editable drafts and an immutable version history.",
      defaultByline: { name: "Briefly", url: null },
      defaultLanguage: "en",
    });
    const first = await SELF.fetch("http://briefly.test/api/site");
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const revalidated = await SELF.fetch("http://briefly.test/api/site", {
      headers: { "if-none-match": etag! },
    });
    expect(revalidated.status).toBe(304);
  });

  it("reflects administrator updates to the site identity", async () => {
    const cookie = await initializeAndSignIn();
    const update = {
      siteName: "Example Press",
      siteDescription: "A compact newsroom.",
      defaultByline: { name: "Editor", url: "https://example.com/editor" },
      defaultLanguage: "zh-CN",
    };
    const updated = await SELF.fetch(
      "http://briefly.test/api/admin/site-settings",
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(update),
      },
    );
    expect(updated.status).toBe(200);

    const response = await SELF.fetch("http://briefly.test/api/site");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(update);
    expect(JSON.stringify(body)).not.toContain(administrator.email);
  });
});
