import {
  getSchema,
  Node,
  type Extensions,
  type JSONContent,
} from "@tiptap/core";
import CodeBlock from "@tiptap/extension-code-block";
import Link from "@tiptap/extension-link";
import { OrderedList } from "@tiptap/extension-list";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { z } from "zod";

import {
  ARTICLE_ASSET_ALT_MAXIMUM_LENGTH,
  ARTICLE_DOCUMENT_SCHEMA_VERSION,
  ARTICLE_FIGURE_CAPTION_MAXIMUM_LENGTH,
  type ArticleDocument,
} from "./articles";
import { VIDEO_PROVIDER_IDENTIFIERS } from "./video-embeds";

const ARTICLE_LINK_MAXIMUM_LENGTH = 2_048;
const ORDERED_LIST_START_MAXIMUM = 1_000_000;
const codeBlockLanguage = z.string().regex(/^[a-z0-9][a-z0-9+#.-]{0,31}$/iu, {
  message: "Code block language must be a short language identifier.",
});

export function isAllowedCodeBlockLanguage(value: string): boolean {
  return codeBlockLanguage.safeParse(value).success;
}

export function isAllowedArticleLink(value: string): boolean {
  if (value.length > ARTICLE_LINK_MAXIMUM_LENGTH) return false;
  if (/[\u0000-\u0020\u007f]/u.test(value)) return false;

  try {
    return ["http:", "https:", "mailto:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const ArticleCodeBlock = CodeBlock.extend({
  addAttributes() {
    return {
      language: {
        default: "plaintext",
        parseHTML: (element) => {
          const language = [...element.classList]
            .find((name) => name.startsWith("language-"))
            ?.slice("language-".length);
          return language && isAllowedCodeBlockLanguage(language)
            ? language
            : "plaintext";
        },
        renderHTML: (attributes) => ({
          class: `language-${String(attributes.language)}`,
        }),
      },
    };
  },
});

const ArticleLink = Link.extend({
  addAttributes() {
    return { href: { default: null } };
  },
});

const ArticleOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      start: {
        default: 1,
        parseHTML: (element) => {
          const parsed = Number.parseInt(
            element.getAttribute("start") ?? "1",
            10,
          );
          return Number.isSafeInteger(parsed) &&
            parsed >= 1 &&
            parsed <= ORDERED_LIST_START_MAXIMUM
            ? parsed
            : 1;
        },
        renderHTML: (attributes) =>
          attributes.start === 1 ? {} : { start: attributes.start },
      },
    };
  },
});

const ArticleFigure = Node.create({
  name: "figure",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes: () => ({
    assetId: { default: null },
    alt: { default: "" },
    decorative: { default: false },
    caption: { default: null },
  }),
  renderHTML: ({ node }) => {
    const image = [
      "img",
      {
        src: `/media/private/${String(node.attrs.assetId)}`,
        alt: node.attrs.decorative ? "" : String(node.attrs.alt),
      },
    ];
    return node.attrs.caption
      ? ["figure", image, ["figcaption", String(node.attrs.caption)]]
      : ["figure", image];
  },
});

const ArticleVideoEmbed = Node.create({
  name: "videoEmbed",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes: () => ({
    provider: { default: null },
    id: { default: null },
    title: { default: null },
  }),
  renderHTML: ({ node }) => [
    "div",
    {
      "data-video-provider": node.attrs.provider,
      "data-video-id": node.attrs.id,
      "aria-label": node.attrs.title,
    },
  ],
});

export function createArticleEditorExtensions(): Extensions {
  return [
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [2, 3, 4] },
      link: false,
      orderedList: false,
      trailingNode: false,
      underline: false,
    }),
    ArticleCodeBlock,
    ArticleOrderedList,
    ArticleFigure,
    ArticleVideoEmbed,
    ArticleLink.configure({
      autolink: true,
      linkOnPaste: true,
      openOnClick: false,
      protocols: ["http", "https", "mailto"],
      isAllowedUri: (url) => isAllowedArticleLink(url),
      shouldAutoLink: (url) => isAllowedArticleLink(url),
    }),
  ];
}

const linkMarkSchema = z
  .object({
    type: z.literal("link"),
    attrs: z
      .object({
        href: z
          .string()
          .max(ARTICLE_LINK_MAXIMUM_LENGTH)
          .refine(isAllowedArticleLink),
      })
      .strict(),
  })
  .strict();

const markSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bold") }).strict(),
  z.object({ type: z.literal("italic") }).strict(),
  z.object({ type: z.literal("strike") }).strict(),
  z.object({ type: z.literal("code") }).strict(),
  linkMarkSchema,
]);

const textNodeSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().min(1),
    marks: z.array(markSchema).max(5).optional(),
  })
  .strict();

const unmarkedTextNodeSchema = z
  .object({ type: z.literal("text"), text: z.string().min(1) })
  .strict();
const hardBreakNodeSchema = z.object({ type: z.literal("hardBreak") }).strict();
const inlineNodeSchema = z.discriminatedUnion("type", [
  textNodeSchema,
  hardBreakNodeSchema,
]);

const figureNodeSchema = z
  .object({
    type: z.literal("figure"),
    attrs: z
      .object({
        assetId: z.string().uuid(),
        alt: z.string().max(ARTICLE_ASSET_ALT_MAXIMUM_LENGTH),
        decorative: z.boolean(),
        caption: z
          .string()
          .max(ARTICLE_FIGURE_CAPTION_MAXIMUM_LENGTH)
          .nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((figure, context) => {
    if (!figure.attrs.decorative && figure.attrs.alt.trim().length === 0) {
      context.addIssue({
        code: "custom",
        path: ["attrs", "alt"],
        message: "A non-decorative figure requires alternative text.",
      });
    }
  });

const videoEmbedNodeSchema = z
  .object({
    type: z.literal("videoEmbed"),
    attrs: z.discriminatedUnion("provider", [
      z
        .object({
          provider: z.literal("youtube"),
          id: z.string().regex(VIDEO_PROVIDER_IDENTIFIERS.youtube),
          title: z.string().trim().min(1).max(200),
        })
        .strict(),
      z
        .object({
          provider: z.literal("bilibili"),
          id: z.string().regex(VIDEO_PROVIDER_IDENTIFIERS.bilibili),
          title: z.string().trim().min(1).max(200),
        })
        .strict(),
    ]),
  })
  .strict();

const blockNodeSchema: z.ZodType<JSONContent> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z
      .object({
        type: z.literal("paragraph"),
        content: z.array(inlineNodeSchema).optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("heading"),
        attrs: z
          .object({
            level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
          })
          .strict(),
        content: z.array(inlineNodeSchema).optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("bulletList"),
        content: z.array(listItemNodeSchema).min(1),
      })
      .strict(),
    z
      .object({
        type: z.literal("orderedList"),
        attrs: z
          .object({
            start: z.number().int().min(1).max(ORDERED_LIST_START_MAXIMUM),
          })
          .strict(),
        content: z.array(listItemNodeSchema).min(1),
      })
      .strict(),
    z
      .object({
        type: z.literal("blockquote"),
        content: z.array(blockNodeSchema).min(1),
      })
      .strict(),
    z
      .object({
        type: z.literal("codeBlock"),
        attrs: z.object({ language: codeBlockLanguage }).strict(),
        content: z.array(unmarkedTextNodeSchema).max(1).optional(),
      })
      .strict(),
    z.object({ type: z.literal("horizontalRule") }).strict(),
    figureNodeSchema,
    videoEmbedNodeSchema,
  ]),
);

const listItemNodeSchema: z.ZodType<JSONContent> = z.lazy(() =>
  z
    .object({
      type: z.literal("listItem"),
      content: z.array(blockNodeSchema).min(1),
    })
    .strict(),
);

const articleDocumentSchema = z
  .object({
    documentSchemaVersion: z.literal(ARTICLE_DOCUMENT_SCHEMA_VERSION),
    doc: z
      .object({
        type: z.literal("doc"),
        content: z.array(blockNodeSchema).min(1),
      })
      .strict(),
  })
  .strict();

const articleEditorSchema = getSchema(createArticleEditorExtensions());

export interface ArticleDocumentIssue {
  path: string;
  message: string;
}

export type ArticleDocumentValidationResult =
  | { ok: true; document: ArticleDocument }
  | { ok: false; issues: ArticleDocumentIssue[] };

export function validateArticleDocument(
  input: unknown,
): ArticleDocumentValidationResult {
  const parsed = articleDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  try {
    const document = ProseMirrorNode.fromJSON(
      articleEditorSchema,
      parsed.data.doc,
    );
    document.check();
    const normalized = articleDocumentSchema.parse({
      documentSchemaVersion: ARTICLE_DOCUMENT_SCHEMA_VERSION,
      doc: document.toJSON(),
    });
    return {
      ok: true,
      document: normalized as ArticleDocument,
    };
  } catch {
    return {
      ok: false,
      issues: [
        {
          path: "doc",
          message: "Document content does not satisfy the Article schema.",
        },
      ],
    };
  }
}

export interface ArticleDocumentAssetReference {
  assetId: string;
  path: string;
}

export function articleDocumentAssetReferences(
  document: ArticleDocument,
): ArticleDocumentAssetReference[] {
  const references: ArticleDocumentAssetReference[] = [];

  function visit(value: unknown, path: string) {
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${path}.${index}`));
      return;
    }
    if (value === null || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (node.type === "figure") {
      const attrs = node.attrs as { assetId: string };
      references.push({
        assetId: attrs.assetId,
        path: `${path}.attrs.assetId`,
      });
    }
    visit(node.content, `${path}.content`);
  }

  visit(document.doc, "doc");
  return references;
}
