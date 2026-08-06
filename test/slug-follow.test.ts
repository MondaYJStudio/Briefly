import { describe, expect, it } from "vitest";

import {
  deriveSlugFromTitle,
  slugAfterManualEdit,
  slugAfterReset,
  slugAfterTitleChange,
} from "../src/articles/slug-follow";

describe("Slug Title-follow provenance", () => {
  it("derives a Unicode NFC-trimmed slug from Title and produces null for empty Title", () => {
    expect(deriveSlugFromTitle("  cafe\u0301-札记  ")).toBe("café-札记");
    expect(deriveSlugFromTitle("")).toBeNull();
    expect(deriveSlugFromTitle("   ")).toBeNull();
  });

  it("keeps auto mode following Title changes until the Slug is edited manually", () => {
    expect(
      slugAfterTitleChange({ mode: "auto", slug: null }, "第一篇"),
    ).toEqual({ mode: "auto", slug: "第一篇" });

    expect(
      slugAfterTitleChange(
        { mode: "auto", slug: "第一篇" },
        "  第二篇  ",
      ),
    ).toEqual({ mode: "auto", slug: "第二篇" });

    expect(
      slugAfterTitleChange({ mode: "auto", slug: "第二篇" }, "   "),
    ).toEqual({ mode: "auto", slug: null });
  });

  it("locks the Slug on manual edit and ignores later Title changes until reset", () => {
    expect(slugAfterManualEdit("my-url")).toEqual({
      mode: "manual",
      slug: "my-url",
    });
    expect(slugAfterManualEdit("  ")).toEqual({ mode: "manual", slug: null });

    expect(
      slugAfterTitleChange(
        { mode: "manual", slug: "my-url" },
        "A different Title",
      ),
    ).toEqual({ mode: "manual", slug: "my-url" });

    expect(slugAfterReset("A different Title")).toEqual({
      mode: "auto",
      slug: "A different Title",
    });
  });
});
