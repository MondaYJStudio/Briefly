import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { zipSync } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";

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
    env.DB.prepare("DELETE FROM installed_public_template"),
    env.DB.prepare(
      "UPDATE site_public_presentation SET active_installation_id = NULL WHERE id = 1",
    ),
  ]);
}

describe("Public Template install from zip and list", () => {
  beforeEach(async () => {
    await resetPublicTemplateState();
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
  }, 15_000);

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
  }, 15_000);

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
  }, 15_000);
});
