import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  articleDocumentToMarkdown,
  markdownToArticleDocument,
  type MarkdownIssue,
} from "../articles/article-markdown";
import { ASSET_MAXIMUM_BYTE_SIZE } from "../assets/assets";
import { uploadAsset } from "../assets/assets.server";
import { trashArticle } from "../articles/article-trash.server";
import type { Article } from "../articles/articles";
import {
  createArticle,
  listArticles,
  readArticle,
  updateArticleDraft,
} from "../articles/articles.server";
import { projectAdminArticles } from "../articles/publication-history.server";
import { publicationWorkflow } from "../articles/publication-workflow.server";
import type { PublicationOutcome } from "../articles/publication-workflow";
import { deriveSlugFromTitle } from "../articles/slug-follow";
import {
  createArticleTranslation,
  linkArticleTranslation,
  listArticleTranslations,
  unlinkArticleTranslation,
  type CreateArticleTranslationResult,
  type LinkArticleTranslationResult,
} from "../articles/translation-groups.server";
import { listChannels } from "../channels/channels.server";
import type { RuntimeBindings } from "../env/runtime.server";

/**
 * The Article tools an MCP client may call on the Administrator's behalf.
 * Each tool runs the same domain operation as the matching admin API route,
 * so Draft Versions, Publication Conflicts, and Publication Issues mean
 * exactly what they mean in the editor.
 */

export interface ArticleToolContext {
  bindings: RuntimeBindings;
  applicationOrigin: string;
}

function json(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function refusal(message: string, details?: unknown): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text:
          details === undefined
            ? message
            : `${message}\n${JSON.stringify(details, null, 2)}`,
      },
    ],
  };
}

function markdownRefusal(issues: MarkdownIssue[]): CallToolResult {
  return refusal(
    "The Markdown body uses constructs an Article cannot hold. Nothing was saved.",
    { issues },
  );
}

async function articleView(
  context: ArticleToolContext,
  article: Article,
  options: { includeBody: boolean },
) {
  const [[projected], translations] = await Promise.all([
    projectAdminArticles(context.bindings.DB, [article]),
    listArticleTranslations(context.bindings.DB, article.id),
  ]);
  const draft = article.draft;
  return {
    id: article.id,
    lifecycle: projected?.lifecycleProjection ?? "draft",
    draftVersion: draft.version,
    currentPublicationId: article.currentPublicationId,
    title: draft.title,
    slug: draft.slug,
    slugIsManual: draft.slugIsManual,
    summary: draft.summary,
    tags: draft.tags,
    language: draft.language,
    channel: draft.channelSlug,
    byline: draft.byline,
    hasCover: draft.cover !== null,
    cover: draft.cover,
    updatedAt: draft.updatedAt,
    translations: translations.ok
      ? translations.translations.map((translation) => ({
          id: translation.id,
          title: translation.title,
          language: translation.language,
          lifecycle: translation.lifecycleProjection,
        }))
      : [],
    ...(options.includeBody
      ? { markdown: articleDocumentToMarkdown(draft.document) }
      : {}),
  };
}

function draftSaveRefusal(
  result: Exclude<Awaited<ReturnType<typeof updateArticleDraft>>, { ok: true }>,
): CallToolResult {
  switch (result.reason) {
    case "invalid":
      return refusal("The Draft was not saved.", { issues: result.issues });
    case "not-found":
      return refusal("No Article with that id exists (it may be in Trash).");
    case "slug-conflict":
      return refusal(
        "Another Article already claims that slug. Choose a different slug.",
      );
    case "conflict":
      return refusal(
        "The Draft changed since that Draft Version. Call get_article for the current version and apply your change again.",
      );
  }
}

function translationRefusal(
  result: Exclude<CreateArticleTranslationResult, { ok: true }>,
): CallToolResult {
  switch (result.reason) {
    case "invalid":
      return refusal("Nothing was created: the language is invalid.", {
        issues: result.issues,
      });
    case "not-found":
      return refusal(
        "Nothing was created: no Article with the translationOf id exists (it may be in Trash).",
      );
    case "language-taken":
      return refusal(
        "Nothing was created: another Article in that Translation Group already uses this language. Languages compare by language and script, so zh-CN and zh-Hans, or en and en-GB, count as one. Call get_article on translationOf to see the languages in use.",
      );
    case "conflict":
      return refusal(
        "Nothing was created: the Translation Group changed meanwhile. Try again.",
      );
  }
}

function linkRefusal(
  result: Exclude<LinkArticleTranslationResult, { ok: true }>,
): CallToolResult {
  switch (result.reason) {
    case "not-found":
      return refusal(
        "Nothing was linked: no Article with the articleId exists (it may be in Trash).",
      );
    case "translation-not-found":
      return refusal(
        "Nothing was linked: no Article with the translationArticleId exists (it may be in Trash).",
      );
    case "self":
      return refusal("Nothing was linked: an Article cannot translate itself.");
    case "already-linked":
      return refusal(
        "Nothing was linked: translationArticleId already belongs to a Translation Group. Call unlink_translation on it first to move it.",
      );
    case "language-taken":
      return refusal(
        "Nothing was linked: the group already has a Current Publication in the joining Article's public language. Languages compare by language and script, so zh-CN and zh-Hans, or en and en-GB, count as one.",
      );
    case "conflict":
      return refusal(
        "Nothing was linked: the Translation Group changed meanwhile. Try again.",
      );
  }
}

function workflowRefusal(
  outcome: Exclude<PublicationOutcome<unknown>, { ok: true }>,
): CallToolResult {
  switch (outcome.reason) {
    case "invalid":
      return refusal(
        "The Draft cannot be published yet. Fix these Publication Issues and save a new Draft Version.",
        { issues: outcome.issues },
      );
    case "not-found":
      return refusal("No Article with that id exists (it may be in Trash).");
    case "conflict":
      return refusal(
        "Publication Conflict: the Draft Version or the Current Publication is no longer current. Call get_article and try again with its values.",
      );
    case "command-invalid":
      return refusal("The request was malformed.");
    case "failed":
      return refusal(
        `Publication could not complete (${outcome.code}). The previous public version is unchanged; try again.`,
      );
  }
}

/** Base64 expands bytes by 4/3, so this bounds the string before decoding. */
const ASSET_BASE64_MAXIMUM_LENGTH =
  Math.ceil((ASSET_MAXIMUM_BYTE_SIZE * 4) / 3) + 4;

function bytesFromBase64(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const decoded = atob(
      value.replace(/^data:[^,]*,/u, "").replace(/\s/gu, ""),
    );
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1)
      bytes[index] = decoded.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

/** Downloads an image from a public https URL, never reading past the asset size limit. */
async function fetchImage(
  url: string,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; mimeType: string } | string> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "image/*" } });
  } catch {
    return "The image URL could not be fetched.";
  }
  if (!response.ok)
    return `The image URL answered with status ${response.status}.`;
  const declared = Number(response.headers.get("content-length"));
  if (declared > ASSET_MAXIMUM_BYTE_SIZE)
    return "The image is larger than 8 MiB.";
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > ASSET_MAXIMUM_BYTE_SIZE)
    return "The image is larger than 8 MiB.";
  const mimeType = (response.headers.get("content-type") ?? "")
    .split(";")[0]!
    .trim()
    .toLowerCase();
  return { bytes, mimeType };
}

const articleId = z.string().uuid().describe("The Article id.");
const draftVersion = z
  .number()
  .int()
  .positive()
  .describe(
    "The exact Draft Version you read with get_article. Saves and publishes are refused if the Draft changed since.",
  );
const markdown = z
  .string()
  .describe(
    'The Article body as Markdown (GitHub-flavored). Headings map to levels 2–4 (# becomes ##); the title is stored separately, so do not repeat it as a heading. Links must be absolute http(s) or mailto URLs. Tables only at the top level. Images must be uploaded assets written as ![alt](briefly-asset:<asset id> "caption"); video embeds as a paragraph holding only [title](briefly-video:youtube/<id>). Raw HTML and task lists are rejected.',
  );
const language = z
  .string()
  .nullable()
  .optional()
  .describe(
    "BCP 47 tag. Prefer en, zh-Hans, zh-Hant, ja, or ko; any other valid tag is accepted. For a translation, reuse the exact tags its Translation Group already uses (see translations in get_article). null uses the Site Settings default.",
  );
const byline = z
  .object({
    name: z.string().min(1),
    url: z.string().url().nullable(),
  })
  .nullable()
  .describe("Public authorship. null uses the Site Settings default byline.");

const cover = z
  .object({
    assetId: z.string().uuid().describe("An asset id from upload_asset."),
    alt: z.string().trim().min(1).describe("Alt text for the cover image."),
  })
  .nullable()
  .describe(
    "The cover image. Omit to leave it unchanged (update_draft) or have none (create_article); null removes it.",
  );

export function registerArticleTools(
  server: McpServer,
  context: ArticleToolContext,
) {
  const database = context.bindings.DB;
  const workflow = () =>
    publicationWorkflow({
      database,
      bucket: context.bindings.MEDIA_BUCKET,
      applicationOrigin: context.applicationOrigin,
    });

  server.registerTool(
    "list_channels",
    {
      title: "List Channels",
      description:
        "List the Channel registry. An Article belongs to at most one Channel; public API consumers filter Current Publications by Channel slug.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () =>
      json(
        (await listChannels(database)).map(({ slug, name }) => ({
          slug,
          name,
        })),
      ),
  );

  server.registerTool(
    "upload_asset",
    {
      title: "Upload Asset",
      description:
        'Upload an image (PNG, JPEG, WebP, or AVIF, at most 8 MiB and 8192 px per side) to the Asset library and return its asset id. Pass either url (a public https image link the server downloads) or dataBase64 with mimeType. Then reference the image in Markdown as ![alt](briefly-asset:<asset id> "caption") in create_article or update_draft.',
      inputSchema: {
        filename: z
          .string()
          .min(1)
          .max(255)
          .describe("Original filename, e.g. diagram.png."),
        url: z
          .string()
          .url()
          .refine((value) => value.startsWith("https://"), "Use an https URL.")
          .optional()
          .describe(
            "Public https URL of the image. Omit when sending dataBase64.",
          ),
        dataBase64: z
          .string()
          .max(ASSET_BASE64_MAXIMUM_LENGTH)
          .optional()
          .describe("The image bytes, base64-encoded. Omit when sending url."),
        mimeType: z
          .enum(["image/avif", "image/jpeg", "image/png", "image/webp"])
          .optional()
          .describe(
            "Required with dataBase64; must match the image bytes. With url it is read from the response.",
          ),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async (input) => {
      if ((input.url === undefined) === (input.dataBase64 === undefined))
        return refusal("Pass exactly one of url or dataBase64.");

      let bytes: Uint8Array<ArrayBuffer>;
      let mimeType: string;
      if (input.url !== undefined) {
        const fetched = await fetchImage(input.url);
        if (typeof fetched === "string") return refusal(fetched);
        ({ bytes, mimeType } = fetched);
      } else {
        if (!input.mimeType)
          return refusal("mimeType is required with dataBase64.");
        const decoded = bytesFromBase64(input.dataBase64!);
        if (!decoded) return refusal("dataBase64 is not valid base64.");
        bytes = decoded;
        mimeType = input.mimeType;
      }

      const result = await uploadAsset(
        database,
        context.bindings.MEDIA_BUCKET,
        new File([bytes], input.filename, { type: mimeType }),
      );
      if (!result.ok) {
        return result.reason === "invalid"
          ? refusal("The image was not uploaded.", { issues: result.issues })
          : refusal("The image could not be stored. Try again.");
      }
      const asset = result.asset;
      return json({
        id: asset.id,
        filename: asset.originalFilename,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
        byteSize: asset.byteSize,
        markdown: `![alt text](briefly-asset:${asset.id})`,
      });
    },
  );

  server.registerTool(
    "list_articles",
    {
      title: "List Articles",
      description:
        "List Articles outside Trash, most recently updated first, with lifecycle (draft, published, changes-pending, unpublished) and Draft Version. Bodies are omitted; use get_article.",
      inputSchema: {
        channel: z
          .string()
          .optional()
          .describe("Only Articles whose Draft is in this Channel slug."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ channel }) => {
      const articles = await listArticles(database, {
        channelSlug: channel && channel.length > 0 ? channel : undefined,
      });
      const projected = await projectAdminArticles(database, articles);
      return json(
        projected.map((article) => ({
          id: article.id,
          title: article.draft.title,
          slug: article.draft.slug,
          lifecycle: article.lifecycleProjection,
          draftVersion: article.draft.version,
          currentPublicationId: article.currentPublicationId,
          channel: article.draft.channelSlug,
          language: article.draft.language,
          updatedAt: article.draft.updatedAt,
        })),
      );
    },
  );

  server.registerTool(
    "get_article",
    {
      title: "Get Article",
      description:
        "Read one Article's Draft: metadata, Markdown body, Draft Version, Current Publication id, and the other Articles in its Translation Group (id, title, language, lifecycle). Read this before update_draft, preview_article, or publish_article.",
      inputSchema: { articleId },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ articleId: id }) => {
      const article = await readArticle(database, id);
      if (!article)
        return refusal("No Article with that id exists (it may be in Trash).");
      return json(await articleView(context, article, { includeBody: true }));
    },
  );

  server.registerTool(
    "create_article",
    {
      title: "Create Article",
      description:
        "Create a new Article with a private Draft. Nothing becomes public until publish_article. Without a slug, the slug follows the title as it does in the editor. Pass translationOf to create it as a translation of another Article in the same Translation Group.",
      inputSchema: {
        title: z.string().trim().min(1).max(300),
        markdown,
        slug: z
          .string()
          .optional()
          .describe(
            "Canonical public slug, e.g. check-backlinks. Unicode is allowed; slashes, ?, #, % and backslashes are not. Slugs are unique across the whole site, so a translation needs its own slug; omit it to let the slug follow the translated title.",
          ),
        summary: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
        language,
        translationOf: z
          .string()
          .uuid()
          .optional()
          .describe(
            "Create this Article as a translation of that Article id; it joins the same Translation Group. language is then required, and must not be a language another Article in the group already uses.",
          ),
        channel: z
          .string()
          .nullable()
          .optional()
          .describe("Channel slug from list_channels, or null for none."),
        byline: byline.optional(),
        cover: cover.optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (input) => {
      const converted = markdownToArticleDocument(input.markdown);
      if (!converted.ok) return markdownRefusal(converted.issues);

      let created: Article;
      if (input.translationOf === undefined) {
        created = await createArticle(database);
      } else {
        if (!input.language) {
          return refusal(
            "Nothing was created: language is required with translationOf.",
          );
        }
        // Creates the Article and joins the group in one operation; the copy
        // of the source Draft it starts from is replaced by the save below.
        const translation = await createArticleTranslation(
          database,
          input.translationOf,
          { language: input.language },
        );
        if (!translation.ok) return translationRefusal(translation);
        created = translation.article;
      }
      const manualSlug = input.slug?.trim() ? input.slug : null;
      const result = await updateArticleDraft(database, created.id, {
        version: created.draft.version,
        title: input.title,
        slug: manualSlug ?? deriveSlugFromTitle(input.title),
        slugIsManual: manualSlug !== null,
        summary: input.summary ?? null,
        tags: input.tags ?? [],
        byline: input.byline ?? null,
        language: input.language ?? null,
        channelSlug: input.channel ?? null,
        cover: input.cover ?? null,
        document: converted.document,
      });
      if (!result.ok) {
        // Purging needs the Administrator's confirmation phrase, so a refused
        // create only moves its unsaved Article to Trash, outside any group.
        if (input.translationOf !== undefined) {
          await unlinkArticleTranslation(database, created.id).catch(
            () => undefined,
          );
        }
        await trashArticle(database, created.id).catch(() => undefined);
        const refused = draftSaveRefusal(result);
        refused.content.push({
          type: "text",
          text: "The unsaved Article created for this request was moved to Trash.",
        });
        return refused;
      }
      return json(
        await articleView(context, result.article, { includeBody: false }),
      );
    },
  );

  server.registerTool(
    "update_draft",
    {
      title: "Update Draft",
      description:
        "Save changes to an Article's Draft against an exact Draft Version. Only the fields you pass change; anything omitted, including the cover, stays as it is. The public version changes only through publish_article.",
      inputSchema: {
        articleId,
        draftVersion,
        title: z.string().trim().min(1).max(300).optional(),
        markdown: markdown.optional(),
        slug: z
          .string()
          .nullable()
          .optional()
          .describe(
            "A string pins the slug; null makes it follow the title again.",
          ),
        summary: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
        language,
        channel: z.string().nullable().optional(),
        byline: byline.optional(),
        cover: cover.optional(),
      },
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      const article = await readArticle(database, input.articleId);
      if (!article)
        return refusal("No Article with that id exists (it may be in Trash).");
      const draft = article.draft;
      if (draft.version !== input.draftVersion) {
        return refusal(
          `The Draft is at version ${draft.version}, not ${input.draftVersion}. Call get_article and apply your change to the current Draft.`,
        );
      }

      let document = draft.document;
      if (input.markdown !== undefined) {
        const converted = markdownToArticleDocument(input.markdown);
        if (!converted.ok) return markdownRefusal(converted.issues);
        document = converted.document;
      }

      const title = input.title ?? draft.title;
      let slug = draft.slug;
      let slugIsManual = draft.slugIsManual;
      if (input.slug !== undefined) {
        slugIsManual = input.slug !== null && input.slug.trim().length > 0;
        slug = slugIsManual ? input.slug : deriveSlugFromTitle(title);
      } else if (!slugIsManual) {
        slug = deriveSlugFromTitle(title);
      }

      const result = await updateArticleDraft(database, article.id, {
        version: draft.version,
        title,
        slug,
        slugIsManual,
        summary: input.summary === undefined ? draft.summary : input.summary,
        tags: input.tags ?? draft.tags,
        byline: input.byline === undefined ? draft.byline : input.byline,
        language:
          input.language === undefined ? draft.language : input.language,
        channelSlug:
          input.channel === undefined ? draft.channelSlug : input.channel,
        cover: input.cover === undefined ? draft.cover : input.cover,
        document,
      });
      if (!result.ok) return draftSaveRefusal(result);
      return json(
        await articleView(context, result.article, { includeBody: false }),
      );
    },
  );

  server.registerTool(
    "link_translation",
    {
      title: "Link Translation",
      description:
        "Join an existing Article that is in no Translation Group into another Article's group (creating the group if that Article has none). Use this for Articles created without translationOf. Membership is not part of the Draft: it changes public responses immediately for members with a Current Publication. To move an Article from one group to another, call unlink_translation on it first.",
      inputSchema: {
        articleId: articleId.describe(
          "An Article whose Translation Group the other one joins.",
        ),
        translationArticleId: z
          .string()
          .uuid()
          .describe("The ungrouped Article that joins articleId's group."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      const result = await linkArticleTranslation(
        database,
        input.articleId,
        input.translationArticleId,
      );
      if (!result.ok) return linkRefusal(result);
      const article = await readArticle(database, input.articleId);
      if (!article)
        return refusal("No Article with that id exists (it may be in Trash).");
      return json(await articleView(context, article, { includeBody: false }));
    },
  );

  server.registerTool(
    "unlink_translation",
    {
      title: "Unlink Translation",
      description:
        "Remove an Article from its Translation Group; it keeps its Draft, Publications, and slug. A group left with one member is dissolved. Takes effect on public responses immediately. Unlinking an Article that is in no group does nothing.",
      inputSchema: { articleId },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ articleId: id }) => {
      const result = await unlinkArticleTranslation(database, id);
      if (!result.ok)
        return refusal("No Article with that id exists (it may be in Trash).");
      const article = await readArticle(database, id);
      if (!article)
        return refusal("No Article with that id exists (it may be in Trash).");
      return json(await articleView(context, article, { includeBody: false }));
    },
  );

  server.registerTool(
    "preview_article",
    {
      title: "Preview Article",
      description:
        "Rehearse publishing an exact Draft Version without changing anything. Returns the Publication Issues that would block publish_article, or the metadata the Publication would carry (resolved slug, language, and byline).",
      inputSchema: { articleId, draftVersion },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      const outcome = await workflow().preview({
        articleId: input.articleId,
        draftVersion: input.draftVersion,
      });
      if (!outcome.ok) return workflowRefusal(outcome);
      return json({
        ready: true,
        draftVersion: outcome.value.draftVersion,
        metadata: outcome.value.metadata,
      });
    },
  );

  server.registerTool(
    "publish_article",
    {
      title: "Publish Article",
      description:
        "Publish an exact saved Draft Version, making it the Article's public Current Publication. This is visible to readers and API consumers immediately. Pass the currentPublicationId you read with get_article (null if never published); if either value is stale, nothing changes. Confirm with the user before calling.",
      inputSchema: {
        articleId,
        draftVersion,
        expectedCurrentPublicationId: z
          .string()
          .nullable()
          .describe(
            "The currentPublicationId from get_article; null for an Article that has never been published.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      const outcome = await workflow().publish({
        articleId: input.articleId,
        draftVersion: input.draftVersion,
        expectedCurrentPublicationId: input.expectedCurrentPublicationId,
      });
      if (!outcome.ok) return workflowRefusal(outcome);
      const receipt = outcome.value;
      return json({
        publicationId: receipt.publicationId,
        draftVersion: receipt.draftVersion,
        slug: receipt.article.slug,
        title: receipt.article.title,
        language: receipt.article.language,
        channel: receipt.article.channel,
        publicApiUrl: `${context.applicationOrigin}/api/articles/${encodeURIComponent(receipt.article.slug)}`,
      });
    },
  );
}
