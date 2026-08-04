import {
  Alert,
  Button,
  Dropdown,
  Input,
  Label,
  Modal,
  TextArea,
} from "@heroui/react";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useState, type ReactNode } from "react";

import {
  createArticleEditorExtensions,
  isAllowedArticleLink,
  isAllowedCodeBlockLanguage,
} from "../articles/article-document";
import {
  ARTICLE_DOCUMENT_SCHEMA_VERSION,
  type ArticleCoverUsage,
  type ArticleDocument,
} from "../articles/articles";
import type { PublicationIssue } from "../articles/publication-workflow";
import type { VideoProviderFacts } from "../articles/video-embeds";
import type { AssetLibraryEntry, ReadyAsset } from "../assets/assets";
import { AdminIcon } from "../components/admin/icons";
import { publicationIssuesForSurface } from "../components/admin/publication-issues";
import { getApiClient } from "./api.$";

export interface ArticleEditorProps {
  title: string;
  document: ArticleDocument;
  cover: ArticleCoverUsage | null;
  publicationIssues: PublicationIssue[];
  isDisabled: boolean;
  onTitleChange: (title: string) => void;
  onChange: (document: ArticleDocument) => void;
  onCoverChange: (cover: ArticleCoverUsage | null) => void;
}

export function ArticleEditor({
  title,
  document,
  cover,
  publicationIssues,
  isDisabled,
  onTitleChange,
  onChange,
  onCoverChange,
}: ArticleEditorProps) {
  const [link, setLink] = useState("");
  const [language, setLanguage] = useState("plaintext");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [languageError, setLanguageError] = useState<string | null>(null);
  const [editorRevision, setEditorRevision] = useState(0);
  const [activePanel, setActivePanel] = useState<
    "link" | "code" | "video" | "media" | null
  >(null);
  const titlePublicationIssues = publicationIssuesForSurface(
    publicationIssues,
    "title",
  );
  const bodyPublicationIssues = publicationIssuesForSurface(
    publicationIssues,
    "body",
  );
  const coverPublicationIssues = publicationIssuesForSurface(
    publicationIssues,
    "cover",
  );
  const assetPublicationIssues = publicationIssuesForSurface(
    publicationIssues,
    "asset",
  );
  const editor = useEditor({
    immediatelyRender: false,
    editable: !isDisabled,
    extensions: createArticleEditorExtensions(),
    content: document.doc,
    editorProps: {
      attributes: {
        "aria-label": "Article body",
        class: "article-editor__content min-h-64 focus:outline-none",
      },
    },
    onUpdate: ({ editor: updatedEditor }) => {
      onChange({
        documentSchemaVersion: ARTICLE_DOCUMENT_SCHEMA_VERSION,
        doc: updatedEditor.getJSON() as ArticleDocument["doc"],
      });
    },
    onTransaction: () => setEditorRevision((current) => current + 1),
  });

  useEffect(() => {
    editor?.setEditable(!isDisabled, false);
  }, [editor, isDisabled]);

  useEffect(() => {
    if (isDisabled) setActivePanel(null);
  }, [isDisabled]);

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
    setActivePanel(null);
  }

  function applyCodeBlockLanguage() {
    const normalized = language.trim() || "plaintext";
    if (!isAllowedCodeBlockLanguage(normalized)) {
      setLanguageError(
        "Use a short language identifier beginning with a letter or number.",
      );
      return;
    }
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
    setLanguageError(null);
    setActivePanel(null);
  }

  return (
    <div className="article-editor">
      <div className="fmt-bar" role="toolbar" aria-label="Text formatting">
        {/* Undo/Redo */}
        <Button
          isIconOnly
          size="sm"
          type="button"
          variant="ghost"
          isDisabled={!activeEditor.can().undo()}
          onPress={() => activeEditor.chain().focus().undo().run()}
          aria-label="Undo"
        >
          <AdminIcon name="undo" size={16} />
        </Button>
        <Button
          isIconOnly
          size="sm"
          type="button"
          variant="ghost"
          isDisabled={!activeEditor.can().redo()}
          onPress={() => activeEditor.chain().focus().redo().run()}
          aria-label="Redo"
        >
          <AdminIcon name="redo" size={16} />
        </Button>
        <span className="fmt-sep" aria-hidden="true" />

        {/* Paragraph style dropdown */}
        <Dropdown.Root>
          <Dropdown.Trigger
            className="fmt-style-trigger"
            aria-label="Paragraph style"
          >
            {activeEditor.isActive("heading", { level: 2 })
              ? "Heading 2"
              : activeEditor.isActive("heading", { level: 3 })
                ? "Heading 3"
                : activeEditor.isActive("heading", { level: 4 })
                  ? "Heading 4"
                  : "Paragraph"}
            <AdminIcon name="chevron-down" size={12} />
          </Dropdown.Trigger>
          <Dropdown.Popover placement="bottom start">
            <Dropdown.Menu
              aria-label="Paragraph style"
              onAction={(key) => {
                if (key === "paragraph")
                  activeEditor.chain().focus().setParagraph().run();
                else if (key === "h2")
                  activeEditor
                    .chain()
                    .focus()
                    .toggleHeading({ level: 2 })
                    .run();
                else if (key === "h3")
                  activeEditor
                    .chain()
                    .focus()
                    .toggleHeading({ level: 3 })
                    .run();
                else if (key === "h4")
                  activeEditor
                    .chain()
                    .focus()
                    .toggleHeading({ level: 4 })
                    .run();
              }}
            >
              <Dropdown.Item id="paragraph" textValue="Paragraph">
                Paragraph
              </Dropdown.Item>
              <Dropdown.Item id="h2" textValue="Heading 2">
                <strong style={{ fontSize: "1.05rem" }}>Heading 2</strong>
              </Dropdown.Item>
              <Dropdown.Item id="h3" textValue="Heading 3">
                <strong>Heading 3</strong>
              </Dropdown.Item>
              <Dropdown.Item id="h4" textValue="Heading 4">
                <strong style={{ fontSize: "0.85rem" }}>Heading 4</strong>
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown.Root>
        <span className="fmt-sep" aria-hidden="true" />

        {/* Inline formatting */}
        <Button
          isIconOnly
          size="sm"
          type="button"
          variant="ghost"
          className={activeEditor.isActive("bold") ? "is-pressed" : ""}
          onPress={() => activeEditor.chain().focus().toggleBold().run()}
          aria-label="Bold"
          aria-pressed={activeEditor.isActive("bold")}
        >
          <AdminIcon name="bold" size={16} />
        </Button>
        <Button
          isIconOnly
          size="sm"
          type="button"
          variant="ghost"
          className={activeEditor.isActive("italic") ? "is-pressed" : ""}
          onPress={() => activeEditor.chain().focus().toggleItalic().run()}
          aria-label="Italic"
          aria-pressed={activeEditor.isActive("italic")}
        >
          <AdminIcon name="italic" size={16} />
        </Button>
        <Button
          isIconOnly
          size="sm"
          type="button"
          variant="ghost"
          className={activeEditor.isActive("strike") ? "is-pressed" : ""}
          onPress={() => activeEditor.chain().focus().toggleStrike().run()}
          aria-label="Strikethrough"
          aria-pressed={activeEditor.isActive("strike")}
        >
          <AdminIcon name="strike" size={16} />
        </Button>
        <Button
          isIconOnly
          size="sm"
          type="button"
          variant="ghost"
          className={activeEditor.isActive("code") ? "is-pressed" : ""}
          onPress={() => activeEditor.chain().focus().toggleCode().run()}
          aria-label="Inline code"
          aria-pressed={activeEditor.isActive("code")}
        >
          <AdminIcon name="code" size={16} />
        </Button>
        <Button
          isIconOnly
          size="sm"
          type="button"
          variant="ghost"
          onPress={() => setActivePanel("link")}
          aria-label="Link"
          aria-pressed={activeEditor.isActive("link")}
        >
          <AdminIcon name="link" size={16} />
        </Button>
        <span className="fmt-sep" aria-hidden="true" />

        {/* Lists and blocks */}
        <Button
          isIconOnly
          size="sm"
          type="button"
          variant="ghost"
          className={activeEditor.isActive("bulletList") ? "is-pressed" : ""}
          onPress={() => activeEditor.chain().focus().toggleBulletList().run()}
          aria-label="Bullet list"
          aria-pressed={activeEditor.isActive("bulletList")}
        >
          <AdminIcon name="list-ul" size={16} />
        </Button>
        <Button
          isIconOnly
          size="sm"
          type="button"
          variant="ghost"
          className={activeEditor.isActive("orderedList") ? "is-pressed" : ""}
          onPress={() => activeEditor.chain().focus().toggleOrderedList().run()}
          aria-label="Numbered list"
          aria-pressed={activeEditor.isActive("orderedList")}
        >
          <AdminIcon name="list-ol" size={16} />
        </Button>
        <Button
          isIconOnly
          size="sm"
          type="button"
          variant="ghost"
          className={activeEditor.isActive("blockquote") ? "is-pressed" : ""}
          onPress={() => activeEditor.chain().focus().toggleBlockquote().run()}
          aria-label="Blockquote"
          aria-pressed={activeEditor.isActive("blockquote")}
        >
          <AdminIcon name="quote" size={16} />
        </Button>
        <Button
          isIconOnly
          size="sm"
          type="button"
          variant="ghost"
          className={activeEditor.isActive("codeBlock") ? "is-pressed" : ""}
          onPress={() => setActivePanel("code")}
          aria-label="Code block"
          aria-pressed={activeEditor.isActive("codeBlock")}
        >
          <AdminIcon name="code-block" size={16} />
        </Button>
        <Button
          isIconOnly
          size="sm"
          type="button"
          variant="ghost"
          onPress={() => activeEditor.chain().focus().setHorizontalRule().run()}
          aria-label="Horizontal rule"
        >
          <AdminIcon name="divider" size={16} />
        </Button>
        <Button
          isIconOnly
          size="sm"
          type="button"
          variant="ghost"
          onPress={() => activeEditor.chain().focus().setHardBreak().run()}
          aria-label="Hard break"
        >
          <AdminIcon name="break" size={16} />
        </Button>
        <span className="fmt-sep" aria-hidden="true" />
        <Button
          isIconOnly
          size="sm"
          type="button"
          variant="ghost"
          onPress={() => setActivePanel("media")}
          aria-label="Insert image"
        >
          <AdminIcon name="image" size={16} />
        </Button>
        <Button
          isIconOnly
          size="sm"
          type="button"
          variant="ghost"
          onPress={() => setActivePanel("video")}
          aria-label="Insert video"
        >
          <AdminIcon name="video" size={16} />
        </Button>
      </div>
      <article
        className="doc article-editor__surface"
        aria-label="Article writing surface"
      >
        <label className="visually-hidden" htmlFor="articleTitle">
          Article title
        </label>
        <input
          className="doc-title-input"
          id="articleTitle"
          placeholder="Article title"
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
        />
        <PublicationGuidance issues={titlePublicationIssues} />
        <EditorContent editor={editor} />
        <PublicationGuidance issues={bodyPublicationIssues} />
      </article>

      <EditorToolModal
        title="Edit link"
        isOpen={activePanel === "link"}
        onOpenChange={(open) => setActivePanel(open ? "link" : null)}
      >
        <div className="editor-tool-panel space-y-4">
          <p className="text-sm text-default-500">
            Only absolute HTTP, HTTPS, and mailto links are allowed.
          </p>
          <div className="space-y-2">
            <Label htmlFor="articleEditorLink">Link URL</Label>
            <Input
              fullWidth
              autoFocus
              id="articleEditorLink"
              placeholder="https://example.com"
              value={link}
              onChange={(event) => {
                setLink(event.target.value);
                setLinkError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyLink();
                }
              }}
            />
          </div>
          {linkError ? (
            <p className="text-sm text-danger" role="alert">
              {linkError}
            </p>
          ) : activeEditor.isActive("link") ? (
            <p className="text-sm text-success" role="status">
              Link is active in selection
            </p>
          ) : null}
          <div className="editor-tool-actions">
            <Button
              type="button"
              variant="secondary"
              onPress={() => {
                activeEditor.chain().focus().unsetLink().run();
                setLink("");
                setLinkError(null);
                setActivePanel(null);
              }}
            >
              Remove link
            </Button>
            <Button type="button" onPress={applyLink}>
              Apply link
            </Button>
          </div>
        </div>
      </EditorToolModal>

      <EditorToolModal
        title="Insert code block"
        isOpen={activePanel === "code"}
        onOpenChange={(open) => setActivePanel(open ? "code" : null)}
      >
        <div className="editor-tool-panel space-y-4">
          <p className="text-sm text-default-500">
            Insert or update a code block with a syntax-highlighting language.
          </p>
          <div className="space-y-2">
            <Label htmlFor="articleCodeLanguage">Language identifier</Label>
            <Input
              fullWidth
              autoFocus
              className="font-mono"
              id="articleCodeLanguage"
              placeholder="typescript"
              value={language}
              onChange={(event) => {
                setLanguage(event.target.value);
                setLanguageError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyCodeBlockLanguage();
                }
              }}
            />
          </div>
          {languageError ? (
            <p className="text-sm text-danger" role="alert">
              {languageError}
            </p>
          ) : null}
          {activeEditor.isActive("codeBlock") ? (
            <p className="text-sm text-success" role="status">
              Code block is active — language:{" "}
              {activeEditor.getAttributes("codeBlock").language || "plaintext"}
            </p>
          ) : null}
          <div className="editor-tool-actions">
            <Button type="button" onPress={applyCodeBlockLanguage}>
              {activeEditor.isActive("codeBlock") ? "Update" : "Insert"} code
              block
            </Button>
          </div>
        </div>
      </EditorToolModal>

      <EditorToolModal
        title="Insert video"
        isOpen={activePanel === "video"}
        onOpenChange={(open) => setActivePanel(open ? "video" : null)}
      >
        <ArticleVideoAuthoring
          editor={activeEditor}
          editorRevision={editorRevision}
        />
      </EditorToolModal>

      <EditorToolModal
        title="Insert image"
        isOpen={activePanel === "media"}
        isWide
        onOpenChange={(open) => setActivePanel(open ? "media" : null)}
      >
        <ArticleAssetAuthoring
          editor={activeEditor}
          editorRevision={editorRevision}
          cover={cover}
          coverPublicationIssues={coverPublicationIssues}
          assetPublicationIssues={assetPublicationIssues}
          onCoverChange={onCoverChange}
        />
      </EditorToolModal>
    </div>
  );
}

function PublicationGuidance({
  issues,
}: Readonly<{ issues: PublicationIssue[] }>) {
  if (issues.length === 0) return null;
  return (
    <ul
      className="list-disc pl-5 text-sm"
      role="alert"
      style={{ color: "var(--danger-strong)" }}
    >
      {issues.map((issue) => (
        <li key={`${issue.code}:${issue.path}`}>{issue.message}</li>
      ))}
    </ul>
  );
}

function EditorToolModal({
  title,
  isOpen,
  isWide = false,
  onOpenChange,
  children,
}: Readonly<{
  title: string;
  isOpen: boolean;
  isWide?: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}>) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog
          aria-label={title}
          className={`editor-tool-modal${isWide ? " editor-tool-modal--wide" : ""}`}
        >
          <Modal.Header>
            <div className="briefly-drawer-head">
              <Modal.Heading>{title}</Modal.Heading>
              <Modal.CloseTrigger
                aria-label={`Close ${title.toLowerCase()} dialog`}
              />
            </div>
          </Modal.Header>
          <Modal.Body>{children}</Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

interface VideoEmbedUsage extends VideoProviderFacts {
  pos: number;
  nodeSize: number;
  title: string;
}

function articleVideoEmbeds(editor: Editor): VideoEmbedUsage[] {
  const videos: VideoEmbedUsage[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "videoEmbed") return;
    videos.push({
      pos,
      nodeSize: node.nodeSize,
      provider: node.attrs.provider as VideoProviderFacts["provider"],
      id: String(node.attrs.id),
      title: String(node.attrs.title),
    });
  });
  return videos;
}

function ArticleVideoAuthoring({
  editor,
  editorRevision,
}: {
  editor: Editor;
  editorRevision: number;
}) {
  const [input, setInput] = useState("");
  const [title, setTitle] = useState("");
  const [recognized, setRecognized] = useState<VideoProviderFacts | null>(null);
  const [state, setState] = useState<
    "ready" | "recognizing" | "recognized" | "invalid"
  >("ready");
  const [message, setMessage] = useState("");
  void editorRevision;
  const videos = articleVideoEmbeds(editor);

  async function recognizeProvider() {
    const candidate = input.trim();
    setRecognized(null);
    if (/[<>]/u.test(candidate)) {
      setState("invalid");
      setMessage("Paste a video URL or identifier, not iframe or HTML markup.");
      return;
    }
    setState("recognizing");
    setMessage("Recognizing supported video provider…");
    try {
      const response = await getApiClient().admin[
        "video-embeds"
      ].recognize.post({ input: candidate });
      if (response.status === 200 && response.data) {
        const facts = response.data as VideoProviderFacts;
        setRecognized(facts);
        setState("recognized");
        setMessage(
          `Recognized ${facts.provider === "youtube" ? "YouTube" : "Bilibili"} identifier ${facts.id}.`,
        );
        return;
      }
      setState("invalid");
      setMessage(
        "This is not a supported YouTube or Bilibili URL or identifier. Keep unsupported providers as ordinary links.",
      );
    } catch {
      setState("invalid");
      setMessage("The video provider could not be recognized. Please retry.");
    }
  }

  function insertVideo() {
    const accessibleTitle = title.trim();
    if (!recognized) {
      setState("invalid");
      setMessage("Recognize a supported provider before inserting the video.");
      return;
    }
    if (accessibleTitle.length === 0) {
      setState("invalid");
      setMessage("Enter an understandable iframe title before inserting.");
      return;
    }
    editor
      .chain()
      .focus()
      .insertContent({
        type: "videoEmbed",
        attrs: { ...recognized, title: accessibleTitle },
      })
      .run();
    setInput("");
    setTitle("");
    setRecognized(null);
    setState("ready");
    setMessage("Structured video embed inserted into the Draft.");
  }

  function updateVideoTitle(video: VideoEmbedUsage, nextTitle: string) {
    const node = editor.state.doc.nodeAt(video.pos);
    if (!node || node.type.name !== "videoEmbed") return;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(video.pos, undefined, {
        ...node.attrs,
        title: nextTitle,
      }),
    );
  }

  function removeVideo(video: VideoEmbedUsage) {
    editor.view.dispatch(
      editor.state.tr.delete(video.pos, video.pos + video.nodeSize),
    );
    setMessage("Video embed removed from the Draft.");
  }

  return (
    <div className="editor-tool-panel space-y-4">
      <div className="space-y-1">
        <p className="text-sm text-default-500">
          Only YouTube and Bilibili are supported. Paste a URL or video ID —
          never raw iframe HTML. Structured recognition extracts the platform
          and identifier; query parameters and iframe privileges are never
          stored.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="videoEmbedInput">Video URL or identifier</Label>
        <Input
          fullWidth
          className="font-mono"
          id="videoEmbedInput"
          placeholder="https://youtu.be/dQw4w9WgXcQ or dQw4w9WgXcQ"
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            setRecognized(null);
            setState("ready");
            setMessage("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void recognizeProvider();
            }
          }}
        />
      </div>
      <Button
        type="button"
        isPending={state === "recognizing"}
        onPress={recognizeProvider}
      >
        Recognize provider
      </Button>
      {message ? (
        <Alert
          status={
            state === "recognized"
              ? "success"
              : state === "invalid"
                ? "danger"
                : "default"
          }
          role={state === "invalid" ? "alert" : "status"}
        >
          <Alert.Content>
            <Alert.Description>{message}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      {recognized ? (
        <div className="space-y-2">
          <Label htmlFor="videoEmbedTitle">
            Accessible iframe title (required)
          </Label>
          <Input
            fullWidth
            id="videoEmbedTitle"
            maxLength={200}
            placeholder="Brief description of the video content"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && title.trim()) {
                event.preventDefault();
                insertVideo();
              }
            }}
          />
          <p className="text-sm text-default-500">
            Names the embedded player for screen readers. This title is required
            for accessibility.
          </p>
        </div>
      ) : null}
      <Button
        type="button"
        isDisabled={!recognized || !title.trim()}
        onPress={insertVideo}
      >
        Insert video embed
      </Button>

      {videos.length > 0 ? (
        <ol className="space-y-3" aria-label="Video embeds in this Draft">
          {videos.map((video, index) => (
            <li
              key={`${video.pos}:${video.provider}:${video.id}`}
              className="space-y-2 rounded-lg border border-default-200 p-3"
            >
              <p className="font-medium">
                Video {index + 1} · {video.provider} · {video.id}
              </p>
              <Label htmlFor={`videoTitle-${video.pos}`}>Iframe title</Label>
              <Input
                fullWidth
                id={`videoTitle-${video.pos}`}
                maxLength={200}
                value={video.title}
                onChange={(event) =>
                  updateVideoTitle(video, event.target.value)
                }
              />
              <Button
                type="button"
                variant="secondary"
                onPress={() => removeVideo(video)}
              >
                Remove video
              </Button>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

type AssetAuthoringState =
  "error" | "loading" | "ready" | "uploaded" | "uploading";

interface FigureUsage {
  pos: number;
  nodeSize: number;
  assetId: string;
  alt: string;
  caption: string | null;
  decorative: boolean;
}

function articleFigures(editor: Editor): FigureUsage[] {
  const figures: FigureUsage[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "figure") return;
    figures.push({
      pos,
      nodeSize: node.nodeSize,
      assetId: String(node.attrs.assetId),
      alt: String(node.attrs.alt),
      caption:
        typeof node.attrs.caption === "string" ? node.attrs.caption : null,
      decorative: node.attrs.decorative === true,
    });
  });
  return figures;
}

function ArticleAssetAuthoring({
  editor,
  editorRevision,
  cover,
  coverPublicationIssues,
  assetPublicationIssues,
  onCoverChange,
}: {
  editor: Editor;
  editorRevision: number;
  cover: ArticleCoverUsage | null;
  coverPublicationIssues: PublicationIssue[];
  assetPublicationIssues: PublicationIssue[];
  onCoverChange: (cover: ArticleCoverUsage | null) => void;
}) {
  const [assets, setAssets] = useState<ReadyAsset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [state, setState] = useState<AssetAuthoringState>("loading");
  const [statusMessage, setStatusMessage] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [sourceTab, setSourceTab] = useState<"library" | "upload">("library");
  const [coverAlt, setCoverAlt] = useState(cover?.alt ?? "");
  const [figureAlt, setFigureAlt] = useState("");
  const [figureCaption, setFigureCaption] = useState("");
  const [figureDecorative, setFigureDecorative] = useState(false);
  const selected = assets.find(({ id }) => id === selectedAssetId) ?? null;
  void editorRevision;
  const figures = articleFigures(editor);

  useEffect(() => {
    let active = true;
    void getApiClient()
      .admin.assets.get()
      .then((response) => {
        if (response.status !== 200 || !response.data)
          throw new Error("Assets unavailable");
        if (active) {
          setAssets(
            response.data.assets.filter(
              (
                asset,
              ): asset is Extract<
                AssetLibraryEntry,
                { lifecycleState: "ready" }
              > => asset.lifecycleState === "ready",
            ),
          );
          setState("ready");
        }
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => setCoverAlt(cover?.alt ?? ""), [cover]);

  async function uploadSelectedFile() {
    if (!uploadFile) {
      setStatusMessage("Choose an image before uploading.");
      return;
    }
    setState("uploading");
    setStatusMessage("Uploading and verifying image…");
    try {
      const response = await getApiClient().admin.assets.post({
        file: uploadFile,
      });
      if (response.status !== 201 || !response.data)
        throw new Error("Upload failed");
      setAssets((current) => [response.data, ...current]);
      setSelectedAssetId(response.data.id);
      setUploadFile(null);
      setSourceTab("library");
      setStatusMessage(
        `${response.data.originalFilename} uploaded and selected.`,
      );
      setState("uploaded");
    } catch {
      setStatusMessage("The image could not be uploaded or verified.");
      setState("error");
    }
  }

  function useSelectedAsCover() {
    const alt = coverAlt.trim();
    if (!selected || alt.length === 0) {
      setStatusMessage(
        "Select an Asset and enter meaningful cover alternative text.",
      );
      return;
    }
    onCoverChange({ assetId: selected.id, alt });
    setStatusMessage(`${selected.originalFilename} is the Draft cover.`);
  }

  function insertFigure() {
    if (!selected || (!figureDecorative && figureAlt.trim().length === 0)) {
      setStatusMessage(
        "Select an Asset and describe the figure, or mark it decorative.",
      );
      return;
    }
    editor
      .chain()
      .focus()
      .insertContent({
        type: "figure",
        attrs: {
          assetId: selected.id,
          alt: figureDecorative ? "" : figureAlt.trim(),
          caption: figureCaption.trim() || null,
          decorative: figureDecorative,
        },
      })
      .run();
    setFigureAlt("");
    setFigureCaption("");
    setFigureDecorative(false);
    setStatusMessage(`${selected.originalFilename} inserted as a figure.`);
  }

  function updateFigure(pos: number, changes: Record<string, unknown>) {
    const node = editor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== "figure") return;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        ...changes,
      }),
    );
  }

  function removeFigure(figure: FigureUsage) {
    editor.view.dispatch(
      editor.state.tr.delete(figure.pos, figure.pos + figure.nodeSize),
    );
    setStatusMessage("Figure removed from the Draft.");
  }

  return (
    <div className="editor-tool-panel space-y-4">
      {coverPublicationIssues.length > 0 ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>Cover needs attention</Alert.Title>
            <Alert.Description>
              <PublicationGuidance issues={coverPublicationIssues} />
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      {assetPublicationIssues.length > 0 ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>Referenced Asset needs attention</Alert.Title>
            <Alert.Description>
              <PublicationGuidance issues={assetPublicationIssues} />
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      <div className="space-y-1">
        <p className="text-sm text-default-500">
          Select or upload verified Assets from the library, then describe each
          use in this Article. Alt text is set per-figure — the same Asset can
          carry different descriptions in different contexts. Decorative figures
          save an empty alt value and are skipped by assistive technology.
        </p>
      </div>
      {state === "error" ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>Asset authoring needs attention</Alert.Title>
            <Alert.Description>{statusMessage}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : statusMessage ? (
        <p
          className="text-sm text-default-600"
          role="status"
          aria-live="polite"
        >
          {statusMessage}
        </p>
      ) : null}
      <div className="tabs-line-list" role="tablist" aria-label="Image source">
        <button
          className="tab-line"
          id="article-image-library-tab"
          type="button"
          role="tab"
          aria-selected={sourceTab === "library"}
          aria-controls="article-image-library-panel"
          onClick={() => setSourceTab("library")}
        >
          Library
        </button>
        <button
          className="tab-line"
          id="article-image-upload-tab"
          type="button"
          role="tab"
          aria-selected={sourceTab === "upload"}
          aria-controls="article-image-upload-panel"
          onClick={() => setSourceTab("upload")}
        >
          Upload new
        </button>
      </div>

      {sourceTab === "upload" ? (
        <section
          className="space-y-3"
          id="article-image-upload-panel"
          role="tabpanel"
          aria-labelledby="article-image-upload-tab"
        >
          <Label htmlFor="articleAssetUpload">Upload a verified image</Label>
          <Input
            fullWidth
            id="articleAssetUpload"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
          />
          <p className="text-sm text-default-500">
            JPEG, PNG, WebP, or AVIF · up to 8 MiB.
          </p>
          <Button
            type="button"
            isPending={state === "uploading"}
            onPress={uploadSelectedFile}
          >
            Upload and select image
          </Button>
        </section>
      ) : (
        <section
          className="space-y-4"
          id="article-image-library-panel"
          role="tabpanel"
          aria-labelledby="article-image-library-tab"
        >
          {state === "loading" ? (
            <p role="status">Loading reusable Assets…</p>
          ) : assets.length === 0 ? (
            <div className="empty image-picker-empty">
              <AdminIcon name="image" size={24} />
              <p>No reusable Assets yet.</p>
              <Button
                size="sm"
                type="button"
                variant="secondary"
                onPress={() => setSourceTab("upload")}
              >
                Upload your first image
              </Button>
            </div>
          ) : (
            <ul
              className="picker-grid"
              aria-label="Assets available to this Draft"
            >
              {assets.map((asset) => (
                <li key={asset.id}>
                  <button
                    className="media-cell"
                    type="button"
                    aria-pressed={asset.id === selectedAssetId}
                    onClick={() => {
                      setSelectedAssetId(asset.id);
                      setStatusMessage(`${asset.originalFilename} selected.`);
                    }}
                  >
                    <span className="thumb">
                      <img src={`/media/private/${asset.id}`} alt="" />
                    </span>
                    <span className="cell-meta">
                      <span className="fname">{asset.originalFilename}</span>
                      <span className="fmeta">
                        {asset.width} × {asset.height}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selected ? (
            <div className="picker-summary" aria-label="Selected Asset">
              <img
                className="mini"
                src={`/media/private/${selected.id}`}
                alt=""
              />
              <div className="grow">
                <div className="small picker-summary-name">
                  {selected.originalFilename}
                </div>
                <div className="small faint">
                  {selected.mimeType.replace("image/", "").toUpperCase()} ·{" "}
                  {selected.width} × {selected.height} ·{" "}
                  {selected.byteSize.toLocaleString()} bytes
                </div>
              </div>
              <span className="chip chip-primary">Selected</span>
            </div>
          ) : null}
        </section>
      )}

      <section className="space-y-3" aria-labelledby="cover-authoring-heading">
        <h5 id="cover-authoring-heading" className="font-medium">
          Optional cover
        </h5>
        {cover ? (
          <img
            className="max-h-48 w-full rounded-lg object-contain"
            src={`/media/private/${cover.assetId}`}
            alt={cover.alt}
          />
        ) : null}
        <Label htmlFor="articleCoverAlt">Cover alternative text</Label>
        <Input
          fullWidth
          id="articleCoverAlt"
          value={coverAlt}
          onChange={(event) => {
            setCoverAlt(event.target.value);
            if (cover) onCoverChange({ ...cover, alt: event.target.value });
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" onPress={useSelectedAsCover}>
            {cover
              ? "Replace cover with selected Asset"
              : "Use selected Asset as cover"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            isDisabled={!cover}
            onPress={() => {
              onCoverChange(null);
              setCoverAlt("");
              setStatusMessage("Cover removed from the Draft.");
            }}
          >
            Remove cover
          </Button>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="new-figure-heading">
        <h5 id="new-figure-heading" className="font-medium">
          Insert figure
        </h5>
        <Label htmlFor="newFigureAlt">Figure alternative text</Label>
        <Input
          fullWidth
          id="newFigureAlt"
          disabled={figureDecorative}
          value={figureDecorative ? "" : figureAlt}
          onChange={(event) => setFigureAlt(event.target.value)}
        />
        <Label htmlFor="newFigureCaption">Figure caption (optional)</Label>
        <TextArea
          fullWidth
          id="newFigureCaption"
          value={figureCaption}
          onChange={(event) => setFigureCaption(event.target.value)}
        />
        <label
          className="flex items-center gap-2"
          htmlFor="newFigureDecorative"
        >
          <input
            id="newFigureDecorative"
            type="checkbox"
            checked={figureDecorative}
            onChange={(event) => {
              setFigureDecorative(event.target.checked);
              if (event.target.checked) setFigureAlt("");
            }}
          />
          Decorative figure (saved with empty alternative text)
        </label>
        <Button type="button" onPress={insertFigure}>
          Insert selected Asset as figure
        </Button>
      </section>

      {figures.length > 0 ? (
        <ol className="space-y-4" aria-label="Figures in this Draft">
          {figures.map((figure, index) => (
            <li
              key={`${figure.pos}:${figure.assetId}`}
              className="space-y-2 rounded-lg border border-default-200 p-3"
            >
              <p className="font-medium">Figure {index + 1}</p>
              <img
                className="max-h-40 w-full object-contain"
                src={`/media/private/${figure.assetId}`}
                alt=""
              />
              <Label htmlFor={`figureAlt-${figure.pos}`}>
                Alternative text
              </Label>
              <Input
                fullWidth
                id={`figureAlt-${figure.pos}`}
                disabled={figure.decorative}
                value={figure.decorative ? "" : figure.alt}
                onChange={(event) =>
                  updateFigure(figure.pos, { alt: event.target.value })
                }
              />
              <Label htmlFor={`figureCaption-${figure.pos}`}>Caption</Label>
              <TextArea
                fullWidth
                id={`figureCaption-${figure.pos}`}
                value={figure.caption ?? ""}
                onChange={(event) =>
                  updateFigure(figure.pos, {
                    caption: event.target.value || null,
                  })
                }
              />
              <label
                className="flex items-center gap-2"
                htmlFor={`figureDecorative-${figure.pos}`}
              >
                <input
                  id={`figureDecorative-${figure.pos}`}
                  type="checkbox"
                  checked={figure.decorative}
                  onChange={(event) =>
                    updateFigure(figure.pos, {
                      decorative: event.target.checked,
                      alt: event.target.checked ? "" : figure.alt,
                    })
                  }
                />
                Decorative figure
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  isDisabled={!selected}
                  onPress={() =>
                    selected &&
                    updateFigure(figure.pos, { assetId: selected.id })
                  }
                >
                  Replace with selected Asset
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onPress={() => removeFigure(figure)}
                >
                  Remove figure
                </Button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-default-500">No figures in this Draft.</p>
      )}
    </div>
  );
}
