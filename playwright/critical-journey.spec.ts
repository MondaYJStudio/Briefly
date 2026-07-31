import { expect, test } from "playwright/test";

import { playwrightBaseUrl } from "./runtime";

const setupSecret = "playwright-only-setup-secret-32-characters";
const administratorEmail = "administrator@example.test";
const administratorPassword = "playwright-only-password";
const originalTitle = "A durable first Publication";
const revisedTitle = "A revised durable Publication";
const slug = "critical-browser-journey";
const originalBody = "The first immutable public body.";
const revisedBody = "The revised immutable public body.";
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

interface PublicArticle {
  title: string;
  publishedAt: string;
  updatedAt: string;
  html: string;
}

test("a first-time Administrator publishes, revises, and withdraws an Asset-backed Article", async ({
  browser,
  page,
}) => {
  const anonymous = await browser.newContext({ baseURL: playwrightBaseUrl });
  const anonymousPage = await anonymous.newPage();

  await test.step("initialize the sole Administrator through the visible setup flow", async () => {
    await page.goto("/setup");
    await expect(
      page.getByRole("heading", { name: "Initialize Briefly" }),
    ).toBeVisible();
    await page.getByLabel("Setup secret").fill(setupSecret);
    await page.getByLabel("Administrator email").fill(administratorEmail);
    await page.getByLabel("Password").fill(administratorPassword);
    await page.getByRole("button", { name: "Initialize" }).click();
    await expect(
      page.getByText("Initialization complete", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Continue to sign in" }).click();
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
    await expect(page.getByText("Loading the text-rich editor…")).toBeVisible();
    releaseEditor?.();

    await expect(page.getByLabel("Article body")).toBeVisible();
    await page.getByLabel("Title", { exact: true }).fill(originalTitle);
    await expect(page.getByText(/Unsaved changes — autosaving/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Publish saved Draft" }),
    ).toBeDisabled();

    const warning = page.waitForEvent("dialog");
    const attemptedNavigation = page.evaluate(() =>
      globalThis.location.assign("/"),
    );
    const dialog = await warning;
    expect(dialog.type()).toBe("beforeunload");
    await dialog.dismiss();
    await attemptedNavigation;
    await expect(page).toHaveURL(/\/admin$/);
  });

  await test.step("author metadata, text, and an accessible figure, then await a server-confirmed autosave", async () => {
    await page.getByLabel("Unicode slug (optional)").fill(slug);
    await page
      .getByLabel("Plain-text summary (optional)")
      .fill("A browser-proven Publication.");
    await page.getByLabel("Article body").fill(originalBody);

    await page.getByLabel("Upload a verified image").last().setInputFiles({
      name: "critical-journey.png",
      mimeType: "image/png",
      buffer: onePixelPng,
    });
    await page.getByRole("button", { name: "Upload and select image" }).click();
    await expect(
      page.getByText("critical-journey.png uploaded and selected.", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByLabel("Figure alternative text")
      .fill("A single pixel proving stable public media");
    await page
      .getByRole("button", { name: "Insert selected Asset as figure" })
      .click();
    await expect(
      page.getByRole("list", { name: "Figures in this Draft" }),
    ).toContainText("Figure 1");

    await expect(
      page.getByText("Complete Draft saved", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Latest client state is server-confirmed."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Publish saved Draft" }),
    ).toBeEnabled();
  });

  await test.step("preview only the saved private Draft", async () => {
    const previewResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/api\/admin\/articles\/[^/]+\/preview$/.test(
          new URL(response.url()).pathname,
        ),
    );
    await page
      .getByRole("button", { name: /Preview saved Draft Version/ })
      .click();
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
    const anonymousPreview = await anonymous.request.post(
      new URL(previewResponse.url()).pathname,
      { data: { version: preview.draftVersion } },
    );
    expect(anonymousPreview.status()).toBe(401);
    expect(
      (await anonymous.request.get(`/api/articles/${slug}`)).status(),
    ).toBe(404);
  });

  let firstPublication: PublicArticle;
  let publicMediaUrl: string;

  await test.step("publish and observe the Article and stable media anonymously", async () => {
    await page.getByRole("button", { name: "Publish saved Draft" }).click();
    const confirmation = page.getByRole("alertdialog", {
      name: "Publish saved Draft?",
    });
    await confirmation
      .getByRole("button", { name: "Publish saved Draft" })
      .click();
    await expect(
      page.getByText("Article published", { exact: true }),
    ).toBeVisible();

    const detail = await anonymous.request.get(`/api/articles/${slug}`);
    expect(detail.status()).toBe(200);
    firstPublication = (await detail.json()) as PublicArticle;
    expect(firstPublication).toMatchObject({
      title: originalTitle,
      html: expect.stringContaining(originalBody),
    });
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
    await page.getByLabel("Title", { exact: true }).fill(revisedTitle);
    await page.getByLabel("Article body").fill(revisedBody);
    await expect(
      page.getByText("Complete Draft saved", { exact: true }),
    ).toBeVisible();

    const stillCurrent = await anonymous.request.get(`/api/articles/${slug}`);
    expect(stillCurrent.status()).toBe(200);
    expect(await stillCurrent.json()).toEqual(firstPublication);
  });

  await test.step("republish a new immutable public outcome without moving Published At", async () => {
    await page.getByRole("button", { name: "Republish saved Draft" }).click();
    const confirmation = page.getByRole("alertdialog", {
      name: "Republish saved Draft?",
    });
    await confirmation
      .getByRole("button", { name: "Republish saved Draft" })
      .click();
    await expect(
      page.getByText("Article republished", { exact: true }),
    ).toBeVisible();

    const detail = await anonymous.request.get(`/api/articles/${slug}`);
    expect(detail.status()).toBe(200);
    const republished = (await detail.json()) as PublicArticle;
    expect(republished.title).toBe(revisedTitle);
    expect(republished.html).toContain(revisedBody);
    expect(republished.html).not.toContain(originalBody);
    expect(republished.publishedAt).toBe(firstPublication.publishedAt);
    expect(Date.parse(republished.updatedAt)).toBeGreaterThan(
      Date.parse(firstPublication.updatedAt),
    );
    expect(republished.html).toContain(publicMediaUrl);
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
    await page
      .getByRole("button", { name: new RegExp(`^${revisedTitle}`) })
      .click();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
      revisedTitle,
    );
    await expect(page.getByLabel("Article body")).toContainText(revisedBody);
  });

  await anonymous.close();
});
