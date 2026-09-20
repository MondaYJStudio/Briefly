import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { api } from "../src/api/app.server";
import { readAdministratorSession } from "../src/auth/administrator-session.server";
import { validateRuntimeBindings } from "../src/env/runtime.server";
import { administrator, initializeAndSignIn } from "./administrator-fixture";

const uuid = "00000000-0000-4000-8000-000000000000";

function runtimeBindings() {
  const configuration = validateRuntimeBindings(env);
  if (!configuration.ok) throw new Error("Expected valid Worker bindings");
  return configuration.bindings;
}

function requestWith(cookie?: string): Request {
  return new Request("http://briefly.test/api/admin/articles", {
    headers: cookie ? { cookie } : {},
  });
}

describe("Administrator Session", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM auth_session"),
      env.DB.prepare("DELETE FROM auth_account"),
      env.DB.prepare("DELETE FROM auth_user"),
      env.DB.prepare("DELETE FROM auth_rate_limit"),
    ]);
  });

  it("resolves the Administrator without renewing the session", async () => {
    const cookie = await initializeAndSignIn();

    const session = await readAdministratorSession(
      runtimeBindings(),
      requestWith(cookie),
    );

    expect(session.administrator).toEqual({
      id: expect.any(String),
      email: administrator.email,
      initials: "AD",
    });
    expect(session.headers.get("set-cookie")).toBeNull();
  });

  it("returns mergeable headers when renewal is requested", async () => {
    const cookie = await initializeAndSignIn();

    const session = await readAdministratorSession(
      runtimeBindings(),
      requestWith(cookie),
      { refresh: true },
    );

    expect(session.administrator?.email).toBe(administrator.email);
    expect(session.headers).toBeInstanceOf(Headers);
  });

  it("resolves no Administrator without a cookie or with a forged one", async () => {
    const cookie = await initializeAndSignIn();
    const forged = `${cookie.split("=", 1)[0]}=forged-session-token`;

    for (const candidate of [undefined, forged]) {
      const session = await readAdministratorSession(
        runtimeBindings(),
        requestWith(candidate),
      );

      expect(session.administrator).toBeNull();
    }
  });
});

function json(value: unknown): RequestInit {
  return {
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  };
}

function upload(): RequestInit {
  const body = new FormData();
  body.set(
    "file",
    new File([new Uint8Array([0])], "pixel.png", { type: "image/png" }),
  );
  return { body };
}

/**
 * Elysia validates a declared body before the Administrator Session gate runs,
 * so a route reached with an invalid payload is refused with 400 and never
 * exercises the gate. Every gated route that declares a body needs a valid one
 * here.
 */
const payloads: Record<string, RequestInit> = {
  "PUT /api/admin/site-settings": json({
    siteName: "Briefly",
    defaultByline: { name: "Briefly", url: null },
    defaultLanguage: "en",
  }),
  "POST /api/admin/channels": json({
    slug: "docs",
    name: "Documentation",
  }),
  "PUT /api/admin/channels/:channelId": json({
    name: "Documentation",
  }),
  "DELETE /api/admin/trash/articles/:articleId": json({
    confirmationTitle: "Any title",
  }),
  "PUT /api/admin/articles/:articleId/draft": json({}),
  "POST /api/admin/video-embeds/recognize": json({
    input: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  }),
  "POST /api/admin/assets": upload(),
  "POST /api/admin/articles/:articleId/preview": json({ draftVersion: 1 }),
  "POST /api/admin/articles/:articleId/publications": json({
    draftVersion: 1,
    expectedCurrentPublicationId: null,
  }),
  "POST /api/admin/articles/:articleId/publications/:publicationId/restore":
    json({ draftVersion: 1, confirmDiscardUnpublishedChanges: false }),
};

const administratorRoutes = api.routes
  .map(({ method, path }) => ({
    method,
    path: path.startsWith("/api") ? path : `/api${path}`,
  }))
  .filter(({ path }) => path.startsWith("/api/admin"));

describe("every administration route requires an Administrator Session", () => {
  it("discovers the administration routes from the application itself", () => {
    // Guards against a vacuous pass: an empty or mis-filtered route list would
    // make the refusal assertions below trivially true.
    expect(administratorRoutes.length).toBeGreaterThanOrEqual(20);
  });

  it.each(administratorRoutes)(
    "refuses $method $path without a session",
    async ({ method, path }) => {
      const response = await SELF.fetch(
        `http://briefly.test${path
          .replace(":articleId", uuid)
          .replace(":publicationId", uuid)
          .replace(":assetId", uuid)
          .replace(":channelId", uuid)}`,
        { method, ...payloads[`${method} ${path}`] },
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        status: "error",
        code: "AUTHENTICATION_REQUIRED",
      });
      expect(response.headers.get("cache-control")).toContain("no-store");
    },
  );
});
