import { expect, test, type Page } from "playwright/test";

import type { AdminArticleListItem } from "../src/articles/articles";
import type { AssetLibraryEntry } from "../src/assets/assets";
import { playwrightBaseUrl } from "./runtime";

const setupSecret = "playwright-only-setup-secret-32-characters";
const administratorEmail = "administrator@example.test";
const administratorPassword = "playwright-only-password";

const emptyDocument = {
  documentSchemaVersion: 1 as const,
  doc: { type: "doc" as const, content: [{ type: "paragraph" }] },
};

function makeListArticle(
  overrides: Partial<AdminArticleListItem> = {},
): AdminArticleListItem {
  const now = new Date().toISOString();
  return {
    id: "11111111-1111-4111-8111-111111111111",
    currentPublicationId: null,
    createdAt: now,
    updatedAt: now,
    lifecycleProjection: "draft",
    draft: {
      version: 1,
      title: "Fixture Article",
      slug: "fixture-article",
      slugIsManual: false,
      summary: null,
      tags: [],
      byline: null,
      language: null,
      cover: null,
      document: emptyDocument,
      createdAt: now,
      updatedAt: now,
    },
    ...overrides,
  };
}

function makeAsset(
  overrides: Partial<AssetLibraryEntry> &
    Pick<AssetLibraryEntry, "id" | "originalFilename">,
): AssetLibraryEntry {
  const now = new Date().toISOString();
  const references = overrides.references ?? {
    currentDrafts: 0,
    retainedPublications: 0,
  };

  if (overrides.lifecycleState === "pending_deletion") {
    return {
      id: overrides.id,
      originalFilename: overrides.originalFilename,
      mimeType: overrides.mimeType ?? "image/png",
      byteSize: overrides.byteSize ?? 512,
      width: overrides.width ?? 32,
      height: overrides.height ?? 32,
      uploadedAt: overrides.uploadedAt ?? now,
      publicAssetId: overrides.publicAssetId ?? null,
      lifecycleState: "pending_deletion",
      failureCode: overrides.failureCode ?? null,
      references,
    };
  }

  return {
    id: overrides.id,
    originalFilename: overrides.originalFilename,
    mimeType: overrides.mimeType ?? "image/png",
    byteSize: overrides.byteSize ?? 512,
    width: overrides.width ?? 32,
    height: overrides.height ?? 32,
    uploadedAt: overrides.uploadedAt ?? now,
    lifecycleState: "ready",
    publicAssetId: overrides.publicAssetId ?? null,
    failureCode: null,
    references,
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

async function openIdentityMenu(page: Page, itemName: string) {
  const trigger = page.getByRole("button", {
    name: `Settings and account menu — ${administratorEmail}`,
  });
  await trigger.click();
  const item = page.getByRole("menuitem", { name: itemName });
  try {
    await expect(item).toBeVisible({ timeout: 3_000 });
  } catch {
    await trigger.click();
    await expect(item).toBeVisible();
  }
  return trigger;
}

async function waitForEditor(page: Page) {
  await expect(page.getByText("Loading the text-rich editor…")).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(page.getByLabel("Article body")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await ensureSignedIn(page);
});

test("Articles loading skeleton appears while the list request is delayed", async ({
  page,
}) => {
  let releaseList: (() => void) | undefined;
  const listMayReturn = new Promise<void>((resolve) => {
    releaseList = resolve;
  });

  await page.route("**/api/admin/articles", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await listMayReturn;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ articles: [] }),
    });
  });

  await page.goto("/admin/articles");
  await expect(
    page.getByRole("status", { name: "Loading Article Drafts" }),
  ).toBeVisible();

  releaseList?.();
  await expect(
    page.getByRole("heading", { name: "No articles yet" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Write your first article" }),
  ).toBeVisible();
});

test("Articles empty state shows guidance and a create call to action", async ({
  page,
}) => {
  await page.route("**/api/admin/articles", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ articles: [] }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/admin/articles");
  await expect(
    page.getByRole("heading", { name: "No articles yet" }),
  ).toBeVisible();
  await expect(page.getByText("Create your first draft.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Write your first article" }),
  ).toBeVisible();
});

test("Articles initial load failure shows retry guidance", async ({ page }) => {
  await page.route("**/api/admin/articles", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 503, body: "Articles unavailable" });
      return;
    }
    await route.continue();
  });

  await page.goto("/admin/articles");
  await expect(page.getByRole("alert")).toContainText(
    "Unable to load Articles",
  );
  await expect(page.getByText("Retry to reload the list.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reload Articles" }),
  ).toBeVisible();
});

test("Articles list refresh failure keeps previously shown rows", async ({
  page,
}) => {
  await page.goto("/admin/articles");
  await page.getByRole("button", { name: "Create Article Draft" }).click();
  await waitForEditor(page);

  const title = "Retention probe";
  await page.getByLabel("Article title", { exact: true }).fill(title);
  await page
    .getByLabel("Article body")
    .fill("Retained while the list refresh fails.");
  await expect(page.getByText(/^Saved · Draft v\d+$/)).toBeVisible();

  await page.goto("/admin/articles");
  const row = page.getByRole("button", {
    name: new RegExp(`${title} · Draft v`),
  });
  await expect(row).toBeVisible();

  let failNextListLoad = false;
  await page.route("**/api/admin/articles", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    if (failNextListLoad) {
      await route.fulfill({ status: 503, body: "Articles unavailable" });
      return;
    }
    await route.continue();
  });

  failNextListLoad = true;
  await page.getByRole("button", { name: `More actions for ${title}` }).click();
  await page.getByRole("menuitem", { name: "Publish", exact: true }).click();

  await expect(page.getByRole("alert")).toContainText(
    "Unable to load Articles",
  );
  await expect(row).toBeVisible();

  failNextListLoad = false;
  await page.getByRole("button", { name: "Reload Articles" }).click();
  await expect(page.getByText("Unable to load Articles")).toHaveCount(0);
  await expect(row).toBeVisible();
});

test("Create Article failure keeps list context and shows guidance", async ({
  page,
}) => {
  const sample = makeListArticle({
    id: "33333333-3333-4333-8333-333333333333",
    draft: {
      ...makeListArticle().draft,
      title: "Existing list row",
    },
  });

  await page.route("**/api/admin/articles", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ articles: [sample] }),
      });
      return;
    }
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 503, body: "Creation unavailable" });
      return;
    }
    await route.continue();
  });

  await page.goto("/admin/articles");
  await expect(
    page.getByRole("button", { name: /Existing list row · Draft v1/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Create Article Draft" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Unable to create Article",
  );
  await expect(page.getByText("Nothing was created. Try again.")).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/articles$/);
  await expect(
    page.getByRole("button", { name: /Existing list row · Draft v1/ }),
  ).toBeVisible();
});

test("Editor offline autosave shows the offline indicator", async ({
  page,
  context,
}) => {
  await page.goto("/admin/articles");
  await page.getByRole("button", { name: "Create Article Draft" }).click();
  await expect(page).toHaveURL(/\/admin\/articles\/[^/]+$/);
  await waitForEditor(page);

  await page.getByLabel("Article title", { exact: true }).fill("Offline probe");
  await page
    .getByLabel("Article body")
    .fill("Body kept locally while offline.");
  await expect(page.getByText(/^Saved · Draft v\d+$/)).toBeVisible();

  await context.setOffline(true);
  await page
    .getByLabel("Article title", { exact: true })
    .fill("Offline probe revised");
  await expect
    .poll(async () =>
      page
        .getByRole("alert")
        .filter({ hasText: "Offline — Draft not saved" })
        .count(),
    )
    .toBeGreaterThan(0);
  await expect(
    page.getByRole("status").filter({ hasText: "Offline" }),
  ).toBeVisible();

  await context.setOffline(false);
});

test("Slug taken blocks Publish after a conflicting autosave", async ({
  page,
}) => {
  await page.goto("/admin/articles");
  await page.getByRole("button", { name: "Create Article Draft" }).click();
  await waitForEditor(page);

  await page
    .getByLabel("Article title", { exact: true })
    .fill("Slug conflict probe");
  await page.getByLabel("Article body").fill("A body worth publishing.");
  await expect(page.getByText(/^Saved · Draft v\d+$/)).toBeVisible();

  await page.getByRole("tab", { name: "Advanced", exact: true }).click();
  await page.getByLabel("Slug (optional)").fill("claimed-slug");

  await page.route(/\/api\/admin\/articles\/[^/]+\/draft$/, async (route) => {
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        status: "error",
        code: "ARTICLE_SLUG_CONFLICT",
      }),
    });
  });

  await page.getByLabel("Slug (optional)").fill("claimed-slug-again");
  await expect(page.getByRole("alert")).toContainText(
    "Slug is already claimed",
  );
  await expect(
    page.getByRole("status").filter({ hasText: "Slug taken" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Publish", exact: true }),
  ).toBeDisabled();
});

test("Media library surfaces cleanup blocked, awaiting, and failed Asset states", async ({
  page,
}) => {
  const assets: AssetLibraryEntry[] = [
    makeAsset({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      originalFilename: "referenced.png",
      references: { currentDrafts: 1, retainedPublications: 0 },
    }),
    makeAsset({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      originalFilename: "awaiting-cleanup.png",
      lifecycleState: "pending_deletion",
      failureCode: null,
    }),
    makeAsset({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      originalFilename: "cleanup-failed.png",
      lifecycleState: "pending_deletion",
      failureCode: "R2_DELETE_FAILED",
    }),
    makeAsset({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      originalFilename: "cleanable.png",
    }),
  ];

  await page.route("**/api/admin/assets", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ assets }),
      });
      return;
    }
    if (
      route.request().method() === "DELETE" &&
      route.request().url().includes("dddddddd-dddd-4ddd-8ddd-dddddddddddd")
    ) {
      await route.fulfill({ status: 409, body: "Asset referenced" });
      return;
    }
    await route.continue();
  });

  await page.goto("/admin/media");
  await expect(page.getByRole("heading", { name: "Media" })).toBeVisible();
  await expect(page.getByText("In use", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Awaiting cleanup", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Cleanup failed", { exact: true })).toBeVisible();

  const referencedCell = page
    .getByRole("list", { name: "Managed Assets" })
    .getByRole("button")
    .filter({ hasText: "referenced.png" });
  await referencedCell.click();
  let details = page.getByRole("dialog", { name: "Asset details" });
  await expect(
    details.getByText("Referenced — cleanup is blocked"),
  ).toBeVisible();
  await expect(
    details.getByRole("button", { name: "Clean up Asset" }),
  ).toBeDisabled();
  await details.getByRole("button", { name: "Close asset details" }).click();

  const awaitingCell = page
    .getByRole("list", { name: "Managed Assets" })
    .getByRole("button")
    .filter({ hasText: "awaiting-cleanup.png" });
  await awaitingCell.click();
  details = page.getByRole("dialog", { name: "Asset details" });
  await expect(details.getByText("Cleanup queued")).toBeVisible();
  await details.getByRole("button", { name: "Close asset details" }).click();

  const failedCell = page
    .getByRole("list", { name: "Managed Assets" })
    .getByRole("button")
    .filter({ hasText: "cleanup-failed.png" });
  await failedCell.click();
  details = page.getByRole("dialog", { name: "Asset details" });
  await expect(
    details.getByText("Cleanup failed", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    details.getByRole("button", { name: "Retry Asset cleanup" }),
  ).toBeVisible();
  await details.getByRole("button", { name: "Close asset details" }).click();

  const cleanableCell = page
    .getByRole("list", { name: "Managed Assets" })
    .getByRole("button")
    .filter({ hasText: "cleanable.png" });
  await cleanableCell.click();
  details = page.getByRole("dialog", { name: "Asset details" });
  await details.getByRole("button", { name: "Clean up Asset" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Confirm permanent cleanup" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Asset became referenced",
  );
});

test("Trash purge success shows the permanent deletion empty state", async ({
  page,
}) => {
  await page.goto("/admin/articles");
  await page.getByRole("button", { name: "Create Article Draft" }).click();
  await waitForEditor(page);

  const title = "Purge acceptance probe";
  await page.getByLabel("Article title", { exact: true }).fill(title);
  await page
    .getByLabel("Article body")
    .fill("Scheduled for permanent deletion.");
  await expect(page.getByText(/^Saved · Draft v\d+$/)).toBeVisible();

  await page
    .getByRole("button", { name: "Move this Article to Trash?" })
    .click();
  await page
    .getByRole("alertdialog", { name: "Move this Article to Trash?" })
    .getByRole("button", { name: "Move Article to Trash" })
    .click();
  await expect(page).toHaveURL(/\/admin\/articles$/);

  await page.getByRole("link", { name: "Trash" }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();

  await page
    .getByRole("button", { name: `Permanently purge ${title}` })
    .click();
  await page
    .getByRole("alertdialog", { name: "Delete permanently" })
    .getByRole("textbox")
    .fill("confirm delete");
  await page
    .getByRole("alertdialog", { name: "Delete permanently" })
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();

  await expect(
    page.getByRole("heading", { name: "Deleted permanently" }),
  ).toBeVisible();
  await expect(page.getByText(/410 Gone/, { exact: false })).toBeVisible();
  await expect(page.getByText(/media files were not touched/i)).toBeVisible();
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);
});

test("Articles heading uses zh-CN glossary on the Articles page", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: playwrightBaseUrl,
    locale: "zh-CN",
  });
  const page = await context.newPage();
  await ensureSignedIn(page);
  await page.goto("/admin/articles");
  await expect(
    page.getByRole("heading", { name: "文章", exact: true }),
  ).toBeVisible();
  await context.close();
});

test("Articles shell responds at phone, tablet, and desktop breakpoints", async ({
  page,
}) => {
  await page.route("**/api/admin/articles", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ articles: [] }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/admin/articles");
  await expect(
    page.getByRole("heading", { name: "Articles", exact: true }),
  ).toBeVisible();

  await page.setViewportSize({ width: 860, height: 900 });
  await expect(
    page.getByRole("heading", { name: "Articles", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    page.getByRole("button", { name: "Close navigation" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Close navigation" }),
  ).toHaveCount(0);

  await page.setViewportSize({ width: 861, height: 900 });
  await expect(
    page.getByRole("heading", { name: "Articles", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Content sections" }),
  ).toBeVisible();

  await page.setViewportSize({ width: 1025, height: 900 });
  await expect(
    page.getByRole("heading", { name: "Articles", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Content sections" }),
  ).toBeVisible();
});

test("Media asset details drawer restores focus to its trigger", async ({
  page,
}) => {
  const assets = [
    makeAsset({
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      originalFilename: "focus-restore.png",
    }),
  ];

  await page.route("**/api/admin/assets", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ assets }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/admin/media");
  const assetCell = page
    .getByRole("list", { name: "Managed Assets" })
    .getByRole("button")
    .filter({ hasText: "focus-restore.png" });
  await assetCell.click();
  const details = page.getByRole("dialog", { name: "Asset details" });
  await expect(details).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);
  await expect(assetCell).toBeFocused();
});

test("Settings drawer Escape restores focus to the identity menu trigger", async ({
  page,
}) => {
  await page.goto("/admin/articles");
  const identityMenu = await openIdentityMenu(page, "Settings");
  await page.getByRole("menuitem", { name: "Settings" }).click();
  const settingsDialog = page.getByRole("dialog", {
    name: "Settings",
    exact: true,
  });
  await expect(settingsDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settingsDialog).toHaveCount(0);
  await expect(identityMenu).toBeFocused();
});
