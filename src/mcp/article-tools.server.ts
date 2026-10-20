import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  articleDocumentToMarkdown,
  markdownToArticleDocument,
  type MarkdownIssue,
} from "../articles/article-markdown";
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
  const [projected] = await projectAdminArticles(context.bindings.DB, [
    article,
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
    updatedAt: draft.updatedAt,
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
const byline = z
  .object({
    name: z.string().min(1),
    url: z.string().url().nullable(),
  })
  .nullable()
  .describe("Public authorship. null uses the Site Settings default byline.");

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
        "Read one Article's Draft: metadata, Markdown body, Draft Version, and Current Publication id. Read this before update_draft, preview_article, or publish_article.",
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
        "Create a new Article with a private Draft. Nothing becomes public until publish_article. Without a slug, the slug follows the title as it does in the editor.",
      inputSchema: {
        title: z.string().trim().min(1).max(300),
        markdown,
        slug: z
          .string()
          .optional()
          .describe(
            "Canonical public slug, e.g. check-backlinks. Unicode is allowed; slashes, ?, #, % and backslashes are not.",
          ),
        summary: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
        language: z
          .string()
          .nullable()
          .optional()
          .describe(
            "BCP 47 tag such as en or zh-Hans. null uses the Site Settings default.",
          ),
        channel: z
          .string()
          .nullable()
          .optional()
          .describe("Channel slug from list_channels, or null for none."),
        byline: byline.optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (input) => {
      const converted = markdownToArticleDocument(input.markdown);
      if (!converted.ok) return markdownRefusal(converted.issues);

      const created = await createArticle(database);
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
        cover: null,
        document: converted.document,
      });
      if (!result.ok) {
        // Purging needs the Administrator's confirmation phrase, so a refused
        // create only moves its empty Article to Trash.
        await trashArticle(database, created.id).catch(() => undefined);
        const refused = draftSaveRefusal(result);
        refused.content.push({
          type: "text",
          text: "The empty Article created for this request was moved to Trash.",
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
        "Save changes to an Article's Draft against an exact Draft Version. Only the fields you pass change; the cover and anything omitted stay as they are. The public version changes only through publish_article.",
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
        language: z.string().nullable().optional(),
        channel: z.string().nullable().optional(),
        byline: byline.optional(),
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
        cover: draft.cover,
        document,
      });
      if (!result.ok) return draftSaveRefusal(result);
      return json(
        await articleView(context, result.article, { includeBody: false }),
      );
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
