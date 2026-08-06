import { expect, test } from "playwright/test";

import { playwrightBaseUrl } from "./runtime";

const setupSecret = "playwright-only-setup-secret-32-characters";
const administratorEmail = "administrator@example.test";
const administratorPassword = "playwright-only-password";
const originalTitle = "A durable first Publication";
const revisedTitle = "A revised durable Publication";
const postPublishDraftTitle = "A private post-publish Draft";
const concurrentConflictDraftTitle = "A Draft edited during conflict";
const slug = "critical-browser-journey";
const originalBody = "The first immutable public body.";
const revisedBody = "The revised immutable public body.";
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

interface PublicArticle {
  id: string;
  slug: string;
  title: string;
  publishedAt: string;
  updatedAt: string;
  html: string;
}

interface PublicationReceipt {
  publicationId: string;
  draftVersion: number;
  article: PublicArticle;
}

interface PublishCommand {
  draftVersion: number;
  expectedCurrentPublicationId: string | null;
}

test("the home introduction uses the full content width", async ({ page }) => {
  await page.goto("/");
  const introduction = page.getByRole("region", { name: "About this site" });
  await expect(introduction).toBeVisible();

  const widths = await introduction.evaluate((element) => ({
    introduction: element.getBoundingClientRect().width,
    content: element.parentElement?.getBoundingClientRect().width ?? 0,
  }));

  expect(widths.introduction).toBe(widths.content);
});

test("a first-time Administrator publishes, revises, and withdraws an Asset-backed Article", async ({
  browser,
  page,
}) => {
  const anonymous = await browser.newContext({ baseURL: playwrightBaseUrl });
  const anonymousPage = await anonymous.newPage();
  const pressResponderWarnings: string[] = [];
  const publicationPosts: PublishCommand[] = [];
  const privateArticleReads: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("PressResponder was rendered without")) {
      pressResponderWarnings.push(message.text());
    }
  });
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (
      request.method() === "POST" &&
      /\/api\/admin\/articles\/[^/]+\/publications$/.test(pathname)
    ) {
      publicationPosts.push(request.postDataJSON() as PublishCommand);
    }
    if (
      request.method() === "GET" &&
      /\/api\/admin\/articles\/[^/]+$/.test(pathname)
    ) {
      privateArticleReads.push(pathname);
    }
  });

  await test.step("show the restored sign-in and recovery surfaces", async () => {
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Emergency recovery" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "First-run setup" }),
    ).toBeVisible();
    await expect(
      page.getByText("Briefly · First-run setup", { exact: true }),
    ).toBeVisible();

    await page.goto("/recover");
    await expect(
      page.getByRole("heading", { name: "Emergency recovery" }),
    ).toBeVisible();
    await expect(page.getByLabel("Recovery Secret")).toHaveAttribute(
      "placeholder",
      "Enter recovery secret",
    );
    await expect(page.getByRole("link", { name: "Set code" })).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Back to sign in" }),
    ).toBeVisible();
  });

  await test.step("initialize the sole Administrator through the visible setup flow", async () => {
    await page.goto("/setup");
    await expect(
      page.getByRole("heading", { name: "First-run setup" }),
    ).toBeVisible();
    await expect(page.getByText("Briefly", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Get code" })).toHaveCount(0);
    await expect(page.getByLabel("Setup code")).toHaveAttribute(
      "placeholder",
      "Enter setup code",
    );
    await page.getByLabel("Setup code").fill(setupSecret);
    await page.getByLabel("Admin email").fill(administratorEmail);
    await page.getByLabel("Password").fill(administratorPassword);
    await page.getByRole("button", { name: "Initialize Briefly" }).click();
    await expect(
      page.getByText("Initialization complete", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Continue to sign in" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await page.waitForLoadState("networkidle");
  });

  await test.step("sign in visibly while an anonymous browser remains isolated", async () => {
    await page.getByLabel("Email").fill(administratorEmail);
    await page.getByLabel("Password").fill(administratorPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(
      page.getByRole("heading", { name: "Administrator session" }),
    ).toBeVisible();

    await anonymousPage.goto("/admin");
    await expect(anonymousPage).toHaveURL(/\/sign-in$/);
    const anonymousSession = await anonymous.request.get("/api/admin/session");
    expect(anonymousSession.status()).toBe(401);
  });

  await test.step("hydrate Tiptap only on the client and warn before discarding unsaved work", async () => {
    let releaseEditor: (() => void) | undefined;
    const editorMayLoad = new Promise<void>((resolve) => {
      releaseEditor = resolve;
    });
    await page.route(/-article-editor/, async (route) => {
      await editorMayLoad;
      await route.continue();
    });

    await page.getByRole("button", { name: "Create Article Draft" }).click();
    await expect(page).toHaveURL(/\/admin\/articles\/[^/]+$/);
    await expect(page.getByText("Loading the text-rich editor…")).toBeVisible();
    releaseEditor?.();

    await expect(page.getByLabel("Article body")).toBeVisible();
    await page.getByLabel("Article title", { exact: true }).fill(originalTitle);
    await expect(
      page.getByText("Unsaved changes", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Publish", exact: true }),
    ).toBeDisabled();

    const warning = page.waitForEvent("dialog");
    const attemptedNavigation = page.evaluate(() =>
      globalThis.location.assign("/"),
    );
    const dialog = await warning;
    expect(dialog.type()).toBe("beforeunload");
    await dialog.dismiss();
    await attemptedNavigation;
    await expect(page).toHaveURL(/\/admin\/articles\/[^/]+$/);
  });

  await test.step("author metadata, text, and an accessible figure, then await a server-confirmed autosave", async () => {
    await page.getByLabel("Unicode slug (optional)").fill(slug);
    await page
      .getByLabel("Plain-text summary (optional)")
      .fill("A browser-proven Publication.");
    await page.getByLabel("Article body").fill(originalBody);

    const insertImageButton = page.getByRole("button", {
      name: "Insert image",
      exact: true,
    });
    await insertImageButton.click();
    const mediaDialog = page.getByRole("dialog", { name: "Insert image" });
    await expect(
      mediaDialog.getByRole("tab", { name: "Library", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await mediaDialog
      .getByRole("tab", { name: "Upload new", exact: true })
      .click();
    await mediaDialog.getByLabel("Upload a verified image").setInputFiles({
      name: "critical-journey.png",
      mimeType: "image/png",
      buffer: onePixelPng,
    });
    await mediaDialog
      .getByRole("button", { name: "Upload and select image" })
      .click();
    await expect(
      page.getByText("critical-journey.png uploaded and selected.", {
        exact: true,
      }),
    ).toBeVisible();
    await mediaDialog
      .getByLabel("Figure alternative text")
      .fill("A single pixel proving stable public media");
    await mediaDialog
      .getByRole("button", { name: "Insert selected Asset as figure" })
      .click();
    await expect(
      mediaDialog.getByRole("list", { name: "Figures in this Draft" }),
    ).toContainText("Figure 1");
    await mediaDialog
      .getByRole("button", { name: "Close insert image dialog" })
      .click();
    await expect(insertImageButton).toBeFocused();

    await expect(page.getByText(/^Saved · Draft v\d+$/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Publish", exact: true }),
    ).toBeEnabled();
  });

  await test.step("preview only the saved private Draft", async () => {
    const previewButton = page.getByRole("button", {
      name: "Preview",
      exact: true,
    });
    const previewResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/api\/admin\/articles\/[^/]+\/preview$/.test(
          new URL(response.url()).pathname,
        ),
    );
    await previewButton.click();
    const previewResponse = await previewResponsePromise;
    expect(previewResponse.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: originalTitle, exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByLabel("Saved Draft Preview")
        .getByText(originalBody, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Saved Draft Preview").getByRole("img", {
        name: "A single pixel proving stable public media",
      }),
    ).toBeVisible();

    const preview = (await previewResponse.json()) as { draftVersion: number };
    expect(previewResponse.request().postDataJSON()).toEqual({
      draftVersion: preview.draftVersion,
    });
    const anonymousPreview = await anonymous.request.post(
      new URL(previewResponse.url()).pathname,
      { data: { draftVersion: preview.draftVersion } },
    );
    expect(anonymousPreview.status()).toBe(401);
    expect(
      (await anonymous.request.get(`/api/articles/${slug}`)).status(),
    ).toBe(404);
    await page.getByRole("button", { name: "Close preview" }).click();
    await expect(previewButton).toBeFocused();
    await expect(page.locator('[data-slot="drawer-backdrop"]')).toHaveCount(0);
  });

  let firstPublication: PublicArticle;
  let firstPublicationReceipt: PublicationReceipt;
  let republishReceipt: PublicationReceipt;
  let publicMediaUrl: string;
  let releaseInitialHistory: (() => void) | undefined;
  let markInitialHistoryCaptured: (() => void) | undefined;
  let markInitialHistoryReturned: (() => void) | undefined;
  const initialHistoryMayReturn = new Promise<void>((resolve) => {
    releaseInitialHistory = resolve;
  });
  const initialHistoryCaptured = new Promise<void>((resolve) => {
    markInitialHistoryCaptured = resolve;
  });
  const initialHistoryReturned = new Promise<void>((resolve) => {
    markInitialHistoryReturned = resolve;
  });

  await test.step("publish and observe the Article and stable media anonymously", async () => {
    await page.route(
      /\/api\/admin\/articles\/[^/]+\/publications$/,
      async (route) => {
        if (route.request().method() !== "GET") {
          await route.continue();
          return;
        }
        const staleResponse = await route.fetch();
        markInitialHistoryCaptured?.();
        await initialHistoryMayReturn;
        await route.fulfill({ response: staleResponse });
        markInitialHistoryReturned?.();
      },
    );

    const privateArticleReadsBeforePublish = privateArticleReads.length;
    const publishResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/api\/admin\/articles\/[^/]+\/publications$/.test(
          new URL(response.url()).pathname,
        ),
    );
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    const confirmation = page.getByRole("alertdialog", {
      name: "Publish saved Draft?",
    });
    await confirmation
      .getByRole("button", { name: "Publish saved Draft" })
      .click();
    const publishResponse = await publishResponsePromise;
    expect(publishResponse.status()).toBe(201);
    firstPublicationReceipt =
      (await publishResponse.json()) as PublicationReceipt;
    expect(publicationPosts).toEqual([
      {
        draftVersion: firstPublicationReceipt.draftVersion,
        expectedCurrentPublicationId: null,
      },
    ]);
    expect(firstPublicationReceipt.publicationId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(firstPublicationReceipt.article).toMatchObject({
      title: originalTitle,
      slug,
      html: expect.stringContaining(originalBody),
    });
    await expect(
      page.getByText("Article published", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(firstPublicationReceipt.publicationId, { exact: false }),
    ).toBeVisible();
    expect(privateArticleReads).toHaveLength(privateArticleReadsBeforePublish);

    const detail = await anonymous.request.get(`/api/articles/${slug}`);
    expect(detail.status()).toBe(200);
    firstPublication = (await detail.json()) as PublicArticle;
    expect(firstPublication).toEqual(firstPublicationReceipt.article);
    expect(firstPublication.publishedAt).toBe(firstPublication.updatedAt);

    const mediaMatch = firstPublication.html.match(/src="([^"]+)"/);
    expect(
      mediaMatch,
      "published figure has a public media URL",
    ).not.toBeNull();
    publicMediaUrl = mediaMatch![1];
    const media = await anonymous.request.get(publicMediaUrl);
    expect(media.status()).toBe(200);
    expect(media.headers()["content-type"]).toBe("image/png");

    const list = await anonymous.request.get("/api/articles");
    expect(list.status()).toBe(200);
    expect(await list.json()).toMatchObject({
      items: [{ title: originalTitle }],
    });
  });

  await test.step("keep later autosaved edits private until an explicit republish", async () => {
    await initialHistoryCaptured;
    await page.getByLabel("Article title", { exact: true }).fill(revisedTitle);
    await page
      .getByLabel("Article body")
      .getByText(originalBody, { exact: true })
      .click({ clickCount: 3 });
    await page.keyboard.type(revisedBody);
    await expect(page.getByText(/^Saved · Draft v\d+$/)).toBeVisible();
    releaseInitialHistory?.();
    await initialHistoryReturned;
    await expect(
      page.getByText("Changes pending", { exact: true }).first(),
    ).toBeVisible();

    const stillCurrent = await anonymous.request.get(`/api/articles/${slug}`);
    expect(stillCurrent.status()).toBe(200);
    expect(await stillCurrent.json()).toEqual(firstPublication);
  });

  await test.step("keep edits made during republish private and marked pending", async () => {
    let releaseRepublish: (() => void) | undefined;
    let markRepublishCommitted: (() => void) | undefined;
    let failHistoryReloads = false;
    const republishMayReturn = new Promise<void>((resolve) => {
      releaseRepublish = resolve;
    });
    const republishCommitted = new Promise<void>((resolve) => {
      markRepublishCommitted = resolve;
    });
    await page.route(
      /\/api\/admin\/articles\/[^/]+\/publications$/,
      async (route) => {
        if (route.request().method() === "GET" && failHistoryReloads) {
          await route.fulfill({ status: 503, body: "History unavailable" });
          return;
        }
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        const response = await route.fetch();
        markRepublishCommitted?.();
        await republishMayReturn;
        await route.fulfill({ response });
      },
    );

    const privateArticleReadsBeforeRepublish = privateArticleReads.length;
    const republishResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/api\/admin\/articles\/[^/]+\/publications$/.test(
          new URL(response.url()).pathname,
        ),
    );
    await page.getByRole("button", { name: "Republish", exact: true }).click();
    const confirmation = page.getByRole("alertdialog", {
      name: "Republish saved Draft?",
    });
    await confirmation
      .getByRole("button", { name: "Republish saved Draft" })
      .click();
    await republishCommitted;
    await page
      .getByLabel("Article title", { exact: true })
      .fill(postPublishDraftTitle);
    await expect(page.getByText(/^Saved · Draft v\d+$/)).toBeVisible();
    const rail = page.getByRole("complementary", {
      name: "Article settings",
    });
    const savedDraftVersion = await rail
      .getByText(/^v\d+ · saved$/)
      .textContent();
    try {
      await expect(
        rail.getByRole("button", { name: "Republish saved Draft" }),
      ).toBeDisabled();
    } finally {
      failHistoryReloads = true;
      releaseRepublish?.();
    }
    const republishResponse = await republishResponsePromise;
    expect(republishResponse.status()).toBe(201);
    republishReceipt = (await republishResponse.json()) as PublicationReceipt;
    expect(publicationPosts).toEqual([
      {
        draftVersion: firstPublicationReceipt.draftVersion,
        expectedCurrentPublicationId: null,
      },
      {
        draftVersion: republishReceipt.draftVersion,
        expectedCurrentPublicationId: firstPublicationReceipt.publicationId,
      },
    ]);
    expect(republishReceipt.publicationId).not.toBe(
      firstPublicationReceipt.publicationId,
    );
    expect(republishReceipt.article).toMatchObject({
      title: revisedTitle,
      slug,
      html: expect.stringContaining(revisedBody),
    });
    await expect(
      page.getByText("Article republished", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(republishReceipt.publicationId, { exact: false }),
    ).toBeVisible();
    expect(privateArticleReads).toHaveLength(
      privateArticleReadsBeforeRepublish,
    );
    await page.getByRole("tab", { name: /History/ }).click();
    await expect(
      page.getByText("Unable to load Publication History", { exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    await expect(
      rail.getByText("Changes pending", { exact: true }),
    ).toBeVisible();
    await expect(
      rail.getByText("The Draft is ahead; live content is unchanged.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      rail.getByText(savedDraftVersion!, { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Article title", { exact: true })).toHaveValue(
      postPublishDraftTitle,
    );
    await expect(
      rail.getByRole("button", { name: "Republish saved Draft" }),
    ).toBeEnabled();
    failHistoryReloads = false;

    const detail = await anonymous.request.get(`/api/articles/${slug}`);
    expect(detail.status()).toBe(200);
    const republished = (await detail.json()) as PublicArticle;
    expect(republished).toEqual(republishReceipt.article);
    expect(republished.title).toBe(revisedTitle);
    expect(republished.html).toContain(revisedBody);
    expect(republished.html).not.toContain(originalBody);
    expect(republished.publishedAt).toBe(firstPublication.publishedAt);
    expect(Date.parse(republished.updatedAt)).toBeGreaterThan(
      Date.parse(firstPublication.updatedAt),
    );
    expect(republished.html).toContain(publicMediaUrl);
    expect(publicationPosts).toHaveLength(2);
  });

  await test.step("target canonical Publication Issues at their authoring surfaces", async () => {
    const issueMessages = {
      title: "Give this Article a Publication title.",
      slug: "Choose a Publication slug.",
      body: "Remove the unsupported body node.",
      byline: "Provide a Publication byline.",
      language: "Use a supported Publication language.",
      cover: "Describe the Publication cover.",
      asset: "Replace the unavailable referenced Asset.",
    };
    const publicationPostsBeforeValidation = publicationPosts.length;
    await page.route(
      /\/api\/admin\/articles\/[^/]+\/publications$/,
      async (route) => {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            status: "error",
            code: "PUBLICATION_INVALID",
            issues: [
              {
                code: "REQUIRED",
                path: "draft.title",
                message: issueMessages.title,
              },
              {
                code: "INVALID",
                path: "draft.slug",
                message: issueMessages.slug,
              },
              {
                code: "UNSUPPORTED",
                path: "draft.document.doc.content.0",
                message: issueMessages.body,
              },
              {
                code: "REQUIRED",
                path: "draft.byline",
                message: issueMessages.byline,
              },
              {
                code: "INVALID",
                path: "draft.language",
                message: issueMessages.language,
              },
              {
                code: "REQUIRED",
                path: "draft.cover.alt",
                message: issueMessages.cover,
              },
              {
                code: "UNAVAILABLE",
                path: `draft.assets.${firstPublicationReceipt.article.id}`,
                message: issueMessages.asset,
              },
            ],
          }),
        });
      },
      { times: 1 },
    );

    await page.getByRole("button", { name: "Republish", exact: true }).click();
    await page
      .getByRole("alertdialog", { name: "Republish saved Draft?" })
      .getByRole("button", { name: "Republish saved Draft" })
      .click();

    await expect(
      page.getByText("Publication validation failed", { exact: true }),
    ).toBeVisible();
    expect(publicationPosts).toHaveLength(publicationPostsBeforeValidation + 1);

    const writingSurface = page.getByLabel("Article writing surface");
    await expect(
      writingSurface.getByText(issueMessages.title, { exact: true }),
    ).toBeVisible();
    await expect(
      writingSurface.getByText(issueMessages.body, { exact: true }),
    ).toBeVisible();

    const settingsRail = page.getByRole("complementary", {
      name: "Article settings",
    });
    for (const message of [
      issueMessages.title,
      issueMessages.slug,
      issueMessages.byline,
      issueMessages.language,
      issueMessages.cover,
    ]) {
      await expect(
        settingsRail.getByText(message, { exact: true }),
      ).toBeVisible();
    }

    await page
      .getByRole("button", { name: "Insert image", exact: true })
      .click();
    const mediaDialog = page.getByRole("dialog", { name: "Insert image" });
    await expect(
      mediaDialog.getByText("Referenced Asset needs attention", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      mediaDialog.getByText(issueMessages.asset, { exact: true }),
    ).toBeVisible();
    await mediaDialog
      .getByRole("button", { name: "Close insert image dialog" })
      .click();
  });

  await test.step("reread a Publication Conflict without replaying Publish", async () => {
    await page
      .getByLabel("Article title", { exact: true })
      .fill(`${postPublishDraftTitle} before conflict`);
    await expect(
      page.getByText("Unsaved changes", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/^Saved · Draft v\d+$/)).toBeVisible();

    let releaseConflict: (() => void) | undefined;
    let markConflictCaptured: (() => void) | undefined;
    const conflictMayReturn = new Promise<void>((resolve) => {
      releaseConflict = resolve;
    });
    const conflictCaptured = new Promise<void>((resolve) => {
      markConflictCaptured = resolve;
    });
    await page.route(
      /\/api\/admin\/articles\/[^/]+\/publications$/,
      async (route) => {
        markConflictCaptured?.();
        await conflictMayReturn;
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            status: "error",
            code: "PUBLICATION_CONFLICT",
          }),
        });
      },
      { times: 1 },
    );

    const publicationPostsBeforeConflict = publicationPosts.length;
    const articleReadsBeforeConflict = privateArticleReads.length;
    await page.getByRole("button", { name: "Republish", exact: true }).click();
    await page
      .getByRole("alertdialog", { name: "Republish saved Draft?" })
      .getByRole("button", { name: "Republish saved Draft" })
      .click();
    await conflictCaptured;
    try {
      await page
        .getByLabel("Article title", { exact: true })
        .fill(concurrentConflictDraftTitle);
      await expect(
        page.getByText("Unsaved changes", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText(/^Saved · Draft v\d+$/)).toBeVisible();
    } finally {
      releaseConflict?.();
    }

    await expect(
      page.getByText("Publication conflict", { exact: true }),
    ).toBeVisible();
    expect(privateArticleReads.length).toBeGreaterThan(
      articleReadsBeforeConflict,
    );
    expect(publicationPosts).toHaveLength(publicationPostsBeforeConflict + 1);
    await expect(page.getByLabel("Article title", { exact: true })).toHaveValue(
      concurrentConflictDraftTitle,
    );

    await page
      .getByRole("button", { name: "Continue with refreshed state" })
      .click();
    await expect(
      page.getByText("Publication conflict", { exact: true }),
    ).toHaveCount(0);
    expect(publicationPosts).toHaveLength(publicationPostsBeforeConflict + 1);
  });

  await test.step("reconcile a transport failure without replaying Publish", async () => {
    await page.route(
      /\/api\/admin\/articles\/[^/]+\/publications$/,
      async (route) => {
        await route.abort("connectionreset");
      },
      { times: 1 },
    );
    const publicationPostsBeforeFailure = publicationPosts.length;

    await page.getByRole("button", { name: "Republish", exact: true }).click();
    await page
      .getByRole("alertdialog", { name: "Republish saved Draft?" })
      .getByRole("button", { name: "Republish saved Draft" })
      .click();

    await expect(
      page.getByText("Publish connection was interrupted", { exact: true }),
    ).toBeVisible();
    expect(publicationPosts).toHaveLength(publicationPostsBeforeFailure + 1);
    await expect(page.getByLabel("Article title", { exact: true })).toHaveValue(
      concurrentConflictDraftTitle,
    );
    await page
      .getByRole("button", { name: "Continue with refreshed state" })
      .click();
    expect(publicationPosts).toHaveLength(publicationPostsBeforeFailure + 1);
  });

  await test.step("retry a confirmed non-completion only after explicit approval", async () => {
    await page.route(
      /\/api\/admin\/articles\/[^/]+\/publications$/,
      async (route) => {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            status: "error",
            code: "PUBLICATION_NOT_COMPLETED",
          }),
        });
      },
      { times: 1 },
    );
    const publicationPostsBeforeNonCompletion = publicationPosts.length;

    await page.getByRole("button", { name: "Republish", exact: true }).click();
    await page
      .getByRole("alertdialog", { name: "Republish saved Draft?" })
      .getByRole("button", { name: "Republish saved Draft" })
      .click();

    await expect(
      page.getByText("Publication was not completed", { exact: true }),
    ).toBeVisible();
    expect(publicationPosts).toHaveLength(
      publicationPostsBeforeNonCompletion + 1,
    );

    await page.route(
      /\/api\/admin\/articles\/[^/]+\/publications$/,
      async (route) => {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            status: "error",
            code: "PUBLICATION_STATE_UNCONFIRMED",
          }),
        });
      },
      { times: 1 },
    );
    await page
      .getByRole("button", { name: "Retry this Publish command" })
      .click();
    await expect(
      page.getByText("Publication outcome needs review", { exact: true }),
    ).toBeVisible();
    expect(publicationPosts).toHaveLength(
      publicationPostsBeforeNonCompletion + 2,
    );
    await page
      .getByRole("button", { name: "Continue with refreshed state" })
      .click();
    expect(publicationPosts).toHaveLength(
      publicationPostsBeforeNonCompletion + 2,
    );
  });

  await test.step("reconcile an unconfirmed outcome without replaying Publish", async () => {
    await page.route(
      /\/api\/admin\/articles\/[^/]+\/publications$/,
      async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            status: "error",
            code: "PUBLICATION_STATE_UNCONFIRMED",
          }),
        });
      },
      { times: 1 },
    );

    const publicationPostsBeforeUnconfirmed = publicationPosts.length;
    await page.getByRole("button", { name: "Republish", exact: true }).click();
    const confirmation = page.getByRole("alertdialog", {
      name: "Republish saved Draft?",
    });
    await confirmation
      .getByRole("button", { name: "Republish saved Draft" })
      .click();

    await expect(
      page.getByText("Publication outcome needs review", { exact: true }),
    ).toBeVisible();
    expect(publicationPosts).toHaveLength(
      publicationPostsBeforeUnconfirmed + 1,
    );
    expect(publicationPosts.at(-1)).toMatchObject({
      expectedCurrentPublicationId: republishReceipt.publicationId,
    });
    expect(publicationPosts.at(-1)!.draftVersion).toBeGreaterThan(
      republishReceipt.draftVersion,
    );
    await expect(page.getByLabel("Article title", { exact: true })).toHaveValue(
      concurrentConflictDraftTitle,
    );
    const stillCurrent = await anonymous.request.get(`/api/articles/${slug}`);
    expect(stillCurrent.status()).toBe(200);
    expect(await stillCurrent.json()).toEqual(republishReceipt.article);
    expect(publicationPosts).toHaveLength(
      publicationPostsBeforeUnconfirmed + 1,
    );

    await page
      .getByRole("button", { name: "Continue with refreshed state" })
      .click();
    await expect(
      page.getByText("Publication outcome needs review", { exact: true }),
    ).toHaveCount(0);
    expect(publicationPosts).toHaveLength(
      publicationPostsBeforeUnconfirmed + 1,
    );
  });

  await test.step("identify the live Publication without offering a no-op restore", async () => {
    await page.getByRole("tab", { name: /History/ }).click();
    await page
      .getByRole("button", { name: "Load retained Publications" })
      .click();
    const history = page.getByRole("list", { name: "Retained Publications" });
    await expect(history.getByText("Live", { exact: true })).toBeVisible();
    await expect(
      history.getByRole("button", { name: "Restore Publication 2" }),
    ).toBeDisabled();
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
  });

  await test.step("unpublish immediately while retaining the authenticated Draft", async () => {
    await page.getByRole("button", { name: "Unpublish this Article?" }).click();
    const confirmation = page.getByRole("alertdialog", {
      name: "Unpublish this Article?",
    });
    await confirmation
      .getByRole("button", { name: "Unpublish Article" })
      .click();
    await expect(
      page.getByText("Article unpublished", { exact: true }),
    ).toBeVisible();

    expect(
      (await anonymous.request.get(`/api/articles/${slug}`)).status(),
    ).toBe(404);
    const list = await anonymous.request.get("/api/articles");
    expect(await list.json()).toMatchObject({ items: [] });
    expect((await anonymous.request.get(publicMediaUrl)).status()).toBe(200);

    await page.reload();
    await expect(page).toHaveURL(/\/admin\/articles\/[^/]+$/);
    await expect(page.getByLabel("Article title", { exact: true })).toHaveValue(
      concurrentConflictDraftTitle,
    );
    await expect(page.getByLabel("Article body")).toContainText(revisedBody);
  });

  expect(pressResponderWarnings).toEqual([]);
  await anonymous.close();
});
