import { describe, expect, it } from "vitest";

import {
  articleDocumentToMarkdown,
  markdownToArticleDocument,
} from "../src/articles/article-markdown";
import type { ArticleDocument } from "../src/articles/articles";

function convert(markdown: string) {
  const result = markdownToArticleDocument(markdown);
  if (!result.ok) {
    throw new Error(
      `Expected conversion to succeed: ${JSON.stringify(result.issues)}`,
    );
  }
  return result.document;
}

function issues(markdown: string) {
  const result = markdownToArticleDocument(markdown);
  if (result.ok) throw new Error("Expected conversion to report issues");
  return result.issues;
}

const assetId = "2b0c3f2e-7f53-4c0a-9a43-6a4f3c2b1d10";

describe("Markdown to Article document", () => {
  it("maps headings into the 2–4 range", () => {
    const document = convert("# One\n\n## Two\n\n#### Four\n\n###### Six");
    expect(
      document.doc.content.map((node) => [node.type, node.attrs?.level]),
    ).toEqual([
      ["heading", 2],
      ["heading", 2],
      ["heading", 4],
      ["heading", 4],
    ]);
  });

  it("converts inline marks, links, and hard breaks", () => {
    const document = convert(
      "Plain **bold *both*** ~~gone~~ `a && b` [site](https://example.com/)\\\nnext &amp; last",
    );
    expect(document.doc.content[0]).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "Plain " },
        { type: "text", text: "bold ", marks: [{ type: "bold" }] },
        {
          type: "text",
          text: "both",
          marks: [{ type: "bold" }, { type: "italic" }],
        },
        { type: "text", text: " " },
        { type: "text", text: "gone", marks: [{ type: "strike" }] },
        { type: "text", text: " " },
        { type: "text", text: "a && b", marks: [{ type: "code" }] },
        { type: "text", text: " " },
        {
          type: "text",
          text: "site",
          marks: [{ type: "link", attrs: { href: "https://example.com/" } }],
        },
        { type: "hardBreak" },
        { type: "text", text: "next & last" },
      ],
    });
  });

  it("converts lists, quotes, code, rules, and tables", () => {
    const document = convert(
      [
        "- one",
        "  - nested",
        "- two",
        "",
        "3. three",
        "4. four",
        "",
        "> quoted",
        "",
        "```ts title=x",
        "const a = 1;",
        "```",
        "",
        "---",
        "",
        "| Name | Value |",
        "| --- | --- |",
        "| a | **b** |",
      ].join("\n"),
    );
    expect(document.doc.content.map((node) => node.type)).toEqual([
      "bulletList",
      "orderedList",
      "blockquote",
      "codeBlock",
      "horizontalRule",
      "table",
    ]);
    expect(document.doc.content[1]?.attrs).toEqual({ start: 3 });
    expect(document.doc.content[3]).toEqual({
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [{ type: "text", text: "const a = 1;" }],
    });
    const table = document.doc.content[5];
    expect(table?.content?.[0]?.content?.[0]?.type).toBe("tableHeader");
    expect(table?.content?.[1]?.content?.[1]).toEqual({
      type: "tableCell",
      attrs: { colspan: 1, rowspan: 1 },
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "b", marks: [{ type: "bold" }] }],
        },
      ],
    });
  });

  it("turns asset images and video links into figures and embeds", () => {
    const document = convert(
      `![A chart](briefly-asset:${assetId} "Figure 1")\n\n[Demo](briefly-video:youtube/dQw4w9WgXcQ)`,
    );
    expect(document.doc.content).toEqual([
      {
        type: "figure",
        attrs: {
          assetId,
          alt: "A chart",
          decorative: false,
          caption: "Figure 1",
        },
      },
      {
        type: "videoEmbed",
        attrs: { provider: "youtube", id: "dQw4w9WgXcQ", title: "Demo" },
      },
    ]);
  });

  it("reports what the schema cannot hold instead of dropping it", () => {
    const reported = issues(
      [
        "<div>raw</div>",
        "",
        "- [ ] task",
        "",
        "![remote](https://example.com/a.png)",
        "",
        "[relative](/en/pricing)",
        "",
        "> | a |",
        "> | - |",
        "> | b |",
      ].join("\n"),
    ).map((issue) => issue.message);
    expect(reported).toEqual([
      "Raw HTML is not supported: <div>raw</div>",
      "Task lists are not supported.",
      'Image "https://example.com/a.png" must be uploaded to Briefly first and referenced as briefly-asset:<asset id>.',
      'Link "/en/pricing" must be an absolute http, https, or mailto URL.',
      "Tables can only appear at the top level of the body.",
    ]);
  });

  it("ignores HTML comments", () => {
    expect(convert("Text\n\n<!-- note -->").doc.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "Text" }] },
    ]);
  });

  it("gives an empty body one empty paragraph", () => {
    expect(convert("").doc.content).toEqual([{ type: "paragraph" }]);
  });

  it("reports the line of the offending block", () => {
    expect(issues("Fine\n\nStill fine\n\n<span>x</span>")[0]?.line).toBe(5);
  });
});

describe("Article document to Markdown", () => {
  const document: ArticleDocument = {
    documentSchemaVersion: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Intro" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Use " },
            { type: "text", text: 'rel="nofollow"', marks: [{ type: "code" }] },
            { type: "text", text: " for paid links, " },
            { type: "text", text: "not *all*", marks: [{ type: "bold" }] },
            { type: "text", text: " of them. " },
            {
              type: "text",
              text: "Docs",
              marks: [
                { type: "link", attrs: { href: "https://example.com/a_(b)" } },
                { type: "italic" },
              ],
            },
          ],
        },
        {
          type: "orderedList",
          attrs: { start: 2 },
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "First" }],
                },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "Nested" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Second" }],
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
              content: [{ type: "text", text: "# not a heading" }],
            },
          ],
        },
        {
          type: "codeBlock",
          attrs: { language: "plaintext" },
          content: [{ type: "text", text: "```\ninside\n```" }],
        },
        { type: "horizontalRule" },
        {
          type: "figure",
          attrs: { assetId, alt: "", decorative: true, caption: 'Say "hi"' },
        },
        {
          type: "videoEmbed",
          attrs: { provider: "bilibili", id: "BV1xx411c7mD", title: "Clip" },
        },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  attrs: { colspan: 1, rowspan: 1 },
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "A|B" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  attrs: { colspan: 1, rowspan: 1 },
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "1" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };

  it("round-trips every node the schema supports", () => {
    const markdown = articleDocumentToMarkdown(document);
    expect(convert(markdown)).toEqual(document);
  });

  it("writes readable Markdown", () => {
    const markdown = articleDocumentToMarkdown(document);
    expect(markdown).toContain("## Intro");
    expect(markdown).toContain("2. First\n   - Nested\n3. Second");
    expect(markdown).toContain(`![](briefly-asset:${assetId} "Say \\"hi\\"")`);
    expect(markdown).toContain("[Clip](briefly-video:bilibili/BV1xx411c7mD)");
  });
});
