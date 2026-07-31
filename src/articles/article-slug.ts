import { z } from "zod";

import { ARTICLE_SLUG_MAXIMUM_LENGTH } from "./articles";

const pathReservedCharacter = /[:/?#\[\]@!$&'()*+,;=%\\]/u;
const controlCharacter = /\p{Cc}/u;
const surrogateCharacter = /[\uD800-\uDFFF]/u;
const dotPathSegment = /^\.{1,2}$/u;

function normalizeArticleSlug(value: string): string {
  return value.normalize("NFC").trim();
}

export function articleSlugKey(value: string): string {
  return normalizeArticleSlug(value).toLocaleLowerCase("und").normalize("NFC");
}

export const articleSlugSchema = z
  .string()
  .transform(normalizeArticleSlug)
  .pipe(
    z
      .string()
      .min(1, { message: "Enter a slug or leave it absent." })
      .max(ARTICLE_SLUG_MAXIMUM_LENGTH),
  )
  .refine((value) => !surrogateCharacter.test(value), {
    message: "Slug must contain only well-formed Unicode.",
  })
  .refine((value) => !controlCharacter.test(value), {
    message: "Slug cannot contain control characters.",
  })
  .refine((value) => !pathReservedCharacter.test(value), {
    message: "Slug cannot contain path-reserved characters.",
  })
  .refine((value) => !dotPathSegment.test(value), {
    message: "Slug cannot be a URL dot path segment.",
  });
