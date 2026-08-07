#!/usr/bin/env node
/**
 * Guards the public-site chrome against the index prototype
 * (index-single-file.html) on two axes:
 *
 * 1. Hide contract — at ≤60rem the article date column and the spec footnote
 *    column disappear, and the ≤40rem stacking must not resurrect the
 *    footnotes. The prototype never renders an inline date substitute, so no
 *    `article-row__meta-date` may reappear in the CSS or the markup.
 * 2. Type-scale ownership — font sizes live in Tailwind utilities, so the
 *    stylesheet may not reintroduce a `--text-*` token or point `font-size`
 *    at a custom property.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const css = read("src/public-site.css");
const markup = [
  "src/routes/index.tsx",
  "src/routes/articles/$slug.tsx",
  "src/components/public/public-site-shell.tsx",
]
  .map(read)
  .join("\n");

function mediaBlock(maxWidth) {
  const marker = `@media (max-width: ${maxWidth})`;
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`missing ${marker}`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unclosed ${marker}`);
}

const failures = [];

const at60 = mediaBlock("60rem");
if (!/\.public-site\s+\.article-row__date\s*\{\s*display:\s*none;/.test(at60)) {
  failures.push("60rem must hide .article-row__date");
}
if (
  !/\.public-site\s+\.spec\s+td\.spec__foot\s*\{\s*display:\s*none;/.test(at60)
) {
  failures.push("60rem must hide .spec td.spec__foot");
}

const at40 = mediaBlock("40rem");
if (!at40.includes(".spec td:not(.spec__foot)")) {
  failures.push("40rem must stack only non-footnote spec cells");
}
if (/\.spec td\s*\{/.test(at40)) {
  failures.push(
    "40rem must not set display on all .spec td (unhides footnotes)",
  );
}

if (css.includes("article-row__meta-date")) {
  failures.push("public-site.css must not reintroduce an inline meta date");
}
if (markup.includes("article-row__meta-date")) {
  failures.push("public markup must not reintroduce an inline meta date");
}

if (/^\s*--text-[\w-]*\s*:/m.test(css)) {
  failures.push("public-site.css must not declare a --text-* size token");
}
if (/font-size:\s*var\(/.test(css)) {
  failures.push("public-site.css must not size text from a custom property");
}

if (failures.length > 0) {
  console.error("public-site responsive check failed:");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log("public-site responsive check passed");
