import type { JSONContent } from "@tiptap/core";

import type { ArticleDocument } from "./articles";

/** A run of text inside a changed line; `changed` marks inserted/deleted characters. */
export interface DiffSegment {
  text: string;
  changed: boolean;
}

export type DocumentDiffLine =
  | { kind: "same"; text: string }
  | { kind: "removed" | "added"; segments: DiffSegment[] }
  | { kind: "skipped"; count: number };

/** Character-level highlighting is skipped above this LCS table size. */
const INLINE_DIFF_MAXIMUM_CELLS = 1_000_000;

function inlineText(nodes: JSONContent[] | undefined): string {
  return (nodes ?? [])
    .map((node) => (node.type === "hardBreak" ? " " : (node.text ?? "")))
    .join("");
}

function blockLines(node: JSONContent, prefix: string): string[] {
  switch (node.type) {
    case "paragraph":
      return [prefix + inlineText(node.content)];
    case "heading":
      return [
        prefix +
          "#".repeat(Number(node.attrs?.level ?? 2)) +
          " " +
          inlineText(node.content),
      ];
    case "bulletList":
    case "orderedList":
      return (node.content ?? []).flatMap((item, index) => {
        const marker =
          node.type === "bulletList"
            ? "• "
            : `${Number(node.attrs?.start ?? 1) + index}. `;
        return (item.content ?? []).flatMap((child, childIndex) =>
          blockLines(
            child,
            prefix + (childIndex === 0 ? marker : " ".repeat(marker.length)),
          ),
        );
      });
    case "blockquote":
      return (node.content ?? []).flatMap((child) =>
        blockLines(child, prefix + "> "),
      );
    case "codeBlock":
      return inlineText(node.content)
        .split("\n")
        .map((line) => prefix + line);
    case "horizontalRule":
      return [prefix + "---"];
    case "figure":
      return [
        prefix +
          `[figure] ${String(node.attrs?.caption ?? node.attrs?.alt ?? "")}`.trimEnd(),
      ];
    case "videoEmbed":
      return [prefix + `[video] ${String(node.attrs?.title ?? "")}`];
    case "table":
      return (node.content ?? []).map(
        (row) =>
          prefix +
          "| " +
          (row.content ?? [])
            .map((cell) =>
              (cell.content ?? [])
                .map((paragraph) => inlineText(paragraph.content))
                .join(" "),
            )
            .join(" | ") +
          " |",
      );
    default:
      return [];
  }
}

/** Flatten an Article document into one comparable text line per block. */
export function documentLines(document: ArticleDocument): string[] {
  return document.doc.content.flatMap((node) => blockLines(node, ""));
}

/** Longest-common-subsequence edit script over two sequences. */
function editScript<T>(
  before: readonly T[],
  after: readonly T[],
): { kind: "same" | "removed" | "added"; index: number }[] {
  const rows = before.length + 1;
  const columns = after.length + 1;
  const table = new Uint32Array(rows * columns);
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i * columns + j] =
        before[i] === after[j]
          ? table[(i + 1) * columns + j + 1] + 1
          : Math.max(table[(i + 1) * columns + j], table[i * columns + j + 1]);
    }
  }
  const script: { kind: "same" | "removed" | "added"; index: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      script.push({ kind: "same", index: i });
      i += 1;
      j += 1;
    } else if (
      j >= after.length ||
      (i < before.length &&
        table[(i + 1) * columns + j] >= table[i * columns + j + 1])
    ) {
      script.push({ kind: "removed", index: i });
      i += 1;
    } else {
      script.push({ kind: "added", index: j });
      j += 1;
    }
  }
  return script;
}

function pushSegment(segments: DiffSegment[], text: string, changed: boolean) {
  const last = segments.at(-1);
  if (last && last.changed === changed) last.text += text;
  else segments.push({ text, changed });
}

function inlineSegments(
  before: string,
  after: string,
): { removed: DiffSegment[]; added: DiffSegment[] } {
  const beforeCharacters = Array.from(before);
  const afterCharacters = Array.from(after);
  if (
    (beforeCharacters.length + 1) * (afterCharacters.length + 1) >
    INLINE_DIFF_MAXIMUM_CELLS
  ) {
    return {
      removed: [{ text: before, changed: true }],
      added: [{ text: after, changed: true }],
    };
  }
  const removed: DiffSegment[] = [];
  const added: DiffSegment[] = [];
  for (const step of editScript(beforeCharacters, afterCharacters)) {
    if (step.kind === "same") {
      pushSegment(removed, beforeCharacters[step.index], false);
      pushSegment(added, beforeCharacters[step.index], false);
    } else if (step.kind === "removed") {
      pushSegment(removed, beforeCharacters[step.index], true);
    } else {
      pushSegment(added, afterCharacters[step.index], true);
    }
  }
  return { removed, added };
}

/**
 * Diff the published body against the Draft body, block by block. Paired
 * replaced blocks get character-level highlights; unchanged runs collapse to
 * `skipped` beyond `context` lines around each change.
 */
export function diffDocuments(
  published: ArticleDocument,
  draft: ArticleDocument,
  context = 1,
): DocumentDiffLine[] {
  const before = documentLines(published);
  const after = documentLines(draft);
  const lines: DocumentDiffLine[] = [];
  const script = editScript(before, after);

  for (let position = 0; position < script.length;) {
    const step = script[position];
    if (step.kind === "same") {
      lines.push({ kind: "same", text: before[step.index] });
      position += 1;
      continue;
    }
    const removed: number[] = [];
    const added: number[] = [];
    while (position < script.length && script[position].kind !== "same") {
      const change = script[position];
      (change.kind === "removed" ? removed : added).push(change.index);
      position += 1;
    }
    const paired = Math.min(removed.length, added.length);
    const removedLines: DocumentDiffLine[] = [];
    const addedLines: DocumentDiffLine[] = [];
    removed.forEach((index, offset) => {
      if (offset < paired) {
        const segments = inlineSegments(before[index], after[added[offset]]);
        removedLines.push({ kind: "removed", segments: segments.removed });
        addedLines.push({ kind: "added", segments: segments.added });
      } else {
        removedLines.push({
          kind: "removed",
          segments: [{ text: before[index], changed: true }],
        });
      }
    });
    for (const index of added.slice(paired)) {
      addedLines.push({
        kind: "added",
        segments: [{ text: after[index], changed: true }],
      });
    }
    lines.push(...removedLines, ...addedLines);
  }

  const keep = lines.map((line) => line.kind !== "same");
  lines.forEach((line, index) => {
    if (line.kind === "same") return;
    for (
      let offset = Math.max(0, index - context);
      offset <= Math.min(lines.length - 1, index + context);
      offset += 1
    ) {
      keep[offset] = true;
    }
  });
  const collapsed: DocumentDiffLine[] = [];
  lines.forEach((line, index) => {
    if (keep[index]) {
      collapsed.push(line);
      return;
    }
    const last = collapsed.at(-1);
    if (last?.kind === "skipped") last.count += 1;
    else collapsed.push({ kind: "skipped", count: 1 });
  });
  return collapsed.some(
    (line) => line.kind !== "same" && line.kind !== "skipped",
  )
    ? collapsed
    : [];
}
