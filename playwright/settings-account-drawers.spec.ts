import { expect, test } from "playwright/test";

const setupSecret = "playwright-only-setup-secret-32-characters";
const administratorEmail = "administrator@example.test";
const administratorPassword = "playwright-only-password";
const replacementPassword = "playwright-replacement-password";

async function openIdentityMenu(
  page: import("playwright/test").Page,
  options: {
    email: string;
    itemName: string;
    triggerPrefix?: string;
  },
) {
  const triggerPrefix =
    options.triggerPrefix ?? "Settings and account menu — ";
  const trigger = page.getByRole("button", {
    name: `${triggerPrefix}${options.email}`,
  });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const item = page.getByRole("menuitem", { name: options.itemName });
  try {
    await expect(item).toBeVisible({ timeout: 3_000 });
  } catch {
    await trigger.click();
    await expect(item).toBeVisible();
  }
  return trigger;
}

test("Settings and Account drawers expose localized security feedback", async ({
  page,
}) => {
  await page.goto("/admin/setup");
  await page.getByLabel("Setup code").fill(setupSecret);
  await page.getByLabel("Admin email").fill(administratorEmail);
  await page.getByLabel("Password").fill(administratorPassword);
  await page.getByRole("button", { name: "Initialize Briefly" }).click();
  await page.getByRole("button", { name: "Continue to sign in" }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.waitForLoadState("networkidle");

  await page.getByLabel("Email").fill(administratorEmail);
  await page.getByLabel("Password").fill(administratorPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin\/articles$/);
  await expect(
    page.getByRole("heading", { name: "Articles", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: `Settings and account menu — ${administratorEmail}`,
    }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");

  await test.step("Settings validation, save failure retry, and focus restoration", async () => {
    const identityMenu = await openIdentityMenu(page, {
      email: administratorEmail,
      itemName: "Settings",
    });
    await page.getByRole("menuitem", { name: "Settings" }).click();
    const settingsDialog = page.getByRole("dialog", {
      name: "Settings",
      exact: true,
    });
    await expect(settingsDialog).toBeVisible();
    await expect(
      settingsDialog.getByText("Public content defaults", { exact: false }),
    ).toBeVisible();

    await page.route("**/api/admin/site-settings", async (route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            status: "error",
            code: "SITE_SETTINGS_INVALID",
            issues: [
              {
                path: "defaultByline.url",
                message: "Use an HTTP or HTTPS URL.",
              },
            ],
          }),
        });
        return;
      }
      await route.continue();
    });
    await settingsDialog.getByRole("button", { name: "Save changes" }).click();
    await expect(
      settingsDialog.getByText("1 field needs attention", { exact: true }),
    ).toBeVisible();
    await expect(
      settingsDialog.getByText("Use an HTTP or HTTPS URL.", { exact: true }),
    ).toBeVisible();
    await page.unroute("**/api/admin/site-settings");

    await page.route("**/api/admin/site-settings", async (route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ status: "error", code: "INTERNAL_ERROR" }),
        });
        return;
      }
      await route.continue();
    });
    await settingsDialog.getByRole("button", { name: "Save changes" }).click();
    await expect(
      settingsDialog.getByText("Couldn't save Site Settings", { exact: true }),
    ).toBeVisible();
    await expect(
      settingsDialog.getByRole("button", { name: "Retry" }),
    ).toBeVisible();
    await page.unroute("**/api/admin/site-settings");

    await page.keyboard.press("Escape");
    await expect(settingsDialog).toHaveCount(0);
    await expect(identityMenu).toBeFocused();
  });

  await test.step("Account identity, password validation, sign-out failure, and zh-CN labels", async () => {
    await openIdentityMenu(page, {
      email: administratorEmail,
      itemName: "Account",
    });
    await page.getByRole("menuitem", { name: "Account" }).click();
    const accountDialog = page.getByRole("dialog", {
      name: "Account",
      exact: true,
    });
    await expect(accountDialog).toBeVisible();
    await expect(accountDialog.getByLabel("Email")).toHaveValue(
      administratorEmail,
    );
    await expect(
      accountDialog.getByText("public Byline lives in Site Settings", {
        exact: false,
      }),
    ).toBeVisible();

    await accountDialog
      .getByLabel("Current password")
      .fill(administratorPassword);
    await accountDialog.getByLabel("New password").fill("short");
    await accountDialog.getByRole("button", { name: "Update password" }).click();
    await expect(
      accountDialog.getByText("Too short — 5 of 12 required characters.", {
        exact: true,
      }),
    ).toBeVisible();

    await page.route("**/api/auth/sign-out", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ status: "error", code: "INTERNAL_ERROR" }),
      });
    });
    await accountDialog.getByRole("button", { name: "Sign out" }).click();
    await expect(
      accountDialog.getByText("Unable to sign out", { exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/articles$/);
    await page.unroute("**/api/auth/sign-out");
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Account", exact: true }),
    ).toHaveCount(0);
  });

  await test.step("password success states revocation then hands off to login", async () => {
    await openIdentityMenu(page, {
      email: administratorEmail,
      itemName: "Account",
    });
    await page.getByRole("menuitem", { name: "Account" }).click();
    const accountDialog = page.getByRole("dialog", {
      name: "Account",
      exact: true,
    });
    await accountDialog
      .getByLabel("Current password")
      .fill(administratorPassword);
    await accountDialog.getByLabel("New password").fill(replacementPassword);
    await accountDialog.getByRole("button", { name: "Update password" }).click();
    await expect(
      accountDialog.getByText("Password updated", { exact: true }),
    ).toBeVisible();
    await expect(
      accountDialog.getByText("have been revoked", { exact: false }),
    ).toBeVisible();
    await accountDialog
      .getByRole("button", { name: "Continue to sign in" })
      .click();
    await expect(page).toHaveURL(/\/admin\/login\?notice=password-updated$/);
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByText("Password updated", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("All sessions were revoked", { exact: false }),
    ).toBeVisible();

    await page.getByLabel("Email").fill(administratorEmail);
    await page.getByLabel("Password").fill(administratorPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(
      page.getByText("Incorrect email or password", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Password").fill(replacementPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/admin\/articles$/);
    await expect(
      page.getByRole("button", {
        name: `Settings and account menu — ${administratorEmail}`,
      }),
    ).toBeVisible();
  });
});
