import {
  SELF,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import worker from "../src/server";
import { initializeAndSignIn } from "./administrator-fixture";

const encoder = new TextEncoder();

function buildTemplateZip(
  files: Record<string, string | Uint8Array>,
  options: { level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 } = {},
): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    entries[path] =
      typeof content === "string" ? encoder.encode(content) : content;
  }
  return zipSync(entries, options);
}

function validManifest(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: "example-reader",
    version: "1.0.0",
    name: "Example Reader",
    ...overrides,
  });
}

function validTemplateZip(
  overrides: {
    manifest?: Record<string, unknown>;
    files?: Record<string, string | Uint8Array>;
  } = {},
): Uint8Array {
  return buildTemplateZip({
    "manifest.json": validManifest(overrides.manifest),
    "index.html": "<!doctype html><title>Example</title>",
    ...overrides.files,
  });
}

async function uploadTemplate(
  cookie: string | undefined,
  bytes: Uint8Array,
  filename = "template.zip",
): Promise<Response> {
  const form = new FormData();
  form.set(
    "file",
    new File([new Uint8Array(bytes)], filename, { type: "application/zip" }),
  );
  return SELF.fetch("http://briefly.test/api/admin/public-templates", {
    method: "POST",
    headers: cookie ? { cookie } : undefined,
    body: form,
  });
}

async function listTemplates(cookie?: string): Promise<Response> {
  return SELF.fetch("http://briefly.test/api/admin/public-templates", {
    headers: cookie ? { cookie } : undefined,
  });
}

async function resetPublicTemplateState(): Promise<void> {
  const listed = await env.MEDIA_BUCKET.list({ prefix: "public-templates/" });
  if (listed.objects.length > 0) {
    await Promise.all(
      listed.objects.map((object) => env.MEDIA_BUCKET.delete(object.key)),
    );
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_session"),
    env.DB.prepare("DELETE FROM auth_account"),
    env.DB.prepare("DELETE FROM auth_user"),
    env.DB.prepare("DELETE FROM auth_rate_limit"),
    env.DB.prepare(
      "UPDATE installation SET state = 'uninitialized', initialized_at = NULL WHERE id = 1",
    ),
    env.DB.prepare(
      "UPDATE site_public_presentation SET active_installation_id = NULL WHERE id = 1",
    ),
    env.DB.prepare("DELETE FROM installed_public_template"),
  ]);
}

describe("Public Template install from zip and list", () => {
  beforeEach(async () => {
    await resetPublicTemplateState();
  });

  afterEach(async () => {
    await env.DB.prepare(
      "UPDATE site_public_presentation SET active_installation_id = NULL WHERE id = 1",
    ).run();
  });

  it("rejects unauthenticated list and upload the same way as other Admin APIs", async () => {
    const listResponse = await listTemplates();
    expect(listResponse.status).toBe(401);
    expect(await listResponse.json()).toEqual({
      status: "error",
      code: "AUTHENTICATION_REQUIRED",
    });

    const uploadResponse = await uploadTemplate(undefined, validTemplateZip());
    expect(uploadResponse.status).toBe(401);
    expect(await uploadResponse.json()).toEqual({
      status: "error",
      code: "AUTHENTICATION_REQUIRED",
    });
  }, 30_000);

  it("installs a valid Public Template zip and lists it as inactive", async () => {
    const cookie = await initializeAndSignIn();

    const emptyList = await listTemplates(cookie);
    expect(emptyList.status).toBe(200);
    expect(emptyList.headers.get("cache-control")).toBe("no-store");
    expect(await emptyList.json()).toEqual({ templates: [] });

    const upload = await uploadTemplate(cookie, validTemplateZip());
    expect(upload.status).toBe(201);
    expect(upload.headers.get("cache-control")).toBe("no-store");
    const installed = (await upload.json()) as {
      installationId: string;
      manifestId: string;
      version: string;
      name: string;
      active: boolean;
      installedAt: string;
    };
    expect(installed).toEqual({
      installationId: expect.any(String),
      manifestId: "example-reader",
      version: "1.0.0",
      name: "Example Reader",
      active: false,
      installedAt: expect.any(String),
    });
    expect(installed.installationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(Number.isNaN(Date.parse(installed.installedAt))).toBe(false);

    const list = await listTemplates(cookie);
    expect(list.status).toBe(200);
    const listBody = await list.json();
    expect(listBody).toEqual({
      templates: [
        {
          installationId: installed.installationId,
          manifestId: "example-reader",
          version: "1.0.0",
          name: "Example Reader",
          active: false,
          installedAt: installed.installedAt,
        },
      ],
    });
    expect(JSON.stringify(listBody)).not.toMatch(
      /object.?key|public-templates\//i,
    );

    const indexObject = await env.MEDIA_BUCKET.get(
      `public-templates/${installed.installationId}/index.html`,
    );
    expect(indexObject).not.toBeNull();
    expect(await indexObject!.text()).toBe(
      "<!doctype html><title>Example</title>",
    );
    const manifestObject = await env.MEDIA_BUCKET.get(
      `public-templates/${installed.installationId}/manifest.json`,
    );
    expect(manifestObject).not.toBeNull();
  }, 30_000);

  it("rejects invalid packages without leaving a listed installation or active pointer", async () => {
    const cookie = await initializeAndSignIn();

    const cases: Array<{ label: string; bytes: Uint8Array }> = [
      {
        label: "not a zip",
        bytes: encoder.encode("definitely-not-a-zip"),
      },
      {
        label: "missing manifest",
        bytes: buildTemplateZip({
          "index.html": "<!doctype html><title>Missing manifest</title>",
        }),
      },
      {
        label: "missing manifest fields",
        bytes: buildTemplateZip({
          "manifest.json": JSON.stringify({ id: "incomplete" }),
          "index.html": "<!doctype html><title>Incomplete</title>",
        }),
      },
      {
        label: "missing index.html",
        bytes: buildTemplateZip({
          "manifest.json": validManifest(),
          "styles.css": "body{}",
        }),
      },
      {
        label: "path traversal",
        bytes: buildTemplateZip({
          "manifest.json": validManifest(),
          "index.html": "<!doctype html><title>Traversal</title>",
          "../escape.txt": "nope",
        }),
      },
      {
        label: "disallowed extension",
        bytes: buildTemplateZip({
          "manifest.json": validManifest(),
          "index.html": "<!doctype html><title>Bad ext</title>",
          "server.php": "<?php echo 1;",
        }),
      },
      {
        label: "over-limit zip",
        bytes: (() => {
          const padding = new Uint8Array(11 * 1024 * 1024);
          for (let index = 0; index < padding.length; index += 1) {
            padding[index] = index & 0xff;
          }
          return buildTemplateZip(
            {
              "manifest.json": validManifest(),
              "index.html": "<!doctype html><title>Huge</title>",
              "assets/pad.bin": padding,
            },
            { level: 0 },
          );
        })(),
      },
    ];

    for (const testCase of cases) {
      const response = await uploadTemplate(cookie, testCase.bytes);
      expect(response.status, testCase.label).toBe(400);
      const body = await response.json();
      expect(body, testCase.label).toEqual({
        status: "error",
        code: "PUBLIC_TEMPLATE_INSTALL_INVALID",
        issues: [expect.objectContaining({ path: expect.any(String) })],
      });
    }

    const list = await listTemplates(cookie);
    expect(await list.json()).toEqual({ templates: [] });

    const active = await env.DB.prepare(
      "SELECT active_installation_id FROM site_public_presentation WHERE id = 1",
    ).first<{ active_installation_id: string | null }>();
    expect(active?.active_installation_id ?? null).toBeNull();

    const leftover = await env.MEDIA_BUCKET.list({
      prefix: "public-templates/",
    });
    expect(leftover.objects).toEqual([]);
  }, 30_000);

  it("replaces an existing installation when the Template Manifest id matches", async () => {
    const cookie = await initializeAndSignIn();
    const first = await uploadTemplate(
      cookie,
      validTemplateZip({
        files: {
          "index.html": "<!doctype html><title>First</title>",
        },
      }),
    );
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { installationId: string };

    const second = await uploadTemplate(
      cookie,
      validTemplateZip({
        manifest: { version: "2.0.0", name: "Example Reader Two" },
        files: {
          "index.html": "<!doctype html><title>Second</title>",
        },
      }),
    );
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as {
      installationId: string;
      version: string;
      name: string;
      active: boolean;
    };
    expect(secondBody.version).toBe("2.0.0");
    expect(secondBody.name).toBe("Example Reader Two");
    expect(secondBody.active).toBe(false);
    expect(secondBody.installationId).not.toBe(firstBody.installationId);

    const list = await listTemplates(cookie);
    expect(await list.json()).toEqual({
      templates: [
        expect.objectContaining({
          installationId: secondBody.installationId,
          manifestId: "example-reader",
          version: "2.0.0",
          name: "Example Reader Two",
          active: false,
        }),
      ],
    });

    expect(
      await env.MEDIA_BUCKET.head(
        `public-templates/${firstBody.installationId}/index.html`,
      ),
    ).toBeNull();
    expect(
      await (
        await env.MEDIA_BUCKET.get(
          `public-templates/${secondBody.installationId}/index.html`,
        )
      )!.text(),
    ).toBe("<!doctype html><title>Second</title>");
  }, 30_000);
});

async function activateTemplate(
  cookie: string | undefined,
  installationId: string,
): Promise<Response> {
  return SELF.fetch(
    `http://briefly.test/api/admin/public-templates/${installationId}/activate`,
    {
      method: "POST",
      headers: cookie ? { cookie } : undefined,
    },
  );
}

async function deactivateTemplate(cookie?: string): Promise<Response> {
  return SELF.fetch(
    "http://briefly.test/api/admin/public-templates/deactivate",
    {
      method: "POST",
      headers: cookie ? { cookie } : undefined,
    },
  );
}

async function deleteTemplate(
  cookie: string | undefined,
  installationId: string,
): Promise<Response> {
  return SELF.fetch(
    `http://briefly.test/api/admin/public-templates/${installationId}`,
    {
      method: "DELETE",
      headers: cookie ? { cookie } : undefined,
    },
  );
}

describe("Public Template activate, deactivate, and serve", () => {
  beforeEach(async () => {
    await resetPublicTemplateState();
  });

  afterEach(async () => {
    await env.DB.prepare(
      "UPDATE site_public_presentation SET active_installation_id = NULL WHERE id = 1",
    ).run();
  });

  it("rejects unauthenticated activate and deactivate like other Admin APIs", async () => {
    const activate = await activateTemplate(
      undefined,
      "00000000-0000-4000-8000-000000000001",
    );
    expect(activate.status).toBe(401);
    expect(await activate.json()).toEqual({
      status: "error",
      code: "AUTHENTICATION_REQUIRED",
    });

    const deactivate = await deactivateTemplate();
    expect(deactivate.status).toBe(401);
    expect(await deactivate.json()).toEqual({
      status: "error",
      code: "AUTHENTICATION_REQUIRED",
    });
  }, 30_000);

  it("activates an Installed Public Template and serves it immediately for visitors", async () => {
    const cookie = await initializeAndSignIn();
    const upload = await uploadTemplate(
      cookie,
      validTemplateZip({
        files: {
          "index.html": "<!doctype html><title>Active Reader</title>",
          "assets/app.js": "console.log('template')",
        },
      }),
    );
    expect(upload.status).toBe(201);
    const installed = (await upload.json()) as {
      installationId: string;
      active: boolean;
    };
    expect(installed.active).toBe(false);

    const beforeActivate = await SELF.fetch("http://briefly.test/");
    expect(beforeActivate.status).toBe(200);
    expect(await beforeActivate.text()).toContain("Briefly");

    const activate = await activateTemplate(cookie, installed.installationId);
    expect(activate.status).toBe(200);
    expect(activate.headers.get("cache-control")).toBe("no-store");
    expect(await activate.json()).toEqual({
      installationId: installed.installationId,
      manifestId: "example-reader",
      version: "1.0.0",
      name: "Example Reader",
      active: true,
      installedAt: expect.any(String),
    });

    const list = await listTemplates(cookie);
    expect(await list.json()).toEqual({
      templates: [
        expect.objectContaining({
          installationId: installed.installationId,
          active: true,
        }),
      ],
    });

    const home = await SELF.fetch("http://briefly.test/");
    expect(home.status).toBe(200);
    expect(home.headers.get("content-type")).toContain("text/html");
    expect(await home.text()).toBe(
      "<!doctype html><title>Active Reader</title>",
    );

    const headHome = await SELF.fetch("http://briefly.test/", {
      method: "HEAD",
    });
    expect(headHome.status).toBe(200);
    expect(headHome.headers.get("content-type")).toContain("text/html");
    expect(await headHome.text()).toBe("");

    const asset = await SELF.fetch("http://briefly.test/assets/app.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("javascript");
    expect(await asset.text()).toBe("console.log('template')");

    const spaFallback = await SELF.fetch(
      "http://briefly.test/articles/some-slug",
    );
    expect(spaFallback.status).toBe(200);
    expect(await spaFallback.text()).toBe(
      "<!doctype html><title>Active Reader</title>",
    );

    const trailingSlash = await SELF.fetch(
      "http://briefly.test/articles/some-slug/",
    );
    expect(trailingSlash.status).toBe(200);
    expect(await trailingSlash.text()).toBe(
      "<!doctype html><title>Active Reader</title>",
    );
  }, 30_000);

  it("keeps reserved Briefly paths on Briefly while a Public Template is active", async () => {
    const cookie = await initializeAndSignIn();
    const upload = await uploadTemplate(
      cookie,
      validTemplateZip({
        files: {
          "index.html": "<!doctype html><title>Template Face</title>",
        },
      }),
    );
    const installed = (await upload.json()) as { installationId: string };
    expect(
      (await activateTemplate(cookie, installed.installationId)).status,
    ).toBe(200);

    const site = await SELF.fetch("http://briefly.test/api/site");
    expect(site.status).toBe(200);
    expect(await site.json()).toEqual(
      expect.objectContaining({ siteName: "Briefly" }),
    );

    const articles = await SELF.fetch("http://briefly.test/api/articles");
    expect(articles.status).toBe(200);
    expect(await articles.json()).toEqual({ items: [], nextCursor: null });

    const health = await SELF.fetch("http://briefly.test/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual(
      expect.objectContaining({ status: "ok", service: "briefly" }),
    );

    const adminLogin = await SELF.fetch("http://briefly.test/admin/login");
    expect(adminLogin.status).toBe(200);
    const adminLoginBody = await adminLogin.text();
    expect(adminLoginBody).toContain("Briefly");
    expect(adminLoginBody).not.toContain("Template Face");

    const missingMedia = await SELF.fetch(
      "http://briefly.test/media/00000000-0000-4000-8000-000000000099",
    );
    expect(missingMedia.status).toBe(404);
    expect(await missingMedia.json()).toEqual({
      status: "error",
      code: "ASSET_NOT_FOUND",
    });
  }, 30_000);

  it("deactivates the Active Public Template and restores the Built-in Public Site", async () => {
    const cookie = await initializeAndSignIn();
    const upload = await uploadTemplate(
      cookie,
      validTemplateZip({
        files: {
          "index.html": "<!doctype html><title>Temporary Face</title>",
        },
      }),
    );
    const installed = (await upload.json()) as { installationId: string };
    expect(
      (await activateTemplate(cookie, installed.installationId)).status,
    ).toBe(200);

    const deactivate = await deactivateTemplate(cookie);
    expect(deactivate.status).toBe(200);
    expect(deactivate.headers.get("cache-control")).toBe("no-store");
    expect(await deactivate.json()).toEqual({ active: false });

    const list = await listTemplates(cookie);
    expect(await list.json()).toEqual({
      templates: [
        expect.objectContaining({
          installationId: installed.installationId,
          active: false,
        }),
      ],
    });

    const home = await SELF.fetch("http://briefly.test/");
    expect(home.status).toBe(200);
    const homeBody = await home.text();
    expect(homeBody).toContain("Briefly");
    expect(homeBody).not.toContain("Temporary Face");
  }, 30_000);

  it("replaces the previous Active Public Template when activating another", async () => {
    const cookie = await initializeAndSignIn();
    const firstUpload = await uploadTemplate(
      cookie,
      validTemplateZip({
        manifest: { id: "reader-a", name: "Reader A" },
        files: { "index.html": "<!doctype html><title>Reader A</title>" },
      }),
    );
    const first = (await firstUpload.json()) as { installationId: string };
    const secondUpload = await uploadTemplate(
      cookie,
      validTemplateZip({
        manifest: { id: "reader-b", name: "Reader B" },
        files: { "index.html": "<!doctype html><title>Reader B</title>" },
      }),
    );
    const second = (await secondUpload.json()) as { installationId: string };

    expect((await activateTemplate(cookie, first.installationId)).status).toBe(
      200,
    );
    expect((await activateTemplate(cookie, second.installationId)).status).toBe(
      200,
    );

    const list = await listTemplates(cookie);
    const templates = (
      (await list.json()) as {
        templates: Array<{ installationId: string; active: boolean }>;
      }
    ).templates;
    expect(
      templates.find((row) => row.installationId === first.installationId)
        ?.active,
    ).toBe(false);
    expect(
      templates.find((row) => row.installationId === second.installationId)
        ?.active,
    ).toBe(true);

    expect(await (await SELF.fetch("http://briefly.test/")).text()).toBe(
      "<!doctype html><title>Reader B</title>",
    );
  }, 30_000);

  it("rejects non-GET/HEAD methods on Active Public Template paths", async () => {
    const cookie = await initializeAndSignIn();
    const upload = await uploadTemplate(cookie, validTemplateZip());
    const installed = (await upload.json()) as { installationId: string };
    expect(
      (await activateTemplate(cookie, installed.installationId)).status,
    ).toBe(200);

    const post = await SELF.fetch("http://briefly.test/articles/demo", {
      method: "POST",
      body: "nope",
    });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
    expect(await post.json()).toEqual({
      status: "error",
      code: "METHOD_NOT_ALLOWED",
    });
  }, 30_000);

  it("returns an operational failure when the Active Public Template index.html is missing", async () => {
    const cookie = await initializeAndSignIn();
    const upload = await uploadTemplate(
      cookie,
      validTemplateZip({
        files: {
          "index.html": "<!doctype html><title>About to break</title>",
        },
      }),
    );
    const installed = (await upload.json()) as { installationId: string };
    expect(
      (await activateTemplate(cookie, installed.installationId)).status,
    ).toBe(200);

    await env.MEDIA_BUCKET.delete(
      `public-templates/${installed.installationId}/index.html`,
    );

    const response = await SELF.fetch("http://briefly.test/");
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      status: "error",
      code: "ACTIVE_PUBLIC_TEMPLATE_UNAVAILABLE",
    });
  }, 30_000);

  it("returns not found when activating an unknown installation", async () => {
    const cookie = await initializeAndSignIn();
    const response = await activateTemplate(
      cookie,
      "00000000-0000-4000-8000-0000000000aa",
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      status: "error",
      code: "PUBLIC_TEMPLATE_NOT_FOUND",
    });
  }, 30_000);
});

describe("Public Template replace while active and delete", () => {
  beforeEach(async () => {
    await resetPublicTemplateState();
  });

  afterEach(async () => {
    await env.DB.prepare(
      "UPDATE site_public_presentation SET active_installation_id = NULL WHERE id = 1",
    ).run();
  });

  it("rejects unauthenticated delete like other Admin APIs", async () => {
    const response = await deleteTemplate(
      undefined,
      "00000000-0000-4000-8000-000000000001",
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      status: "error",
      code: "AUTHENTICATION_REQUIRED",
    });
  }, 30_000);

  it("serves new bytes immediately when replacing the Active Public Template by manifest id", async () => {
    const cookie = await initializeAndSignIn();
    const firstUpload = await uploadTemplate(
      cookie,
      validTemplateZip({
        files: {
          "index.html": "<!doctype html><title>Active v1</title>",
          "assets/app.js": "console.log('v1')",
        },
      }),
    );
    expect(firstUpload.status).toBe(201);
    const first = (await firstUpload.json()) as { installationId: string };
    expect((await activateTemplate(cookie, first.installationId)).status).toBe(
      200,
    );
    expect(await (await SELF.fetch("http://briefly.test/")).text()).toBe(
      "<!doctype html><title>Active v1</title>",
    );

    const replace = await uploadTemplate(
      cookie,
      validTemplateZip({
        manifest: { version: "2.0.0", name: "Example Reader v2" },
        files: {
          "index.html": "<!doctype html><title>Active v2</title>",
          "assets/app.js": "console.log('v2')",
        },
      }),
    );
    expect(replace.status).toBe(201);
    const replaced = (await replace.json()) as {
      installationId: string;
      version: string;
      name: string;
      active: boolean;
    };
    expect(replaced.installationId).not.toBe(first.installationId);
    expect(replaced.version).toBe("2.0.0");
    expect(replaced.name).toBe("Example Reader v2");
    expect(replaced.active).toBe(true);

    const list = await listTemplates(cookie);
    expect(await list.json()).toEqual({
      templates: [
        expect.objectContaining({
          installationId: replaced.installationId,
          manifestId: "example-reader",
          version: "2.0.0",
          active: true,
        }),
      ],
    });

    expect(await (await SELF.fetch("http://briefly.test/")).text()).toBe(
      "<!doctype html><title>Active v2</title>",
    );
    expect(
      await (await SELF.fetch("http://briefly.test/assets/app.js")).text(),
    ).toBe("console.log('v2')");
    expect(
      await env.MEDIA_BUCKET.head(
        `public-templates/${first.installationId}/index.html`,
      ),
    ).toBeNull();
  }, 30_000);

  it("refuses delete while the installation is the Active Public Template", async () => {
    const cookie = await initializeAndSignIn();
    const upload = await uploadTemplate(cookie, validTemplateZip());
    const installed = (await upload.json()) as { installationId: string };
    expect(
      (await activateTemplate(cookie, installed.installationId)).status,
    ).toBe(200);

    const deleted = await deleteTemplate(cookie, installed.installationId);
    expect(deleted.status).toBe(409);
    expect(await deleted.json()).toEqual({
      status: "error",
      code: "PUBLIC_TEMPLATE_DELETE_BLOCKED",
    });

    const list = await listTemplates(cookie);
    expect(await list.json()).toEqual({
      templates: [
        expect.objectContaining({
          installationId: installed.installationId,
          active: true,
        }),
      ],
    });
    expect(await (await SELF.fetch("http://briefly.test/")).text()).toContain(
      "Example",
    );
  }, 30_000);

  it("deletes a non-active installation and removes its R2 objects", async () => {
    const cookie = await initializeAndSignIn();
    const upload = await uploadTemplate(
      cookie,
      validTemplateZip({
        files: {
          "index.html": "<!doctype html><title>Disposable</title>",
          "assets/app.js": "console.log('gone')",
        },
      }),
    );
    expect(upload.status).toBe(201);
    const installed = (await upload.json()) as { installationId: string };

    const deleted = await deleteTemplate(cookie, installed.installationId);
    expect(deleted.status).toBe(204);
    expect(deleted.headers.get("cache-control")).toBe("no-store");
    expect(await deleted.text()).toBe("");

    const list = await listTemplates(cookie);
    expect(await list.json()).toEqual({ templates: [] });

    expect(
      await env.MEDIA_BUCKET.head(
        `public-templates/${installed.installationId}/index.html`,
      ),
    ).toBeNull();
    expect(
      await env.MEDIA_BUCKET.head(
        `public-templates/${installed.installationId}/assets/app.js`,
      ),
    ).toBeNull();
    const leftover = await env.MEDIA_BUCKET.list({
      prefix: `public-templates/${installed.installationId}/`,
    });
    expect(leftover.objects).toEqual([]);
  }, 30_000);

  it("returns not found when deleting an unknown installation", async () => {
    const cookie = await initializeAndSignIn();
    const response = await deleteTemplate(
      cookie,
      "00000000-0000-4000-8000-0000000000aa",
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      status: "error",
      code: "PUBLIC_TEMPLATE_NOT_FOUND",
    });
  }, 30_000);

  it("keeps the Active Public Template pointer intact when a replace package is rejected", async () => {
    const cookie = await initializeAndSignIn();
    const upload = await uploadTemplate(
      cookie,
      validTemplateZip({
        files: {
          "index.html": "<!doctype html><title>Still Active</title>",
        },
      }),
    );
    const installed = (await upload.json()) as { installationId: string };
    expect(
      (await activateTemplate(cookie, installed.installationId)).status,
    ).toBe(200);

    const rejected = await uploadTemplate(
      cookie,
      buildTemplateZip({
        "manifest.json": validManifest({ version: "9.0.0" }),
        "styles.css": "body{}",
      }),
    );
    expect(rejected.status).toBe(400);

    const list = await listTemplates(cookie);
    expect(await list.json()).toEqual({
      templates: [
        expect.objectContaining({
          installationId: installed.installationId,
          version: "1.0.0",
          active: true,
        }),
      ],
    });
    expect(await (await SELF.fetch("http://briefly.test/")).text()).toBe(
      "<!doctype html><title>Still Active</title>",
    );
  }, 30_000);
});

async function installTemplateFromUrl(
  cookie: string | undefined,
  url: string,
): Promise<Response> {
  // Call the Worker handler in this execution context so mocked outbound
  // Response bodies remain readable (SELF service-binding I/O is isolated).
  const context = createExecutionContext();
  const response = await worker.fetch(
    new Request("http://briefly.test/api/admin/public-templates/from-url", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({ url }),
    }) as Request<unknown, IncomingRequestCfProperties>,
    env,
    context,
  );
  await waitOnExecutionContext(context);
  return response;
}

function mockOutboundZip(
  url: string,
  response: Response | (() => Response | Promise<Response>),
): void {
  const originalFetch = globalThis.fetch.bind(globalThis);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url === url) {
      return typeof response === "function" ? await response() : response;
    }
    return originalFetch(input, init);
  });
}

describe("Public Template install from HTTPS URL", () => {
  beforeEach(async () => {
    await resetPublicTemplateState();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await env.DB.prepare(
      "UPDATE site_public_presentation SET active_installation_id = NULL WHERE id = 1",
    ).run();
  });

  it("rejects unauthenticated URL install the same way as other Admin APIs", async () => {
    const response = await installTemplateFromUrl(
      undefined,
      "https://templates.example/reader.zip",
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      status: "error",
      code: "AUTHENTICATION_REQUIRED",
    });
  }, 30_000);

  it("installs a Public Template from an HTTPS zip URL and lists it like a local upload", async () => {
    const cookie = await initializeAndSignIn();
    const zipBytes = validTemplateZip({
      files: {
        "index.html": "<!doctype html><title>From URL</title>",
      },
    });
    const sourceUrl = "https://templates.example/reader.zip";
    mockOutboundZip(
      sourceUrl,
      new Response(new Uint8Array(zipBytes), {
        status: 200,
        headers: { "content-type": "application/zip" },
      }),
    );

    const install = await installTemplateFromUrl(cookie, sourceUrl);
    expect(install.status).toBe(201);
    expect(install.headers.get("cache-control")).toBe("no-store");
    const installed = (await install.json()) as {
      installationId: string;
      manifestId: string;
      version: string;
      name: string;
      active: boolean;
      installedAt: string;
    };
    expect(installed).toEqual({
      installationId: expect.any(String),
      manifestId: "example-reader",
      version: "1.0.0",
      name: "Example Reader",
      active: false,
      installedAt: expect.any(String),
    });

    const list = await listTemplates(cookie);
    expect(await list.json()).toEqual({
      templates: [
        {
          installationId: installed.installationId,
          manifestId: "example-reader",
          version: "1.0.0",
          name: "Example Reader",
          active: false,
          installedAt: installed.installedAt,
        },
      ],
    });
    expect(
      await (
        await env.MEDIA_BUCKET.get(
          `public-templates/${installed.installationId}/index.html`,
        )
      )!.text(),
    ).toBe("<!doctype html><title>From URL</title>");
  }, 30_000);

  it("rejects non-HTTPS URLs and fetch or validation failures without a corrupt installation", async () => {
    const cookie = await initializeAndSignIn();

    const nonHttps = await installTemplateFromUrl(
      cookie,
      "http://templates.example/reader.zip",
    );
    expect(nonHttps.status).toBe(400);
    expect(await nonHttps.json()).toEqual({
      status: "error",
      code: "PUBLIC_TEMPLATE_INSTALL_INVALID",
      issues: [expect.objectContaining({ path: "url" })],
    });

    mockOutboundZip(
      "https://templates.example/missing.zip",
      new Response("gone", { status: 404 }),
    );
    const missing = await installTemplateFromUrl(
      cookie,
      "https://templates.example/missing.zip",
    );
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({
      status: "error",
      code: "PUBLIC_TEMPLATE_INSTALL_INVALID",
      issues: [expect.objectContaining({ path: "url" })],
    });

    mockOutboundZip(
      "https://templates.example/bad-package.zip",
      new Response(encoder.encode("not-a-zip"), {
        status: 200,
        headers: { "content-type": "application/zip" },
      }),
    );
    const badPackage = await installTemplateFromUrl(
      cookie,
      "https://templates.example/bad-package.zip",
    );
    expect(badPackage.status).toBe(400);
    expect(await badPackage.json()).toEqual({
      status: "error",
      code: "PUBLIC_TEMPLATE_INSTALL_INVALID",
      issues: [expect.objectContaining({ path: expect.any(String) })],
    });

    const list = await listTemplates(cookie);
    expect(await list.json()).toEqual({ templates: [] });
    const leftover = await env.MEDIA_BUCKET.list({
      prefix: "public-templates/",
    });
    expect(leftover.objects).toEqual([]);
  }, 30_000);

  it("rejects oversized remote zips at the install boundary", async () => {
    const cookie = await initializeAndSignIn();
    const sourceUrl = "https://templates.example/huge.zip";
    const oversizedLength = String(11 * 1024 * 1024);
    mockOutboundZip(
      sourceUrl,
      new Response("should-not-be-read", {
        status: 200,
        headers: {
          "content-type": "application/zip",
          "content-length": oversizedLength,
        },
      }),
    );

    const response = await installTemplateFromUrl(cookie, sourceUrl);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      status: "error",
      code: "PUBLIC_TEMPLATE_INSTALL_INVALID",
      issues: [expect.objectContaining({ path: "url" })],
    });

    const list = await listTemplates(cookie);
    expect(await list.json()).toEqual({ templates: [] });
  }, 30_000);

  it("rejects timed-out remote fetches without a corrupt installation", async () => {
    const cookie = await initializeAndSignIn();
    const sourceUrl = "https://templates.example/slow.zip";
    mockOutboundZip(sourceUrl, async () => {
      throw new DOMException("The operation was aborted.", "TimeoutError");
    });

    const response = await installTemplateFromUrl(cookie, sourceUrl);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      status: "error",
      code: "PUBLIC_TEMPLATE_INSTALL_INVALID",
      issues: [expect.objectContaining({ path: "url" })],
    });

    const list = await listTemplates(cookie);
    expect(await list.json()).toEqual({ templates: [] });
  }, 30_000);

  it("replaces an existing installation when the same Template Manifest id arrives via URL", async () => {
    const cookie = await initializeAndSignIn();
    const first = await uploadTemplate(
      cookie,
      validTemplateZip({
        files: {
          "index.html": "<!doctype html><title>Local First</title>",
        },
      }),
    );
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { installationId: string };

    const sourceUrl = "https://templates.example/reader-v2.zip";
    mockOutboundZip(
      sourceUrl,
      new Response(
        new Uint8Array(
          validTemplateZip({
            manifest: { version: "2.0.0", name: "Example Reader URL" },
            files: {
              "index.html": "<!doctype html><title>From URL Replace</title>",
            },
          }),
        ),
        {
          status: 200,
          headers: { "content-type": "application/zip" },
        },
      ),
    );

    const second = await installTemplateFromUrl(cookie, sourceUrl);
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as {
      installationId: string;
      version: string;
      name: string;
    };
    expect(secondBody.version).toBe("2.0.0");
    expect(secondBody.name).toBe("Example Reader URL");
    expect(secondBody.installationId).not.toBe(firstBody.installationId);

    const list = await listTemplates(cookie);
    expect(await list.json()).toEqual({
      templates: [
        expect.objectContaining({
          installationId: secondBody.installationId,
          manifestId: "example-reader",
          version: "2.0.0",
          name: "Example Reader URL",
          active: false,
        }),
      ],
    });
    expect(
      await env.MEDIA_BUCKET.head(
        `public-templates/${firstBody.installationId}/index.html`,
      ),
    ).toBeNull();
  }, 30_000);
});
