import { Node, generateHTML } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { renderPublication } from "../src/articles/publication-renderer.server";

describe("Publication renderer", () => {
  it("renders a versioned paragraph document as an escaped semantic fragment", async () => {
    const result = await renderPublication(
      {
        documentSchemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: 'Hello <script>alert("workerd")</script> 世界',
                },
              ],
            },
          ],
        },
      },
      {
        resolveAsset: async () => null,
      },
    );

    expect(result).toEqual({
      ok: true,
      value: {
        rendererVersion: 1,
        html: '<p>Hello &lt;script&gt;alert("workerd")&lt;/script&gt; 世界</p>',
        referencedAssets: [],
        referencedProviders: [],
      },
    });
  });

  it("renders the complete constrained document vocabulary with resolved reference facts", async () => {
    const result = await renderPublication(
      {
        documentSchemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 2 },
              content: [{ type: "text", text: "语义化 Publication" }],
            },
            {
              type: "heading",
              attrs: { level: 3 },
              content: [{ type: "text", text: "Portable" }],
            },
            {
              type: "heading",
              attrs: { level: 4 },
              content: [{ type: "text", text: "Safe" }],
            },
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Bold", marks: [{ type: "bold" }] },
                { type: "text", text: " " },
                { type: "text", text: "Italic", marks: [{ type: "italic" }] },
                { type: "text", text: " " },
                { type: "text", text: "Strike", marks: [{ type: "strike" }] },
                { type: "text", text: " " },
                {
                  type: "text",
                  text: "inline <code>",
                  marks: [{ type: "code" }],
                },
                { type: "hardBreak" },
                {
                  type: "text",
                  text: "safe link",
                  marks: [
                    {
                      type: "link",
                      attrs: { href: "https://example.com/a?b=1" },
                    },
                  ],
                },
              ],
            },
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Outer" }],
                    },
                    {
                      type: "orderedList",
                      attrs: { start: 3 },
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
              ],
            },
            {
              type: "blockquote",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Quoted & escaped" }],
                },
              ],
            },
            {
              type: "codeBlock",
              attrs: { language: "typescript" },
              content: [{ type: "text", text: "<script>alert('no')</script>" }],
            },
            { type: "horizontalRule" },
            {
              type: "figure",
              attrs: {
                assetId: "asset-moon",
                alt: "Moon over water",
                decorative: false,
                caption: "Night & tide",
              },
            },
            {
              type: "videoEmbed",
              attrs: {
                provider: "youtube",
                id: "dQw4w9WgXcQ",
                title: "YouTube example",
              },
            },
            {
              type: "videoEmbed",
              attrs: {
                provider: "bilibili",
                id: "BV1xx411c7mD",
                title: "Bilibili example",
              },
            },
          ],
        },
      },
      {
        resolveAsset: async (assetId) =>
          assetId === "asset-moon"
            ? {
                assetId,
                publicUrl: "https://media.example.com/assets/moon.webp",
                width: 1200,
                height: 800,
              }
            : null,
      },
    );

    expect(result).toEqual({
      ok: true,
      value: {
        rendererVersion: 1,
        html: '<h2>语义化 Publication</h2><h3>Portable</h3><h4>Safe</h4><p><strong>Bold</strong> <em>Italic</em> <s>Strike</s> <code>inline &lt;code&gt;</code><br/><a href="https://example.com/a?b=1" rel="noopener noreferrer">safe link</a></p><ul><li><p>Outer</p><ol start="3"><li><p>Nested</p></li></ol></li></ul><blockquote><p>Quoted &amp; escaped</p></blockquote><pre><code data-language="typescript">&lt;script&gt;alert(\'no\')&lt;/script&gt;</code></pre><hr/><figure><img src="https://media.example.com/assets/moon.webp" width="1200" height="800" alt="Moon over water"/><figcaption>Night &amp; tide</figcaption></figure><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" title="YouTube example" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen=""></iframe><iframe src="https://player.bilibili.com/player.html?bvid=BV1xx411c7mD" title="Bilibili example" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="fullscreen" allowfullscreen=""></iframe>',
        referencedAssets: [
          {
            assetId: "asset-moon",
            publicUrl: "https://media.example.com/assets/moon.webp",
            width: 1200,
            height: 800,
          },
        ],
        referencedProviders: [
          { provider: "youtube", id: "dQw4w9WgXcQ" },
          { provider: "bilibili", id: "BV1xx411c7mD" },
        ],
      },
    });
  });

  it("returns structured issues for an invalid document envelope", async () => {
    const result = await renderPublication(null as never, {
      resolveAsset: async () => null,
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: "INVALID_DOCUMENT",
          path: "",
          message: "Invalid input: expected object, received null",
        },
      ],
    });
  });

  it("rejects an unsupported Document Schema Version before document validation", async () => {
    const result = await renderPublication(
      {
        documentSchemaVersion: 99,
        doc: {
          type: "doc",
          content: [{ type: "rawHtml", attrs: { html: "<script />" } }],
        },
      },
      { resolveAsset: async () => null },
    );

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: "UNSUPPORTED_DOCUMENT_SCHEMA_VERSION",
          path: "documentSchemaVersion",
          message: "Document Schema Version 99 is not supported",
        },
      ],
    });
  });

  it("rejects raw HTML as an unsupported node without returning partial HTML", async () => {
    const result = await renderPublication(
      {
        documentSchemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "valid prefix" }],
            },
            {
              type: "rawHtml",
              attrs: { html: '<img src=x onerror="alert(1)">' },
            },
          ],
        },
      },
      { resolveAsset: async () => null },
    );

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: "UNSUPPORTED_NODE",
          path: "doc.content.1.type",
          message: 'Node type "rawHtml" is not supported',
        },
      ],
    });
  });

  it("rejects injected presentation and event attributes on a supported node", async () => {
    const result = await renderPublication(
      {
        documentSchemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: {
                class: "tiptap prose tailwind",
                style: "background:url(javascript:alert(1))",
                onclick: "alert(1)",
              },
              content: [{ type: "text", text: "looks valid" }],
            },
          ],
        },
      },
      { resolveAsset: async () => null },
    );

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: "INVALID_NODE_ATTRIBUTES",
          path: "doc.content.0.attrs",
          message:
            "Node contains attributes that are not owned by the Publication schema",
        },
      ],
    });
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "java\nscript:alert(1)",
  ])("rejects the executable link URL %j", async (href) => {
    const result = await renderPublication(
      {
        documentSchemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "unsafe",
                  marks: [{ type: "link", attrs: { href } }],
                },
              ],
            },
          ],
        },
      },
      { resolveAsset: async () => null },
    );

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: "UNSAFE_LINK",
          path: "doc.content.0.content.0.marks.0.attrs.href",
          message: "Link must use an allowed absolute URL protocol",
        },
      ],
    });
  });

  it.each([
    { provider: "youtube", id: "../../evil?autoplay=1" },
    { provider: "bilibili", id: "av123&autoplay=1" },
  ])(
    "rejects a malformed $provider provider identifier",
    async ({ provider, id }) => {
      const result = await renderPublication(
        {
          documentSchemaVersion: 1,
          doc: {
            type: "doc",
            content: [
              {
                type: "videoEmbed",
                attrs: { provider, id, title: "Untrusted embed" },
              },
            ],
          },
        },
        { resolveAsset: async () => null },
      );

      expect(result).toEqual({
        ok: false,
        issues: [
          {
            code: "INVALID_PROVIDER_IDENTIFIER",
            path: "doc.content.0.attrs.id",
            message: "Provider identifier is malformed",
          },
        ],
      });
    },
  );

  it("rejects an h1 inside Publication body content", async () => {
    const result = await renderPublication(
      {
        documentSchemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 1 },
              content: [{ type: "text", text: "Article title collision" }],
            },
          ],
        },
      },
      { resolveAsset: async () => null },
    );

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: "INVALID_HEADING_LEVEL",
          path: "doc.content.0.attrs.level",
          message: "Publication body headings must use levels 2 through 4",
        },
      ],
    });
  });

  it("requires alternative text for a non-decorative figure", async () => {
    const result = await renderPublication(
      {
        documentSchemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "figure",
              attrs: {
                assetId: "asset-moon",
                alt: "   ",
                decorative: false,
              },
            },
          ],
        },
      },
      { resolveAsset: async () => null },
    );

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: "FIGURE_ALT_REQUIRED",
          path: "doc.content.0.attrs.alt",
          message: "A non-decorative figure requires alternative text",
        },
      ],
    });
  });

  it("returns complete Asset-resolution issues without partial HTML", async () => {
    const result = await renderPublication(
      {
        documentSchemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "valid prefix" }],
            },
            {
              type: "figure",
              attrs: {
                assetId: "asset-missing",
                alt: "Missing",
                decorative: false,
              },
            },
            {
              type: "figure",
              attrs: {
                assetId: "asset-fake",
                alt: "Fake",
                decorative: false,
              },
            },
          ],
        },
      },
      {
        resolveAsset: async (assetId) =>
          assetId === "asset-fake"
            ? {
                assetId,
                publicUrl: "javascript:alert(1)",
                width: 640,
                height: 480,
              }
            : null,
      },
    );

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: "ASSET_NOT_RESOLVED",
          path: "assets.asset-missing",
          message: "Referenced Asset is unavailable for publication",
        },
        {
          code: "INVALID_ASSET_RESOLUTION",
          path: "assets.asset-fake",
          message: "Resolved Asset facts are not safe for publication",
        },
      ],
    });
  });

  it.each([
    {
      label: "unknown node",
      node: { type: "customWidget", attrs: { payload: "untrusted" } },
      code: "UNSUPPORTED_NODE",
      path: "doc.content.0.type",
      message: 'Node type "customWidget" is not supported',
    },
    {
      label: "arbitrary iframe node",
      node: {
        type: "iframe",
        attrs: { src: "https://attacker.example/embed" },
      },
      code: "UNSUPPORTED_NODE",
      path: "doc.content.0.type",
      message: 'Node type "iframe" is not supported',
    },
    {
      label: "unknown mark",
      node: {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "marked",
            marks: [{ type: "underline", attrs: { style: "color:red" } }],
          },
        ],
      },
      code: "UNSUPPORTED_MARK",
      path: "doc.content.0.content.0.marks.0.type",
      message: 'Mark type "underline" is not supported',
    },
  ])("rejects an $label", async ({ node, code, path, message }) => {
    const result = await renderPublication(
      {
        documentSchemaVersion: 1,
        doc: { type: "doc", content: [node] },
      },
      { resolveAsset: async () => null },
    );

    expect(result).toEqual({
      ok: false,
      issues: [{ code, path, message }],
    });
  });

  it("rejects author-controlled iframe source, privileges, and event data", async () => {
    const result = await renderPublication(
      {
        documentSchemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "videoEmbed",
              attrs: {
                provider: "youtube",
                id: "dQw4w9WgXcQ",
                title: "Looks valid",
                src: "https://attacker.example/embed",
                allow: "camera; microphone",
                onload: "alert(1)",
              },
            },
          ],
        },
      },
      { resolveAsset: async () => null },
    );

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: "INVALID_NODE_ATTRIBUTES",
          path: "doc.content.0.attrs",
          message:
            "Node contains attributes that are not owned by the Publication schema",
        },
      ],
    });
  });

  it("accepts a canonical null caption and renders a decorative figure with empty alt", async () => {
    const result = await renderPublication(
      {
        documentSchemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "figure",
              attrs: {
                assetId: "asset-divider",
                alt: "authored text must not leak into decorative output",
                decorative: true,
                caption: null,
              },
            },
          ],
        },
      },
      {
        resolveAsset: async (assetId) => ({
          assetId,
          publicUrl: "https://media.example.com/assets/divider.svg",
          width: 800,
          height: 40,
        }),
      },
    );

    expect(result).toEqual({
      ok: true,
      value: {
        rendererVersion: 1,
        html: '<figure><img src="https://media.example.com/assets/divider.svg" width="800" height="40" alt=""/></figure>',
        referencedAssets: [
          {
            assetId: "asset-divider",
            publicUrl: "https://media.example.com/assets/divider.svg",
            width: 800,
            height: 40,
          },
        ],
        referencedProviders: [],
      },
    });
  });

  it("returns only publication-safe Asset reference facts", async () => {
    const result = await renderPublication(
      {
        documentSchemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "figure",
              attrs: {
                assetId: "asset-private",
                alt: "Safe public projection",
                decorative: false,
              },
            },
          ],
        },
      },
      {
        resolveAsset: async (assetId) => ({
          assetId,
          publicUrl: "https://media.example.com/assets/public.webp",
          width: 640,
          height: 480,
          privateObjectKey: "private/uploads/secret.webp",
        }),
      },
    );

    expect(result).toEqual({
      ok: true,
      value: {
        rendererVersion: 1,
        html: '<figure><img src="https://media.example.com/assets/public.webp" width="640" height="480" alt="Safe public projection"/></figure>',
        referencedAssets: [
          {
            assetId: "asset-private",
            publicUrl: "https://media.example.com/assets/public.webp",
            width: 640,
            height: 480,
          },
        ],
        referencedProviders: [],
      },
    });
  });

  it("uses the ProseMirror schema to reject invalid list nesting", async () => {
    const result = await renderPublication(
      {
        documentSchemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "heading",
                      attrs: { level: 2 },
                      content: [{ type: "text", text: "Not a paragraph" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      { resolveAsset: async () => null },
    );

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: "INVALID_DOCUMENT_STRUCTURE",
          path: "doc",
          message: "Document content does not satisfy the Publication schema",
        },
      ],
    });
  });

  it("executes the renderer in workerd without browser DOM globals", async () => {
    const result = await renderPublication(
      {
        documentSchemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "workerd proof" }],
            },
          ],
        },
      },
      { resolveAsset: async () => null },
    );

    expect({
      userAgent: navigator.userAgent,
      hasDocument: "document" in globalThis,
      hasDomParser: "DOMParser" in globalThis,
      result,
    }).toEqual({
      userAgent: "Cloudflare-Workers",
      hasDocument: false,
      hasDomParser: false,
      result: {
        ok: true,
        value: {
          rendererVersion: 1,
          html: "<p>workerd proof</p>",
          referencedAssets: [],
          referencedProviders: [],
        },
      },
    });
  });

  it("records the DOM-dependent Tiptap serializer failure in workerd", () => {
    const documentExtension = Node.create({
      name: "doc",
      topNode: true,
      content: "block+",
    });
    const paragraphExtension = Node.create({
      name: "paragraph",
      group: "block",
      content: "inline*",
      renderHTML: () => ["p", 0],
    });
    const textExtension = Node.create({ name: "text", group: "inline" });

    expect(() =>
      generateHTML(
        {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "DOM path" }],
            },
          ],
        },
        [documentExtension, paragraphExtension, textExtension],
      ),
    ).toThrow("window is not defined");
  });
});
