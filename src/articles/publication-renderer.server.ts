/** Production Publication renderer, proven against workerd by Ticket 02. */
import { Mark, Node, getSchema } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  renderToHTMLString,
  serializeAttrsToHTMLString,
  serializeChildrenToHTMLString,
} from "@tiptap/static-renderer/pm/html-string";
import { z } from "zod";

import type { ArticleCoverUsage, PublicationIssue } from "./articles";

export type { PublicationIssue } from "./articles";

const DOCUMENT_SCHEMA_VERSION = 1;
export const PUBLICATION_RENDERER_VERSION = 1;
const VIDEO_PROVIDER_POLICIES = {
  youtube: {
    idPattern: /^[A-Za-z0-9_-]{11}$/,
    source: (id: string) => `https://www.youtube-nocookie.com/embed/${id}`,
    allow: "encrypted-media; picture-in-picture; fullscreen",
  },
  bilibili: {
    idPattern: /^BV[A-Za-z0-9]{10}$/,
    source: (id: string) =>
      `https://player.bilibili.com/player.html?bvid=${id}`,
    allow: "fullscreen",
  },
} as const;

type VideoProvider = keyof typeof VIDEO_PROVIDER_POLICIES;

const Document = Node.create({
  name: "doc",
  topNode: true,
  content: "block+",
});

const Paragraph = Node.create({
  name: "paragraph",
  group: "block",
  content: "inline*",
  renderHTML: () => ["p", 0],
});

const Heading = Node.create({
  name: "heading",
  group: "block",
  content: "inline*",
  defining: true,
  addAttributes: () => ({ level: { default: 2 } }),
  renderHTML: ({ node }) => [`h${node.attrs.level}`, 0],
});

const Text = Node.create({
  name: "text",
  group: "inline",
});

const HardBreak = Node.create({
  name: "hardBreak",
  inline: true,
  group: "inline",
  selectable: false,
  renderHTML: () => ["br"],
});

const BulletList = Node.create({
  name: "bulletList",
  group: "block",
  content: "listItem+",
  renderHTML: () => ["ul", 0],
});

const OrderedList = Node.create({
  name: "orderedList",
  group: "block",
  content: "listItem+",
  addAttributes: () => ({ start: { default: 1 } }),
  renderHTML: ({ node }) =>
    node.attrs.start === 1 ? ["ol", 0] : ["ol", { start: node.attrs.start }, 0],
});

const ListItem = Node.create({
  name: "listItem",
  content: "paragraph block*",
  defining: true,
  renderHTML: () => ["li", 0],
});

const Blockquote = Node.create({
  name: "blockquote",
  group: "block",
  content: "block+",
  defining: true,
  renderHTML: () => ["blockquote", 0],
});

const CodeBlock = Node.create({
  name: "codeBlock",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,
  addAttributes: () => ({ language: { default: "plaintext" } }),
  renderHTML: ({ node }) => [
    "pre",
    ["code", { "data-language": node.attrs.language }, 0],
  ],
});

const HorizontalRule = Node.create({
  name: "horizontalRule",
  group: "block",
  atom: true,
  renderHTML: () => ["hr"],
});

const Figure = Node.create({
  name: "figure",
  group: "block",
  atom: true,
  addAttributes: () => ({
    assetId: { default: null },
    alt: { default: null },
    decorative: { default: false },
    caption: { default: null },
  }),
});

const VideoEmbed = Node.create({
  name: "videoEmbed",
  group: "block",
  atom: true,
  addAttributes: () => ({
    provider: { default: null },
    id: { default: null },
    title: { default: null },
  }),
});

const Bold = Mark.create({
  name: "bold",
  renderHTML: () => ["strong", 0],
});

const Italic = Mark.create({
  name: "italic",
  renderHTML: () => ["em", 0],
});

const Strike = Mark.create({
  name: "strike",
  renderHTML: () => ["s", 0],
});

const InlineCode = Mark.create({
  name: "code",
  code: true,
  excludes: "_",
  renderHTML: () => ["code", 0],
});

const Link = Mark.create({
  name: "link",
  inclusive: false,
  addAttributes: () => ({ href: { default: null } }),
  renderHTML: ({ mark }) => [
    "a",
    { href: mark.attrs.href, rel: "noopener noreferrer" },
    0,
  ],
});

const extensions = [
  Document,
  Paragraph,
  Heading,
  Text,
  HardBreak,
  BulletList,
  OrderedList,
  ListItem,
  Blockquote,
  CodeBlock,
  HorizontalRule,
  Figure,
  VideoEmbed,
  Bold,
  Italic,
  Strike,
  InlineCode,
  Link,
];
const publicationSchema = getSchema(extensions);

const safeLinkSchema = z
  .string()
  .max(2_048)
  .refine(isSafeLink, "Link must use an allowed absolute URL protocol");
const assetIdentitySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u);
const coverUsageSchema = z
  .object({
    assetId: assetIdentitySchema,
    alt: z.string().trim().min(1).max(1_000),
  })
  .strict();

const linkMarkSchema = z
  .object({
    type: z.literal("link"),
    attrs: z.object({ href: safeLinkSchema }).strict(),
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
  .object({
    type: z.literal("text"),
    text: z.string().min(1),
  })
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
        attrs: z
          .object({
            language: z.string().regex(/^[a-z0-9][a-z0-9+#.-]{0,31}$/i),
          })
          .strict(),
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

const figureNodeSchema = z
  .object({
    type: z.literal("figure"),
    attrs: z
      .object({
        assetId: assetIdentitySchema,
        alt: z.string().max(1_000),
        decorative: z.boolean(),
        caption: z.string().max(2_000).nullable().optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((figure, context) => {
    if (!figure.attrs.decorative && figure.attrs.alt.trim().length === 0) {
      context.addIssue({
        code: "custom",
        path: ["attrs", "alt"],
        message: "A non-decorative figure requires alternative text",
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
          id: z.string().regex(VIDEO_PROVIDER_POLICIES.youtube.idPattern),
          title: z.string().trim().min(1).max(200),
        })
        .strict(),
      z
        .object({
          provider: z.literal("bilibili"),
          id: z.string().regex(VIDEO_PROVIDER_POLICIES.bilibili.idPattern),
          title: z.string().trim().min(1).max(200),
        })
        .strict(),
    ]),
  })
  .strict();

const documentEnvelopeSchema = z
  .object({
    documentSchemaVersion: z.number(),
    doc: z.unknown(),
  })
  .passthrough();

const versionedDocumentSchema = z
  .object({
    documentSchemaVersion: z.literal(DOCUMENT_SCHEMA_VERSION),
    doc: z
      .object({
        type: z.literal("doc"),
        content: z.array(blockNodeSchema).min(1),
      })
      .strict(),
  })
  .strict();

export interface VersionedPublicationDocument {
  documentSchemaVersion: number;
  doc: unknown;
}

export interface ResolvedPublicationAsset {
  assetId: string;
  publicUrl: string;
  width: number;
  height: number;
  delivery?: "private" | "public";
}

export interface PublicationRendererDependencies {
  resolveAsset: (assetId: string) => Promise<ResolvedPublicationAsset | null>;
}

export type PublicationRenderResult =
  | {
      ok: true;
      value: {
        rendererVersion: typeof PUBLICATION_RENDERER_VERSION;
        html: string;
        coverHtml?: string | null;
        referencedAssets: ResolvedPublicationAsset[];
        referencedProviders: Array<{ provider: VideoProvider; id: string }>;
      };
    }
  | { ok: false; issues: PublicationIssue[] };

export function renderPublication(
  document: VersionedPublicationDocument,
  dependencies: PublicationRendererDependencies,
  cover?: ArticleCoverUsage | null,
): Promise<PublicationRenderResult>;
export async function renderPublication(
  document: unknown,
  dependencies: PublicationRendererDependencies,
  cover?: ArticleCoverUsage | null,
): Promise<PublicationRenderResult> {
  let normalizedCover: ArticleCoverUsage | null | undefined;
  if (cover !== undefined) {
    const parsedCover = coverUsageSchema.nullable().safeParse(cover);
    if (!parsedCover.success) {
      return {
        ok: false,
        issues: parsedCover.error.issues.map((issue) =>
          issue.path.at(-1) === "assetId"
            ? {
                code: "INVALID_ASSET_IDENTITY",
                path: "cover.assetId",
                message: "Cover must reference an internal Asset identity",
              }
            : {
                code: "INVALID_COVER",
                path: `cover.${issue.path.join(".")}`,
                message: issue.message,
              },
        ),
      };
    }
    normalizedCover = parsedCover.data;
  }

  const envelope = documentEnvelopeSchema.safeParse(document);
  if (!envelope.success) {
    return invalidDocumentIssues(document, envelope.error);
  }

  if (envelope.data.documentSchemaVersion !== DOCUMENT_SCHEMA_VERSION) {
    return {
      ok: false,
      issues: [
        {
          code: "UNSUPPORTED_DOCUMENT_SCHEMA_VERSION",
          path: "documentSchemaVersion",
          message: `Document Schema Version ${envelope.data.documentSchemaVersion} is not supported`,
        },
      ],
    };
  }

  const parsed = versionedDocumentSchema.safeParse(document);

  if (!parsed.success) {
    return invalidDocumentIssues(document, parsed.error);
  }

  let node: ProseMirrorNode;
  try {
    node = ProseMirrorNode.fromJSON(
      publicationSchema,
      parsed.data.doc as JSONContent,
    );
    node.check();
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: "INVALID_DOCUMENT_STRUCTURE",
          path: "doc",
          message: "Document content does not satisfy the Publication schema",
        },
      ],
    };
  }

  const references = collectReferences(node);
  if (
    normalizedCover &&
    !references.assetIds.includes(normalizedCover.assetId)
  ) {
    references.assetIds.unshift(normalizedCover.assetId);
  }
  const resolvedAssets = await resolveAssets(
    references.assetIds,
    dependencies.resolveAsset,
  );
  if (!resolvedAssets.ok) {
    return resolvedAssets;
  }

  const assetsById = new Map(
    resolvedAssets.assets.map((asset) => [asset.assetId, asset]),
  );
  let html: string;

  try {
    html = renderToHTMLString({
      content: node,
      extensions,
      options: {
        nodeMapping: {
          figure: ({ node: figure }) => renderFigure(figure.attrs, assetsById),
          videoEmbed: ({ node: video }) => renderVideo(video.attrs),
        },
      },
    });
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: "RENDER_FAILED",
          path: "doc",
          message: "Publication HTML could not be rendered",
        },
      ],
    };
  }

  const value: Extract<PublicationRenderResult, { ok: true }>["value"] = {
    rendererVersion: PUBLICATION_RENDERER_VERSION,
    html,
    referencedAssets: resolvedAssets.assets,
    referencedProviders: references.providers,
  };
  if (normalizedCover !== undefined) {
    value.coverHtml =
      normalizedCover === null
        ? null
        : renderFigure(
            { ...normalizedCover, decorative: false, caption: null },
            assetsById,
          );
  }

  return {
    ok: true,
    value,
  };
}

function invalidDocumentIssues(
  document: unknown,
  error: z.ZodError,
): PublicationRenderResult {
  return {
    ok: false,
    issues: error.issues.map((issue) => {
      const path = issue.path.join(".");
      const value = valueAtPath(document, issue.path);

      if (issue.path.at(-1) === "type" && typeof value === "string") {
        const isMark = issue.path.includes("marks");
        return {
          code: isMark ? "UNSUPPORTED_MARK" : "UNSUPPORTED_NODE",
          path,
          message: `${isMark ? "Mark" : "Node"} type ${JSON.stringify(value.slice(0, 64))} is not supported`,
        };
      }

      if (
        issue.code === "unrecognized_keys" &&
        (issue.keys.includes("attrs") || issue.path.at(-1) === "attrs")
      ) {
        return {
          code: "INVALID_NODE_ATTRIBUTES",
          path: issue.path.at(-1) === "attrs" ? path : `${path}.attrs`,
          message:
            "Node contains attributes that are not owned by the Publication schema",
        };
      }

      if (issue.path.at(-1) === "href") {
        return {
          code: "UNSAFE_LINK",
          path,
          message: "Link must use an allowed absolute URL protocol",
        };
      }

      if (issue.path.at(-1) === "assetId") {
        return {
          code: "INVALID_ASSET_IDENTITY",
          path,
          message: "Figure must reference an internal Asset identity",
        };
      }

      const owningNode = valueAtPath(document, issue.path.slice(0, -2));
      const owningNodeType =
        typeof owningNode === "object" &&
        owningNode !== null &&
        "type" in owningNode &&
        typeof owningNode.type === "string"
          ? owningNode.type
          : null;

      if (issue.path.at(-1) === "level" && owningNodeType === "heading") {
        return {
          code: "INVALID_HEADING_LEVEL",
          path,
          message: "Publication body headings must use levels 2 through 4",
        };
      }

      if (issue.path.at(-1) === "alt" && owningNodeType === "figure") {
        return {
          code: "FIGURE_ALT_REQUIRED",
          path,
          message: "A non-decorative figure requires alternative text",
        };
      }

      if (issue.path.at(-1) === "id" && owningNodeType === "videoEmbed") {
        return {
          code: "INVALID_PROVIDER_IDENTIFIER",
          path,
          message: "Provider identifier is malformed",
        };
      }

      return {
        code: "INVALID_DOCUMENT",
        path,
        message: issue.message,
      };
    }),
  };
}

function valueAtPath(value: unknown, path: PropertyKey[]): unknown {
  return path.reduce<unknown>((current, part) => {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    return (current as Record<PropertyKey, unknown>)[part];
  }, value);
}

function isSafeLink(value: string): boolean {
  if (/[\u0000-\u0020\u007f]/.test(value)) {
    return false;
  }

  try {
    return ["http:", "https:", "mailto:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function collectReferences(node: ProseMirrorNode): {
  assetIds: string[];
  providers: Array<{ provider: VideoProvider; id: string }>;
} {
  const assetIds: string[] = [];
  const seenAssets = new Set<string>();
  const providers: Array<{ provider: VideoProvider; id: string }> = [];
  const seenProviders = new Set<string>();

  node.descendants((child) => {
    if (child.type.name === "figure" && !seenAssets.has(child.attrs.assetId)) {
      seenAssets.add(child.attrs.assetId);
      assetIds.push(child.attrs.assetId);
    }

    if (child.type.name === "videoEmbed") {
      const provider = child.attrs.provider as VideoProvider;
      const key = `${provider}:${child.attrs.id}`;
      if (!seenProviders.has(key)) {
        seenProviders.add(key);
        providers.push({ provider, id: child.attrs.id });
      }
    }
  });

  return { assetIds, providers };
}

async function resolveAssets(
  assetIds: string[],
  resolveAsset: PublicationRendererDependencies["resolveAsset"],
): Promise<
  | { ok: true; assets: ResolvedPublicationAsset[] }
  | { ok: false; issues: PublicationIssue[] }
> {
  const resolutions = await Promise.all(
    assetIds.map(async (assetId) => {
      try {
        return { assetId, asset: await resolveAsset(assetId) };
      } catch {
        return { assetId, asset: null };
      }
    }),
  );
  const issues: PublicationIssue[] = [];
  const assets: ResolvedPublicationAsset[] = [];

  for (const resolution of resolutions) {
    if (resolution.asset === null) {
      issues.push({
        code: "ASSET_NOT_RESOLVED",
        path: `assets.${resolution.assetId}`,
        message: "Referenced Asset is unavailable for publication",
      });
      continue;
    }

    let normalized: ResolvedPublicationAsset | null;
    try {
      normalized = normalizeResolvedAsset(resolution.assetId, resolution.asset);
    } catch {
      normalized = null;
    }
    if (normalized === null) {
      issues.push({
        code: "INVALID_ASSET_RESOLUTION",
        path: `assets.${resolution.assetId}`,
        message: "Resolved Asset facts are not safe for publication",
      });
      continue;
    }
    assets.push(normalized);
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, assets };
}

function normalizeResolvedAsset(
  requestedId: string,
  asset: ResolvedPublicationAsset,
): ResolvedPublicationAsset | null {
  let publicUrl: URL;
  try {
    publicUrl = new URL(asset.publicUrl);
  } catch {
    return null;
  }

  if (
    asset.assetId !== requestedId ||
    !isAllowedResolvedAssetUrl(requestedId, publicUrl, asset.delivery) ||
    publicUrl.username !== "" ||
    publicUrl.password !== "" ||
    !Number.isInteger(asset.width) ||
    asset.width <= 0 ||
    !Number.isInteger(asset.height) ||
    asset.height <= 0
  ) {
    return null;
  }

  return {
    assetId: asset.assetId,
    publicUrl: publicUrl.href,
    width: asset.width,
    height: asset.height,
  };
}

function isAllowedResolvedAssetUrl(
  requestedId: string,
  url: URL,
  delivery: ResolvedPublicationAsset["delivery"],
): boolean {
  if (delivery !== "private") return url.protocol === "https:";
  return (
    ["http:", "https:"].includes(url.protocol) &&
    url.pathname === `/media/private/${requestedId}` &&
    url.search === "" &&
    url.hash === ""
  );
}

function renderFigure(
  attrs: Record<string, unknown>,
  assetsById: Map<string, ResolvedPublicationAsset>,
): string {
  const asset = assetsById.get(String(attrs.assetId));
  if (!asset) {
    throw new Error("Publication rendering invariant violated");
  }

  const image = `<img${serializeAttrsToHTMLString({
    src: asset.publicUrl,
    width: asset.width,
    height: asset.height,
    alt: attrs.decorative ? "" : attrs.alt,
  })}/>`;
  const caption = attrs.caption
    ? `<figcaption>${escapeText(String(attrs.caption))}</figcaption>`
    : "";
  return `<figure>${image}${caption}</figure>`;
}

function renderVideo(attrs: Record<string, unknown>): string {
  const provider = attrs.provider as VideoProvider;
  const id = String(attrs.id);
  const policy = VIDEO_PROVIDER_POLICIES[provider];
  const providerAttrs = {
    src: policy.source(id),
    title: attrs.title,
    loading: "lazy",
    referrerpolicy: "strict-origin-when-cross-origin",
    allow: policy.allow,
    allowfullscreen: "",
  };

  return `<iframe${serializeAttrsToHTMLString(providerAttrs)}></iframe>`;
}

function escapeText(value: string): string {
  return serializeChildrenToHTMLString(
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  );
}
