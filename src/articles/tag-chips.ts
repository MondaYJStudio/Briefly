import { z } from "zod";

import {
  ARTICLE_TAG_MAXIMUM_LENGTH,
  ARTICLE_TAGS_MAXIMUM_COUNT,
} from "./articles";

export const articleTagSchema = z
  .string()
  .transform((value) => value.normalize("NFC").trim().replace(/\s+/gu, " "))
  .pipe(z.string().min(1).max(ARTICLE_TAG_MAXIMUM_LENGTH))
  .transform((value) => value.toLocaleLowerCase("und"));

export function normalizeArticleTag(value: string): string | null {
  const result = articleTagSchema.safeParse(value);
  return result.success ? result.data : null;
}

/**
 * Commit Enter/comma-delimited chip fragments onto the flat tag list using
 * the same NFC / whitespace / lowercase rules as Draft persistence.
 */
export function commitTagChipInput(
  existing: string[],
  rawInput: string,
  options: { flushTrailing?: boolean } = {},
): { tags: string[]; remainder: string } {
  const flushTrailing = options.flushTrailing ?? true;
  const parts = rawInput.split(",");
  const remainder = flushTrailing ? "" : (parts.at(-1) ?? "");
  const completed = flushTrailing ? parts : parts.slice(0, -1);
  const next = [...existing];
  for (const segment of completed) {
    const normalized = normalizeArticleTag(segment);
    if (normalized === null) continue;
    if (next.includes(normalized)) continue;
    if (next.length >= ARTICLE_TAGS_MAXIMUM_COUNT) break;
    next.push(normalized);
  }
  return { tags: next, remainder };
}
