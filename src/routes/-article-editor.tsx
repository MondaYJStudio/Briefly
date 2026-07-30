import { Alert, Button, Input, Label, TextArea } from "@heroui/react";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useState } from "react";

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
import type { VideoProviderFacts } from "../articles/video-embeds";
import type { Asset } from "../assets/assets";
import { getApiClient } from "./api.$";

export interface ArticleEditorProps {
  document: ArticleDocument;
  cover: ArticleCoverUsage | null;
  onChange: (document: ArticleDocument) => void;
  onCoverChange: (cover: ArticleCoverUsage | null) => void;
}

export function ArticleEditor({
  document,
  cover,
  onChange,
  onCoverChange,
}: ArticleEditorProps) {
  const [link, setLink] = useState("");
  const [language, setLanguage] = useState("plaintext");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [editorRevision, setEditorRevision] = useState(0);
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
        documentSchemaVersion: ARTICLE_DOCUMENT_SCHEMA_VERSION,
        doc: updatedEditor.getJSON() as ArticleDocument["doc"],
      });
    },
    onTransaction: () => setEditorRevision((current) => current + 1),
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
    if (!isAllowedCodeBlockLanguage(normalized)) return;
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
      <ArticleVideoAuthoring
        editor={activeEditor}
        editorRevision={editorRevision}
      />
      <ArticleAssetAuthoring
        editor={activeEditor}
        editorRevision={editorRevision}
        cover={cover}
        onCoverChange={onCoverChange}
      />
    </div>
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
    <section
      className="space-y-4 rounded-xl border border-default-200 p-4"
      aria-labelledby="article-videos-heading"
    >
      <div className="space-y-1">
        <h4 id="article-videos-heading" className="font-semibold">
          YouTube and Bilibili video embeds
        </h4>
        <p className="text-sm text-default-500">
          Convert only a supported provider URL or identifier. Raw iframe HTML,
          origins, query parameters, and iframe privileges are never stored.
        </p>
      </div>
      <Label htmlFor="videoEmbedInput">
        YouTube or Bilibili URL or identifier
      </Label>
      <Input
        id="videoEmbedInput"
        value={input}
        onChange={(event) => {
          setInput(event.target.value);
          setRecognized(null);
          setState("ready");
          setMessage("");
        }}
      />
      <Button
        type="button"
        isPending={state === "recognizing"}
        onPress={recognizeProvider}
      >
        Recognize supported provider
      </Button>
      {message ? (
        <p
          className={state === "invalid" ? "text-sm text-danger" : "text-sm"}
          role={state === "invalid" ? "alert" : "status"}
          aria-live="polite"
        >
          {message}
        </p>
      ) : null}
      <Label htmlFor="videoEmbedTitle">
        Understandable iframe title (required)
      </Label>
      <Input
        id="videoEmbedTitle"
        maxLength={200}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <Button type="button" isDisabled={!recognized} onPress={insertVideo}>
        Insert recognized video
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
    </section>
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
  onCoverChange,
}: {
  editor: Editor;
  editorRevision: number;
  cover: ArticleCoverUsage | null;
  onCoverChange: (cover: ArticleCoverUsage | null) => void;
}) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [state, setState] = useState<AssetAuthoringState>("loading");
  const [statusMessage, setStatusMessage] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
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
          setAssets(response.data.assets);
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
    <section
      className="space-y-4 rounded-xl border border-default-200 p-4"
      aria-labelledby="article-assets-heading"
    >
      <div className="space-y-1">
        <h4 id="article-assets-heading" className="font-semibold">
          Figures and cover
        </h4>
        <p className="text-sm text-default-500">
          Select or upload verified Assets, then describe each Article usage.
          Decorative figures expose that state and save an empty alternative
          value.
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
      <div className="space-y-2">
        <Label htmlFor="articleAssetUpload">Upload a verified image</Label>
        <Input
          id="articleAssetUpload"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
        />
        <Button
          type="button"
          isPending={state === "uploading"}
          onPress={uploadSelectedFile}
        >
          Upload and select image
        </Button>
      </div>
      {state === "loading" ? (
        <p role="status">Loading reusable Assets…</p>
      ) : assets.length === 0 ? (
        <p className="text-sm text-default-500">No reusable Assets yet.</p>
      ) : (
        <ul className="space-y-2" aria-label="Assets available to this Draft">
          {assets.map((asset) => (
            <li key={asset.id}>
              <Button
                fullWidth
                type="button"
                variant="secondary"
                aria-pressed={asset.id === selectedAssetId}
                onPress={() => {
                  setSelectedAssetId(asset.id);
                  setStatusMessage(`${asset.originalFilename} selected.`);
                }}
              >
                {asset.originalFilename} · {asset.width} × {asset.height}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {selected ? (
        <img
          className="max-h-48 w-full rounded-lg object-contain"
          src={`/media/private/${selected.id}`}
          alt=""
        />
      ) : null}

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
          id="newFigureAlt"
          disabled={figureDecorative}
          value={figureDecorative ? "" : figureAlt}
          onChange={(event) => setFigureAlt(event.target.value)}
        />
        <Label htmlFor="newFigureCaption">Figure caption (optional)</Label>
        <TextArea
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
                id={`figureAlt-${figure.pos}`}
                disabled={figure.decorative}
                value={figure.decorative ? "" : figure.alt}
                onChange={(event) =>
                  updateFigure(figure.pos, { alt: event.target.value })
                }
              />
              <Label htmlFor={`figureCaption-${figure.pos}`}>Caption</Label>
              <TextArea
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
    </section>
  );
}
