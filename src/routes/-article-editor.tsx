import { Button, Input, Label } from "@heroui/react";
import { EditorContent, useEditor } from "@tiptap/react";
import { useState } from "react";

import {
  createArticleEditorExtensions,
  isAllowedArticleLink,
} from "../articles/article-document";
import type { ArticleDocument } from "../articles/articles";

export interface ArticleEditorProps {
  document: ArticleDocument;
  onChange: (document: ArticleDocument) => void;
}

export function ArticleEditor({ document, onChange }: ArticleEditorProps) {
  const [link, setLink] = useState("");
  const [language, setLanguage] = useState("plaintext");
  const [linkError, setLinkError] = useState<string | null>(null);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: createArticleEditorExtensions(),
    content: document.doc,
    editorProps: {
      attributes: {
        "aria-label": "Article body",
        class:
          "article-editor__content min-h-64 rounded-xl border border-default-300 p-4 focus:outline-none focus:ring-2 focus:ring-primary",
      },
    },
    onUpdate: ({ editor: updatedEditor }) => {
      onChange({
        documentSchemaVersion: 1,
        doc: updatedEditor.getJSON() as ArticleDocument["doc"],
      });
    },
  });

  if (!editor) return <p role="status">Preparing the text-rich editor…</p>;
  const activeEditor = editor;

  function applyLink() {
    const normalized = link.trim();
    if (!isAllowedArticleLink(normalized)) {
      setLinkError("Use an absolute HTTP, HTTPS, or mailto link.");
      return;
    }
    activeEditor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: normalized })
      .run();
    setLinkError(null);
  }

  function applyCodeBlockLanguage() {
    const normalized = language.trim() || "plaintext";
    if (!/^[a-z0-9][a-z0-9+#.-]{0,31}$/iu.test(normalized)) return;
    if (activeEditor.isActive("codeBlock")) {
      activeEditor
        .chain()
        .focus()
        .updateAttributes("codeBlock", { language: normalized })
        .run();
    } else {
      activeEditor
        .chain()
        .focus()
        .toggleCodeBlock({ language: normalized })
        .run();
    }
  }

  const formatButtons = [
    [
      "Paragraph",
      () => activeEditor.chain().focus().setParagraph().run(),
      "paragraph",
    ],
    [
      "Heading 2",
      () => activeEditor.chain().focus().toggleHeading({ level: 2 }).run(),
      "heading",
      { level: 2 },
    ],
    [
      "Heading 3",
      () => activeEditor.chain().focus().toggleHeading({ level: 3 }).run(),
      "heading",
      { level: 3 },
    ],
    [
      "Heading 4",
      () => activeEditor.chain().focus().toggleHeading({ level: 4 }).run(),
      "heading",
      { level: 4 },
    ],
    [
      "Bullet list",
      () => activeEditor.chain().focus().toggleBulletList().run(),
      "bulletList",
    ],
    [
      "Ordered list",
      () => activeEditor.chain().focus().toggleOrderedList().run(),
      "orderedList",
    ],
    [
      "Blockquote",
      () => activeEditor.chain().focus().toggleBlockquote().run(),
      "blockquote",
    ],
    ["Bold", () => activeEditor.chain().focus().toggleBold().run(), "bold"],
    [
      "Italic",
      () => activeEditor.chain().focus().toggleItalic().run(),
      "italic",
    ],
    [
      "Strike",
      () => activeEditor.chain().focus().toggleStrike().run(),
      "strike",
    ],
    [
      "Inline code",
      () => activeEditor.chain().focus().toggleCode().run(),
      "code",
    ],
  ] as const;

  return (
    <div className="space-y-3">
      <div
        className="flex flex-wrap gap-2"
        role="toolbar"
        aria-label="Text formatting"
      >
        {formatButtons.map(([label, action, name, attributes]) => (
          <Button
            key={label}
            size="sm"
            type="button"
            variant="secondary"
            aria-pressed={activeEditor.isActive(name, attributes)}
            onPress={action}
          >
            {label}
          </Button>
        ))}
        <Button
          size="sm"
          type="button"
          variant="secondary"
          onPress={() => activeEditor.chain().focus().setHorizontalRule().run()}
        >
          Horizontal rule
        </Button>
        <Button
          size="sm"
          type="button"
          variant="secondary"
          onPress={() => activeEditor.chain().focus().setHardBreak().run()}
        >
          Hard break
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="articleEditorLink">Validated link</Label>
          <Input
            id="articleEditorLink"
            value={link}
            onChange={(event) => setLink(event.target.value)}
          />
        </div>
        <Button type="button" onPress={applyLink}>
          Apply link
        </Button>
        <Button
          type="button"
          variant="secondary"
          onPress={() => activeEditor.chain().focus().unsetLink().run()}
        >
          Remove link
        </Button>
      </div>
      {linkError ? (
        <p className="text-sm text-danger" role="alert">
          {linkError}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="articleCodeLanguage">Code block language</Label>
          <Input
            id="articleCodeLanguage"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          />
        </div>
        <Button type="button" onPress={applyCodeBlockLanguage}>
          Apply code block
        </Button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
