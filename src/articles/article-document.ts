import { getSchema, type Extensions, type JSONContent } from "@tiptap/core";
import CodeBlock from "@tiptap/extension-code-block";
import Link from "@tiptap/extension-link";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { z } from "zod";

import type { ArticleDocument } from "./articles";

export const ARTICLE_DOCUMENT_SCHEMA_VERSION = 1;

const codeBlockLanguage = z.string().regex(/^[a-z0-9][a-z0-9+#.-]{0,31}$/iu, {
  message: "Code block language must be a short language identifier.",
});

export function isAllowedArticleLink(value: string): boolean {
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
          return language && codeBlockLanguage.safeParse(language).success
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

export function createArticleEditorExtensions(): Extensions {
  return [
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [2, 3, 4] },
      link: false,
      trailingNode: false,
      underline: false,
    }),
    ArticleCodeBlock,
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
      .object({ href: z.string().max(2_048).refine(isAllowedArticleLink) })
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
          .object({ start: z.number().int().min(1).max(1_000_000) })
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

  return { ok: true, document: parsed.data as ArticleDocument };
}
