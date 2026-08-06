import {
  SELF,
  applyD1Migrations,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "../src/server";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Worker HTTP runtime", () => {
  it("serves the TanStack Start application from the single Worker", async () => {
    const response = await SELF.fetch("http://briefly.test/");

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Briefly");
  });

  it("serves the Elysia API from the same Worker", async () => {
    const response = await SELF.fetch("http://briefly.test/api");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      service: "briefly",
      transport: "elysia",
    });
  });

  it("reports read-only runtime and schema compatibility", async () => {
    const response = await SELF.fetch("http://briefly.test/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f-]{27}$/,
    );
    expect(await response.json()).toEqual({
      status: "ok",
      service: "briefly",
      runtime: "cloudflare-workers",
      schema: { status: "compatible" },
      storage: { d1: "ready", r2: "ready" },
      requestId: expect.any(String),
    });
  });

  it("runs on a newly assigned workers.dev origin without APP_ORIGIN", async () => {
    const context = createExecutionContext();
    const response = await worker.fetch(
      new Request("https://briefly-example.workers.dev/health") as Request<
        unknown,
        IncomingRequestCfProperties
      >,
      { ...env, APP_ENV: "production", APP_ORIGIN: undefined },
      context,
    );
    await waitOnExecutionContext(context);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
  });

  it("preserves a safe caller request ID", async () => {
    const requestId = "018f7d63-7b8a-4a2e-91ec-99732fb645bb";
    const response = await SELF.fetch("http://briefly.test/health", {
      headers: { "x-request-id": requestId },
    });

    expect(response.headers.get("x-request-id")).toBe(requestId);
    expect(await response.json()).toMatchObject({ requestId });
  });

  it("replaces credential-shaped caller values before logging a request ID", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const ctx = createExecutionContext();
    const suppliedValue = "sk-live-caller-controlled-value";

    const response = await worker.fetch(
      new Request("http://briefly.test/health", {
        headers: { "x-request-id": suppliedValue },
      }) as Request<unknown, IncomingRequestCfProperties>,
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(response.headers.get("x-request-id")).not.toBe(suppliedValue);
    expect(consoleInfo.mock.calls.flat().join(" ")).not.toContain(
      suppliedValue,
    );
  });

  it("rejects methods outside the read-only health contract", async () => {
    const response = await SELF.fetch("http://briefly.test/health", {
      method: "POST",
      body: "content-that-must-not-be-processed",
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
    expect(await response.json()).toMatchObject({
      status: "error",
      code: "METHOD_NOT_ALLOWED",
    });
  });

  it("does not serve the application from a non-canonical origin", async () => {
    const response = await SELF.fetch("http://alternate.test/");

    expect(response.status).toBe(421);
    expect(await response.json()).toMatchObject({
      status: "error",
      code: "ORIGIN_MISMATCH",
    });
  });

  it("diagnoses incompatible configuration without returning its value", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const ctx = createExecutionContext();
    const incompatibleEnv = {
      ...env,
      APP_ORIGIN: "credential-like-value",
    };

    const request = new Request(
      "http://briefly.test/health?secret=query-secret",
      {
        method: "POST",
        headers: {
          cookie: "session=cookie-secret",
          "x-request-id": "invalid/id",
        },
        body: "password=body-secret",
      },
    ) as Request<unknown, IncomingRequestCfProperties>;

    const response = await worker.fetch(request, incompatibleEnv, ctx);
    await waitOnExecutionContext(ctx);

    const responseText = await response.text();
    const logText = consoleInfo.mock.calls.flat().join(" ");

    expect(response.status).toBe(503);
    expect(JSON.parse(responseText)).toMatchObject({
      status: "error",
      code: "RUNTIME_CONFIGURATION_INVALID",
      issues: [{ binding: "APP_ORIGIN", reason: "invalid" }],
      requestId: expect.any(String),
    });
    for (const privateValue of [
      "credential-like-value",
      "query-secret",
      "cookie-secret",
      "body-secret",
    ]) {
      expect(responseText).not.toContain(privateValue);
      expect(logText).not.toContain(privateValue);
    }
  });

  it("rejects a recovery secret that reuses another application secret", async () => {
    for (const reusedSecret of [env.SETUP_SECRET, env.BETTER_AUTH_SECRET]) {
      const context = createExecutionContext();
      const response = await worker.fetch(
        new Request("http://briefly.test/health") as Request<
          unknown,
          IncomingRequestCfProperties
        >,
        { ...env, RECOVERY_SECRET: reusedSecret },
        context,
      );
      await waitOnExecutionContext(context);

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        status: "error",
        code: "RUNTIME_CONFIGURATION_INVALID",
        issues: [{ binding: "RECOVERY_SECRET", reason: "invalid" }],
      });
    }
  });

  it("reports a missing required schema capability without changing the schema", async () => {
    await env.DB.prepare("DELETE FROM runtime_metadata WHERE id = 1").run();

    try {
      const response = await SELF.fetch("http://briefly.test/health");

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        status: "error",
        code: "SCHEMA_INCOMPATIBLE",
        schema: { status: "incompatible" },
        requestId: expect.any(String),
      });
      const row = await env.DB.prepare(
        "SELECT id FROM runtime_metadata WHERE id = 1",
      ).first<{ id: number }>();
      expect(row).toBeNull();
    } finally {
      await env.DB.prepare(
        "INSERT INTO runtime_metadata (id) VALUES (1)",
      ).run();
    }
  });

  it("reports a missing authentication bootstrap capability", async () => {
    await env.DB.prepare("DELETE FROM installation WHERE id = 1").run();

    try {
      const response = await SELF.fetch("http://briefly.test/health");

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        status: "error",
        code: "SCHEMA_INCOMPATIBLE",
        schema: { status: "incompatible" },
      });
    } finally {
      await env.DB.prepare("INSERT INTO installation (id) VALUES (1)").run();
    }
  });

  it("reports a missing authentication constraint capability", async () => {
    await env.DB.prepare("DROP INDEX auth_user_singleton_unique").run();

    try {
      const response = await SELF.fetch("http://briefly.test/health");

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        status: "error",
        code: "SCHEMA_INCOMPATIBLE",
        schema: { status: "incompatible" },
      });
    } finally {
      await env.DB.prepare(
        "CREATE UNIQUE INDEX auth_user_singleton_unique ON auth_user (singleton)",
      ).run();
    }
  });

  it("reports a missing private Asset schema capability", async () => {
    await env.DB.prepare("ALTER TABLE asset RENAME TO asset_unavailable").run();

    try {
      const response = await SELF.fetch("http://briefly.test/health");

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        status: "error",
        code: "SCHEMA_INCOMPATIBLE",
        schema: { status: "incompatible" },
      });
    } finally {
      await env.DB.prepare(
        "ALTER TABLE asset_unavailable RENAME TO asset",
      ).run();
    }
  });

  it("distinguishes unavailable R2 storage from a schema mismatch", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const unavailableBucket = {
      get: env.MEDIA_BUCKET.get.bind(env.MEDIA_BUCKET),
      head: () => Promise.reject(new Error("private-r2-error-value")),
      put: env.MEDIA_BUCKET.put.bind(env.MEDIA_BUCKET),
      delete: env.MEDIA_BUCKET.delete.bind(env.MEDIA_BUCKET),
    } as unknown as R2Bucket;
    const ctx = createExecutionContext();

    const response = await worker.fetch(
      new Request("http://briefly.test/health") as Request<
        unknown,
        IncomingRequestCfProperties
      >,
      { ...env, MEDIA_BUCKET: unavailableBucket },
      ctx,
    );
    await waitOnExecutionContext(ctx);

    const responseText = await response.text();
    const logText = consoleInfo.mock.calls.flat().join(" ");
    expect(response.status).toBe(503);
    expect(JSON.parse(responseText)).toMatchObject({
      status: "error",
      code: "STORAGE_UNAVAILABLE",
      storage: { r2: "unavailable" },
    });
    expect(responseText).not.toContain("private-r2-error-value");
    expect(logText).not.toContain("private-r2-error-value");
  });

  it("distinguishes unavailable D1 storage from a schema mismatch", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const fail = () => {
      throw new Error("private-d1-error-value");
    };
    const unavailableDatabase = {
      prepare: fail,
      batch: fail,
      exec: fail,
    } as unknown as D1Database;
    const ctx = createExecutionContext();

    const response = await worker.fetch(
      new Request("http://briefly.test/health") as Request<
        unknown,
        IncomingRequestCfProperties
      >,
      { ...env, DB: unavailableDatabase },
      ctx,
    );
    await waitOnExecutionContext(ctx);

    const responseText = await response.text();
    const logText = consoleInfo.mock.calls.flat().join(" ");
    expect(response.status).toBe(503);
    expect(JSON.parse(responseText)).toMatchObject({
      status: "error",
      code: "STORAGE_UNAVAILABLE",
      storage: { d1: "unavailable" },
    });
    expect(responseText).not.toContain("private-d1-error-value");
    expect(logText).not.toContain("private-d1-error-value");
  });

  it("does not create an R2 object during health checks", async () => {
    const prefix = "__briefly_health_probe__";

    await SELF.fetch("http://briefly.test/health");

    const objects = await env.MEDIA_BUCKET.list({ prefix });
    expect(objects.objects).toEqual([]);
  });
});

describe("ordered D1 migrations", () => {
  it("applies pending migrations once and works through the Worker interface", async () => {
    await applyD1Migrations(env.MIGRATION_DB, env.TEST_MIGRATIONS);
    await applyD1Migrations(env.MIGRATION_DB, env.TEST_MIGRATIONS);
    const ctx = createExecutionContext();

    const response = await worker.fetch(
      new Request("http://briefly.test/health") as Request<
        unknown,
        IncomingRequestCfProperties
      >,
      { ...env, DB: env.MIGRATION_DB },
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      schema: { status: "compatible" },
    });
  });
});
