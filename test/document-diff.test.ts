import { describe, expect, it } from "vitest";

import type { ArticleDocument } from "../src/articles/articles";
import { diffDocuments, documentLines } from "../src/articles/document-diff";

function paragraphs(...texts: string[]): ArticleDocument {
  return {
    documentSchemaVersion: 1,
    doc: {
      type: "doc",
      content: texts.map((text) => ({
        type: "paragraph",
        content: [{ type: "text", text }],
      })),
    },
  };
}

describe("Article body diff", () => {
  it("returns nothing when the text is unchanged", () => {
    expect(diffDocuments(paragraphs("A", "B"), paragraphs("A", "B"))).toEqual(
      [],
    );
  });

  it("highlights the changed characters of an edited paragraph", () => {
    expect(
      diffDocuments(paragraphs("今天天气很好"), paragraphs("今天天气不好")),
    ).toEqual([
      {
        kind: "removed",
        segments: [
          { text: "今天天气", changed: false },
          { text: "很", changed: true },
          { text: "好", changed: false },
        ],
      },
      {
        kind: "added",
        segments: [
          { text: "今天天气", changed: false },
          { text: "不", changed: true },
          { text: "好", changed: false },
        ],
      },
    ]);
  });

  it("reports added and removed blocks and collapses distant context", () => {
    expect(
      diffDocuments(
        paragraphs("1", "2", "3", "4", "old"),
        paragraphs("1", "2", "3", "4", "new", "extra"),
      ),
    ).toEqual([
      { kind: "skipped", count: 3 },
      { kind: "same", text: "4" },
      {
        kind: "removed",
        segments: [{ text: "old", changed: true }],
      },
      {
        kind: "added",
        segments: [{ text: "new", changed: true }],
      },
      {
        kind: "added",
        segments: [{ text: "extra", changed: true }],
      },
    ]);
  });

  it("flattens structured blocks into readable lines", () => {
    expect(
      documentLines({
        documentSchemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 2 },
              content: [{ type: "text", text: "Heading" }],
            },
            {
              type: "orderedList",
              attrs: { start: 1 },
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "First" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "blockquote",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Quote" }],
                },
              ],
            },
          ],
        },
      }),
    ).toEqual(["## Heading", "1. First", "> Quote"]);
  });
});
