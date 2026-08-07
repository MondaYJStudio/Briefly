import { expect, test, type Page, type Route } from "playwright/test";

import type { InstalledPublicTemplate } from "../src/public-templates/public-templates";
import { playwrightBaseUrl } from "./runtime";

const setupSecret = "playwright-only-setup-secret-32-characters";
const administratorEmail = "administrator@example.test";
const administratorPassword = "playwright-only-password";

function makeTemplate(
  overrides: Partial<InstalledPublicTemplate> = {},
): InstalledPublicTemplate {
  return {
    installationId: "11111111-1111-4111-8111-111111111111",
    manifestId: "example.reader",
    version: "1.0.0",
    name: "Example Reader",
    active: false,
    installedAt: "2026-08-07T00:00:00.000Z",
    ...overrides,
  };
}

async function ensureSignedIn(page: Page) {
  const installation = await page.request.get("/api/installation");
  const { initialized } = (await installation.json()) as {
    initialized: boolean;
  };
  if (!initialized) {
    const init = await page.request.post("/api/initialize", {
      data: {
        setupSecret,
        email: administratorEmail,
        password: administratorPassword,
      },
    });
    expect([201, 409]).toContain(init.status());
  }

  const signIn = await page.request.post("/api/auth/sign-in/email", {
    data: {
      email: administratorEmail,
      password: administratorPassword,
    },
    headers: { origin: playwrightBaseUrl },
  });
  expect(signIn.ok()).toBeTruthy();
}

async function fulfillJson(
  route: Route,
  status: number,
  body: unknown,
): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

test.beforeEach(async ({ page }) => {
  await ensureSignedIn(page);
});

test("Public Templates page lists installations with name, version, manifest id, and active state", async ({
  page,
}) => {
  const templates = [
    makeTemplate({
      installationId: "11111111-1111-4111-8111-111111111111",
      name: "Active Reader",
      version: "2.1.0",
      manifestId: "active.reader",
      active: true,
    }),
    makeTemplate({
      installationId: "22222222-2222-4222-8222-222222222222",
      name: "Spare Reader",
      version: "1.0.0",
      manifestId: "spare.reader",
      active: false,
    }),
  ];

  await page.route("**/api/admin/public-templates", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, 200, { templates });
      return;
    }
    await route.continue();
  });

  await page.goto("/admin/public-templates");

  await expect(
    page.getByRole("heading", { name: "Public Templates", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Content sections" }).getByRole(
      "link",
      { name: "Public Templates" },
    ),
  ).toHaveAttribute("aria-current", "page");

  const list = page.getByRole("list", { name: "Installed Public Templates" });
  await expect(list.getByText("Active Reader")).toBeVisible();
  await expect(list.getByText("2.1.0")).toBeVisible();
  await expect(list.getByText("active.reader")).toBeVisible();
  await expect(list.getByText("Active Public Template")).toBeVisible();
  await expect(list.getByText("Spare Reader")).toBeVisible();
  await expect(list.getByText("spare.reader")).toBeVisible();
});

test("Public Templates upload and URL install surface install failures clearly", async ({
  page,
}) => {
  await page.route("**/api/admin/public-templates", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, 200, { templates: [] });
      return;
    }
    if (route.request().method() === "POST") {
      await fulfillJson(route, 400, {
        status: "error",
        code: "PUBLIC_TEMPLATE_INSTALL_INVALID",
        issues: [
          {
            path: "manifest.json",
            message: "Public Template packages must include a root manifest.json.",
          },
        ],
      });
      return;
    }
    await route.continue();
  });

  await page.route("**/api/admin/public-templates/from-url", async (route) => {
    if (route.request().method() === "POST") {
      await fulfillJson(route, 400, {
        status: "error",
        code: "PUBLIC_TEMPLATE_INSTALL_INVALID",
        issues: [
          {
            path: "url",
            message: "Provide an HTTPS URL to a Public Template zip.",
          },
        ],
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/admin/public-templates");
  await expect(
    page.getByRole("heading", { name: "No Installed Public Templates" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Upload zip" }).click();
  const zipDialog = page.getByRole("dialog", { name: "Upload zip" });
  await zipDialog
    .locator('input[type="file"][name="publicTemplateFile"]')
    .setInputFiles({
      name: "broken.zip",
      mimeType: "application/zip",
      buffer: Buffer.from("not-a-zip"),
    });
  await zipDialog.getByRole("button", { name: "Install zip" }).click();
  await expect(zipDialog.getByRole("alert")).toContainText(
    "Couldn't install Public Template",
  );
  await expect(zipDialog.getByRole("alert")).toContainText(
    "Public Template packages must include a root manifest.json.",
  );
  await zipDialog.getByRole("button", { name: "Close upload dialog" }).click();

  await page.getByRole("button", { name: "Install from URL" }).click();
  const urlDialog = page.getByRole("dialog", { name: "Install from URL" });
  await urlDialog.getByLabel("HTTPS zip URL").fill(
    "http://example.test/template.zip",
  );
  await urlDialog.getByRole("button", { name: "Install from URL" }).click();
  await expect(urlDialog.getByRole("alert")).toContainText(
    "Couldn't install Public Template",
  );
  await expect(urlDialog.getByRole("alert")).toContainText(
    "Provide an HTTPS URL to a Public Template zip.",
  );
});

test("Public Templates can activate one installation and deactivate to the Built-in Public Site", async ({
  page,
}) => {
  let templates = [
    makeTemplate({
      installationId: "11111111-1111-4111-8111-111111111111",
      name: "Switchable Reader",
      active: false,
    }),
  ];

  await page.route("**/api/admin/public-templates", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, 200, { templates });
      return;
    }
    await route.continue();
  });

  await page.route(
    "**/api/admin/public-templates/*/activate",
    async (route) => {
      templates = templates.map((template) => ({
        ...template,
        active: true,
      }));
      await fulfillJson(route, 200, templates[0]);
    },
  );

  await page.route(
    "**/api/admin/public-templates/deactivate",
    async (route) => {
      templates = templates.map((template) => ({
        ...template,
        active: false,
      }));
      await fulfillJson(route, 200, { active: false });
    },
  );

  await page.goto("/admin/public-templates");
  await expect(
    page.getByRole("note").filter({
      hasText: "visitors see the Built-in Public Site",
    }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Activate Switchable Reader" })
    .click();
  await expect(
    page.getByText("Active Public Template", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Active Public Template set" }),
  ).toBeVisible();
  await expect(
    page.getByRole("note").filter({
      hasText: "visitors see the Built-in Public Site",
    }),
  ).toHaveCount(0);

  await page
    .getByRole("button", { name: "Deactivate Switchable Reader" })
    .click();
  await expect(
    page.getByRole("note").filter({
      hasText: "visitors see the Built-in Public Site",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({
      hasText: "Built-in Public Site restored",
    }),
  ).toBeVisible();
});

test("Public Templates can delete a non-active installation and does not offer delete while active", async ({
  page,
}) => {
  let templates = [
    makeTemplate({
      installationId: "11111111-1111-4111-8111-111111111111",
      name: "Active Reader",
      active: true,
    }),
    makeTemplate({
      installationId: "22222222-2222-4222-8222-222222222222",
      name: "Removable Reader",
      manifestId: "removable.reader",
      active: false,
    }),
  ];

  await page.route("**/api/admin/public-templates", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, 200, { templates });
      return;
    }
    await route.continue();
  });

  await page.route("**/api/admin/public-templates/*", async (route) => {
    const method = route.request().method();
    const url = route.request().url();
    if (method === "DELETE" && url.includes("22222222-2222-4222-8222-222222222222")) {
      templates = templates.filter(
        (template) =>
          template.installationId !== "22222222-2222-4222-8222-222222222222",
      );
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    if (method === "DELETE") {
      await fulfillJson(route, 409, {
        status: "error",
        code: "PUBLIC_TEMPLATE_DELETE_BLOCKED",
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/admin/public-templates");

  await expect(
    page.getByRole("button", { name: "Delete Active Reader" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Deactivate Active Reader" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Delete Removable Reader" }).click();
  await page.getByRole("button", { name: "Delete installation" }).click();
  await expect(page.getByText("Removable Reader")).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({
      hasText: "Installed Public Template deleted",
    }),
  ).toBeVisible();
});
