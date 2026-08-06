#!/usr/bin/env node
/**
 * Guards the admin CSS expand→migrate→contract end state: obsolete global
 * scaffolding must stay gone, while the approved token/a11y/portal layer remains.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const adminUiCss = readFileSync(resolve(root, "src/admin-ui.css"), "utf8");
const stylesCss = readFileSync(resolve(root, "src/styles.css"), "utf8");

const obsoleteSelectors = [
  ".page-head",
  ".page-title",
  ".page-desc",
  ".page-actions",
  ".tabs-underline",
  ".tabs-line-list",
  ".tab-line",
  ".badge-planned",
  ".settings-section-title",
  ".settings-section-description",
  ".settings-actions",
  ".briefly-menu-note",
  ".kbd",
  ".cover-thumb",
  ".article-main",
  ".article-title-line",
  ".article-title",
  ".article-slug",
  ".article-meta",
  ".article-side",
  ".article-row-button",
];

const failures = [];

for (const selector of obsoleteSelectors) {
  if (adminUiCss.includes(selector)) {
    failures.push(`obsolete selector still present: ${selector}`);
  }
}

if (/(?:^|\n)\.article-list\s*\{/m.test(adminUiCss)) {
  failures.push("unscoped .article-list block still present in admin-ui.css");
}
if (/(?:^|\n)\.article-row\s*\{/m.test(adminUiCss)) {
  failures.push("unscoped .article-row block still present in admin-ui.css");
}

for (const required of [
  ".briefly-theme",
  ".skip-link",
  ".visually-hidden",
  ".modal__backdrop",
  ".briefly-drawer-wide",
]) {
  if (!adminUiCss.includes(required)) {
    failures.push(`approved global layer missing: ${required}`);
  }
}

for (const required of [
  '@import "tailwindcss"',
  '@import "@heroui/react/styles"',
]) {
  if (!stylesCss.includes(required)) {
    failures.push(`styles.css missing entry: ${required}`);
  }
}

if (failures.length > 0) {
  console.error("admin CSS contraction check failed:");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log("admin CSS contraction check passed");
