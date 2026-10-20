import type { JSONContent } from "@tiptap/core";
import { Lexer, type Token, type Tokens } from "marked";

import {
  isAllowedArticleLink,
  isAllowedCodeBlockLanguage,
  validateArticleDocument,
} from "./article-document";
import {
  ARTICLE_DOCUMENT_SCHEMA_VERSION,
  type ArticleDocument,
} from "./articles";
import { VIDEO_PROVIDER_IDENTIFIERS, type VideoProvider } from "./video-embeds";

/**
 * Markdown is how agents read and write Article bodies over MCP; the Article
 * document schema stays the only stored form.
 *
 * Conversion is strict in one direction only: anything Markdown can say that
 * the schema cannot (raw HTML, task lists, external images, relative links,
 * tables inside other blocks) is reported as an issue rather than dropped, so
 * an agent never publishes less than it wrote. Headings outside the schema's
 * 2–4 range are clamped instead, because `# Title` at the top of a body is the
 * common case and the Article title is stored separately.
 *
 * Figures and video embeds have no Markdown syntax of their own. They travel
 * as `![alt](briefly-asset:<asset id> "caption")` and a paragraph holding only
 * `[title](briefly-video:<provider>/<id>)`, so a body read with
 * `articleDocumentToMarkdown` converts back without losing them.
 */

export const ASSET_URL_SCHEME = "briefly-asset:";
export const VIDEO_URL_SCHEME = "briefly-video:";

export interface MarkdownIssue {
  /** 1-based line of the block the issue was found in. */
  line: number;
  message: string;
}

export type MarkdownConversionResult =
  | { ok: true; document: ArticleDocument }
  | { ok: false; issues: MarkdownIssue[] };

type Mark = NonNullable<JSONContent["marks"]>[number];

interface Context {
  line: number;
  issues: MarkdownIssue[];
}

function report(context: Context, message: string) {
  context.issues.push({ line: context.line, message });
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

/** marked leaves entities as written; the document stores characters. */
function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/giu,
    (match, entity: string) => {
      if (entity.startsWith("#x") || entity.startsWith("#X")) {
        const code = Number.parseInt(entity.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      if (entity.startsWith("#")) {
        const code = Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    },
  );
}

function isHtmlComment(raw: string): boolean {
  return /^\s*<!--[\s\S]*-->\s*$/u.test(raw);
}

function sameMarks(a: Mark[] | undefined, b: Mark[] | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

function pushText(nodes: JSONContent[], text: string, marks: Mark[]) {
  if (text.length === 0) return;
  const last = nodes.at(-1);
  if (last?.type === "text" && sameMarks(last.marks, marks)) {
    last.text = `${last.text ?? ""}${text}`;
    return;
  }
  nodes.push(
    marks.length > 0
      ? { type: "text", text, marks: marks.map((mark) => ({ ...mark })) }
      : { type: "text", text },
  );
}

function withMark(marks: Mark[], mark: Mark): Mark[] {
  return marks.some((existing) => existing.type === mark.type)
    ? marks
    : [...marks, mark];
}

function convertInline(
  tokens: Token[] | undefined,
  context: Context,
  marks: Mark[] = [],
  nodes: JSONContent[] = [],
): JSONContent[] {
  for (const token of tokens ?? []) {
    switch (token.type) {
      case "text": {
        const text = token as Tokens.Text;
        if (text.tokens && text.tokens.length > 0) {
          convertInline(text.tokens, context, marks, nodes);
        } else {
          pushText(nodes, decodeEntities(text.text), marks);
        }
        break;
      }
      case "escape":
        pushText(nodes, (token as Tokens.Escape).text, marks);
        break;
      case "strong":
        convertInline(
          (token as Tokens.Strong).tokens,
          context,
          withMark(marks, { type: "bold" }),
          nodes,
        );
        break;
      case "em":
        convertInline(
          (token as Tokens.Em).tokens,
          context,
          withMark(marks, { type: "italic" }),
          nodes,
        );
        break;
      case "del":
        convertInline(
          (token as Tokens.Del).tokens,
          context,
          withMark(marks, { type: "strike" }),
          nodes,
        );
        break;
      case "codespan":
        // The code mark excludes every other mark in the editor schema.
        pushText(nodes, decodeEntities((token as Tokens.Codespan).text), [
          { type: "code" },
        ]);
        break;
      case "br":
        nodes.push({ type: "hardBreak" });
        break;
      case "link": {
        const link = token as Tokens.Link;
        if (!isAllowedArticleLink(link.href)) {
          report(
            context,
            `Link "${link.href}" must be an absolute http, https, or mailto URL.`,
          );
          convertInline(link.tokens, context, marks, nodes);
          break;
        }
        convertInline(
          link.tokens,
          context,
          withMark(marks, { type: "link", attrs: { href: link.href } }),
          nodes,
        );
        break;
      }
      case "image":
        report(
          context,
          "Images must stand alone in their own paragraph and use an uploaded asset (briefly-asset:<asset id>).",
        );
        break;
      case "html":
        if (!isHtmlComment(token.raw)) {
          report(context, `Raw HTML is not supported: ${token.raw.trim()}`);
        }
        break;
      default:
        report(context, `Unsupported inline Markdown: ${token.raw.trim()}`);
    }
  }
  return nodes;
}

function paragraph(content: JSONContent[]): JSONContent {
  return content.length > 0
    ? { type: "paragraph", content }
    : { type: "paragraph" };
}

/** A paragraph that is only an asset image becomes a figure. */
function figureFromParagraph(
  tokens: Token[] | undefined,
  context: Context,
): JSONContent | null {
  const meaningful = (tokens ?? []).filter(
    (token) => !(token.type === "text" && token.raw.trim() === ""),
  );
  if (meaningful.length !== 1 || meaningful[0]?.type !== "image") return null;
  const image = meaningful[0] as Tokens.Image;
  if (!image.href.startsWith(ASSET_URL_SCHEME)) {
    report(
      context,
      `Image "${image.href}" must be uploaded to Briefly first and referenced as briefly-asset:<asset id>.`,
    );
    return { type: "paragraph" };
  }
  const alt = decodeEntities(image.text);
  return {
    type: "figure",
    attrs: {
      assetId: image.href.slice(ASSET_URL_SCHEME.length),
      alt,
      decorative: alt.trim().length === 0,
      caption: image.title ? decodeEntities(image.title) : null,
    },
  };
}

/** A paragraph that is only a briefly-video link becomes a video embed. */
function videoFromParagraph(
  tokens: Token[] | undefined,
  context: Context,
): JSONContent | null {
  const meaningful = (tokens ?? []).filter(
    (token) => !(token.type === "text" && token.raw.trim() === ""),
  );
  if (meaningful.length !== 1 || meaningful[0]?.type !== "link") return null;
  const link = meaningful[0] as Tokens.Link;
  if (!link.href.startsWith(VIDEO_URL_SCHEME)) return null;
  const [provider, id] = link.href.slice(VIDEO_URL_SCHEME.length).split("/");
  if (
    !provider ||
    !id ||
    !(provider in VIDEO_PROVIDER_IDENTIFIERS) ||
    !VIDEO_PROVIDER_IDENTIFIERS[provider as VideoProvider].test(id)
  ) {
    report(
      context,
      `Video link "${link.href}" must be briefly-video:youtube/<id> or briefly-video:bilibili/<id>.`,
    );
    return { type: "paragraph" };
  }
  return {
    type: "videoEmbed",
    attrs: { provider, id, title: decodeEntities(link.text).trim() },
  };
}

function convertBlocks(
  tokens: Token[],
  context: Context,
  options: { topLevel: boolean; baseLine?: number },
): JSONContent[] {
  const blocks: JSONContent[] = [];
  let line = options.baseLine ?? context.line;
  for (const token of tokens) {
    context.line = line;
    line += (token.raw.match(/\n/gu) ?? []).length;
    switch (token.type) {
      case "space":
      case "def":
      // A task item's box; the item itself was already reported.
      case "checkbox":
        break;
      case "heading": {
        const heading = token as Tokens.Heading;
        const level = Math.min(Math.max(heading.depth, 2), 4);
        const content = convertInline(heading.tokens, context);
        blocks.push(
          content.length > 0
            ? { type: "heading", attrs: { level }, content }
            : { type: "heading", attrs: { level } },
        );
        break;
      }
      case "paragraph": {
        const { tokens: inline } = token as Tokens.Paragraph;
        const special =
          figureFromParagraph(inline, context) ??
          videoFromParagraph(inline, context);
        blocks.push(special ?? paragraph(convertInline(inline, context)));
        break;
      }
      case "text": {
        // Tight list items hold bare text tokens instead of paragraphs.
        const text = token as Tokens.Text;
        blocks.push(
          paragraph(
            text.tokens
              ? convertInline(text.tokens, context)
              : convertInline([text], context),
          ),
        );
        break;
      }
      case "list": {
        const list = token as Tokens.List;
        const items: JSONContent[] = list.items.map((item) => {
          if (item.task) report(context, "Task lists are not supported.");
          const content = convertBlocks(item.tokens, context, {
            topLevel: false,
            baseLine: context.line,
          });
          return {
            type: "listItem",
            content: content.length > 0 ? content : [{ type: "paragraph" }],
          };
        });
        if (list.ordered) {
          const start =
            typeof list.start === "number" && list.start >= 1 ? list.start : 1;
          blocks.push({
            type: "orderedList",
            attrs: { start },
            content: items,
          });
        } else {
          blocks.push({ type: "bulletList", content: items });
        }
        break;
      }
      case "blockquote": {
        const content = convertBlocks(
          (token as Tokens.Blockquote).tokens,
          context,
          { topLevel: false, baseLine: context.line },
        );
        blocks.push({
          type: "blockquote",
          content: content.length > 0 ? content : [{ type: "paragraph" }],
        });
        break;
      }
      case "code": {
        const code = token as Tokens.Code;
        const requested = (code.lang ?? "").trim().split(/\s+/u)[0] ?? "";
        const language =
          requested && isAllowedCodeBlockLanguage(requested)
            ? requested
            : "plaintext";
        blocks.push(
          code.text.length > 0
            ? {
                type: "codeBlock",
                attrs: { language },
                content: [{ type: "text", text: code.text }],
              }
            : { type: "codeBlock", attrs: { language } },
        );
        break;
      }
      case "hr":
        blocks.push({ type: "horizontalRule" });
        break;
      case "table": {
        const table = token as Tokens.Table;
        if (!options.topLevel) {
          report(
            context,
            "Tables can only appear at the top level of the body.",
          );
          break;
        }
        const cell = (
          type: "tableHeader" | "tableCell",
          source: Tokens.TableCell,
        ): JSONContent => ({
          type,
          attrs: { colspan: 1, rowspan: 1 },
          content: [paragraph(convertInline(source.tokens, context))],
        });
        blocks.push({
          type: "table",
          content: [
            {
              type: "tableRow",
              content: table.header.map((source) =>
                cell("tableHeader", source),
              ),
            },
            ...table.rows.map((row) => ({
              type: "tableRow",
              content: row.map((source) => cell("tableCell", source)),
            })),
          ],
        });
        break;
      }
      case "html":
        if (!isHtmlComment(token.raw)) {
          report(context, `Raw HTML is not supported: ${token.raw.trim()}`);
        }
        break;
      default:
        report(context, `Unsupported Markdown block: ${token.raw.trim()}`);
    }
  }
  return blocks;
}

export function markdownToArticleDocument(
  markdown: string,
): MarkdownConversionResult {
  const context: Context = { line: 1, issues: [] };
  const tokens = new Lexer({ gfm: true }).lex(
    markdown.replace(/\r\n?/gu, "\n"),
  );
  const content = convertBlocks(tokens, context, { topLevel: true });
  if (context.issues.length > 0) return { ok: false, issues: context.issues };

  const validated = validateArticleDocument({
    documentSchemaVersion: ARTICLE_DOCUMENT_SCHEMA_VERSION,
    doc: {
      type: "doc",
      content: content.length > 0 ? content : [{ type: "paragraph" }],
    },
  });
  if (!validated.ok) {
    return {
      ok: false,
      issues: validated.issues.map((issue) => ({
        line: 1,
        message: `${issue.path}: ${issue.message}`,
      })),
    };
  }
  return { ok: true, document: validated.document };
}

// Serialization ------------------------------------------------------------

/** Marks open outermost-first; code is innermost because it excludes others. */
const MARK_ORDER = ["link", "bold", "italic", "strike", "code"] as const;
const MARK_DELIMITERS: Record<string, [string, string]> = {
  bold: ["**", "**"],
  italic: ["*", "*"],
  strike: ["~~", "~~"],
};

function orderedMarks(marks: Mark[] | undefined): Mark[] {
  return [...(marks ?? [])].sort(
    (a, b) =>
      MARK_ORDER.indexOf(a.type as (typeof MARK_ORDER)[number]) -
      MARK_ORDER.indexOf(b.type as (typeof MARK_ORDER)[number]),
  );
}

function markKey(mark: Mark): string {
  return JSON.stringify(mark);
}

function escapeText(text: string): string {
  return text.replace(/[\\`*_[\]<>~|]/gu, "\\$&");
}

function codeSpan(text: string): string {
  const longestRun = Math.max(
    0,
    ...[...text.matchAll(/`+/gu)].map((match) => match[0].length),
  );
  const fence = "`".repeat(longestRun + 1);
  const padded =
    text.startsWith("`") || text.endsWith("`") ? ` ${text} ` : text;
  return `${fence}${padded}${fence}`;
}

function openMark(mark: Mark): string {
  if (mark.type === "link") return "[";
  return MARK_DELIMITERS[mark.type]?.[0] ?? "";
}

function closeMark(mark: Mark): string {
  if (mark.type === "link") {
    const href = String(mark.attrs?.href ?? "");
    return `](${href.replace(/[()\s]/gu, encodeURIComponent)})`;
  }
  return MARK_DELIMITERS[mark.type]?.[1] ?? "";
}

/**
 * Emits marks as transitions between neighboring text nodes, so `**a *b***`
 * does not become `**a*****b***`. Whitespace at a node's edges moves outside
 * its delimiters, because `** a**` is not emphasis in Markdown.
 */
function serializeInline(
  nodes: JSONContent[] | undefined,
  hardBreak = "\\\n",
): string {
  let output = "";
  let open: Mark[] = [];
  const closeTo = (keep: number) => {
    while (open.length > keep) output += closeMark(open.pop() as Mark);
  };

  for (const node of nodes ?? []) {
    if (node.type === "hardBreak") {
      closeTo(0);
      output += hardBreak;
      continue;
    }
    if (node.type !== "text" || !node.text) continue;
    const marks = orderedMarks(node.marks).filter(
      (mark) => mark.type !== "code",
    );
    const isCode = (node.marks ?? []).some((mark) => mark.type === "code");
    const leading = /^\s*/u.exec(node.text)?.[0] ?? "";
    const trailing =
      leading.length === node.text.length
        ? ""
        : (/\s*$/u.exec(node.text)?.[0] ?? "");
    const core = node.text.slice(
      leading.length,
      node.text.length - trailing.length,
    );

    let shared = 0;
    while (
      shared < open.length &&
      shared < marks.length &&
      markKey(open[shared] as Mark) === markKey(marks[shared] as Mark)
    ) {
      shared += 1;
    }
    if (leading) {
      closeTo(shared);
      output += leading.replace(/\n/gu, " ");
    }
    closeTo(shared);
    if (core.length === 0) continue;
    for (const mark of marks.slice(shared)) {
      output += openMark(mark);
      open.push(mark);
    }
    output += isCode ? codeSpan(core) : escapeText(core);
    if (trailing) {
      closeTo(0);
      output += trailing.replace(/\n/gu, " ");
    }
  }
  closeTo(0);
  return output;
}

function indent(text: string, prefix: string, firstPrefix = prefix): string {
  return text
    .split("\n")
    .map((line, index) =>
      line.length === 0 ? line : `${index === 0 ? firstPrefix : prefix}${line}`,
    )
    .join("\n");
}

/** Keeps a paragraph's first characters from reading as block syntax. */
function guardBlockStart(text: string): string {
  return text.replace(/^(#{1,6}\s|[-+]\s|\d+[.)]\s|>|---)/u, "\\$1");
}

function serializeTable(node: JSONContent): string {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) =>
      (cell.content ?? [])
        .map((block) => serializeInline(block.content, " "))
        .join(" ")
        .replace(/\n/gu, " "),
    ),
  );
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const pad = (row: string[]) => [
    ...row,
    ...Array.from({ length: width - row.length }, () => ""),
  ];
  const line = (row: string[]) => `| ${pad(row).join(" | ")} |`;
  const [header, ...body] = rows;
  return [
    line(header as string[]),
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...body.map(line),
  ].join("\n");
}

function serializeBlocks(nodes: JSONContent[] | undefined): string {
  return (nodes ?? [])
    .map(serializeBlock)
    .filter((block) => block.length > 0)
    .join("\n\n");
}

/** A list item keeps its nested list on the next line, so the list stays tight. */
function serializeListItem(item: JSONContent): string {
  const blocks = item.content ?? [];
  let output = "";
  blocks.forEach((block, index) => {
    const text = serializeBlock(block);
    if (text.length === 0) return;
    if (output.length > 0) {
      const nested =
        block.type === "bulletList" || block.type === "orderedList";
      output += nested && index > 0 ? "\n" : "\n\n";
    }
    output += text;
  });
  return output || " ";
}

function serializeBlock(node: JSONContent): string {
  switch (node.type) {
    case "paragraph":
      return guardBlockStart(serializeInline(node.content));
    case "heading":
      return `${"#".repeat(Number(node.attrs?.level ?? 2))} ${serializeInline(node.content, " ")}`;
    case "bulletList":
      return (node.content ?? [])
        .map((item) => indent(serializeListItem(item), "  ", "- "))
        .join("\n");
    case "orderedList": {
      const start = Number(node.attrs?.start ?? 1);
      return (node.content ?? [])
        .map((item, index) => {
          const marker = `${start + index}. `;
          return indent(
            serializeListItem(item),
            " ".repeat(marker.length),
            marker,
          );
        })
        .join("\n");
    }
    case "blockquote":
      return serializeBlocks(node.content)
        .split("\n")
        .map((line) => (line.length > 0 ? `> ${line}` : ">"))
        .join("\n");
    case "codeBlock": {
      const text = node.content?.[0]?.text ?? "";
      const longestRun = Math.max(
        2,
        ...[...text.matchAll(/`+/gu)].map((match) => match[0].length),
      );
      const fence = "`".repeat(longestRun + 1);
      const language = String(node.attrs?.language ?? "plaintext");
      return `${fence}${language === "plaintext" ? "" : language}\n${text}\n${fence}`;
    }
    case "horizontalRule":
      return "---";
    case "figure": {
      const attrs = node.attrs ?? {};
      const alt = attrs.decorative ? "" : String(attrs.alt ?? "");
      const caption =
        typeof attrs.caption === "string" && attrs.caption.length > 0
          ? ` "${attrs.caption.replace(/["\\]/gu, "\\$&")}"`
          : "";
      return `![${escapeText(alt)}](${ASSET_URL_SCHEME}${String(attrs.assetId)}${caption})`;
    }
    case "videoEmbed": {
      const attrs = node.attrs ?? {};
      return `[${escapeText(String(attrs.title ?? ""))}](${VIDEO_URL_SCHEME}${String(attrs.provider)}/${String(attrs.id)})`;
    }
    case "table":
      return serializeTable(node);
    default:
      return "";
  }
}

export function articleDocumentToMarkdown(document: ArticleDocument): string {
  return serializeBlocks(document.doc.content);
}
