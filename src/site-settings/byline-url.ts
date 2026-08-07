import { z } from "zod";

import { BYLINE_URL_MAXIMUM_LENGTH } from "./site-settings";

/**
 * HTTP(S) Byline URL shared by Site Settings defaults and Draft overrides.
 *
 * Both surfaces must accept and reject the same values so a Draft override
 * cannot introduce a URL the site default would refuse (or the reverse).
 */
export const bylineUrl = z
  .string()
  .max(BYLINE_URL_MAXIMUM_LENGTH, {
    message: `Use at most ${BYLINE_URL_MAXIMUM_LENGTH} characters.`,
  })
  .refine(URL.canParse, { message: "Enter a valid URL." })
  .refine(
    (url) =>
      URL.canParse(url) && ["http:", "https:"].includes(new URL(url).protocol),
    { message: "Use an HTTP or HTTPS URL." },
  )
  .transform((url) => new URL(url).toString());
