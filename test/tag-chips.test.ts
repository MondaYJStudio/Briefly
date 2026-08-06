import { describe, expect, it } from "vitest";

import { commitTagChipInput } from "../src/articles/tag-chips";

describe("Tag chip input", () => {
  it("commits Enter/comma fragments with existing flat normalization rules", () => {
    expect(
      commitTagChipInput(["typescript"], " Cloud   Workers,云 计算, "),
    ).toEqual({
      tags: ["typescript", "cloud workers", "云 计算"],
      remainder: "",
    });
  });

  it("keeps an incomplete trailing fragment when not flushing", () => {
    expect(
      commitTagChipInput([], "alpha,beta,still", { flushTrailing: false }),
    ).toEqual({
      tags: ["alpha", "beta"],
      remainder: "still",
    });
  });

  it("drops empty and duplicate normalized tags while preserving order", () => {
    expect(
      commitTagChipInput(["typescript"], " typescript , , CLOUD   workers "),
    ).toEqual({
      tags: ["typescript", "cloud workers"],
      remainder: "",
    });
  });
});
