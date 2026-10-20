import { z } from "zod";

import { articleSlugSchema } from "../articles/article-slug";
import {
  CHANNEL_NAME_MAXIMUM_LENGTH,
  CHANNEL_SLUG_MAXIMUM_LENGTH,
  type Channel,
} from "./channels";

export type { Channel } from "./channels";
export {
  CHANNEL_NAME_MAXIMUM_LENGTH,
  CHANNEL_SLUG_MAXIMUM_LENGTH,
} from "./channels";

export const channelSlugSchema = articleSlugSchema.pipe(
  z.string().max(CHANNEL_SLUG_MAXIMUM_LENGTH),
);

export const channelNameSchema = z
  .string()
  .transform((value) => value.normalize("NFC").trim())
  .pipe(
    z
      .string()
      .min(1, { message: "Enter a Channel name." })
      .max(CHANNEL_NAME_MAXIMUM_LENGTH),
  );

const channelCreateInput = z
  .object({
    slug: channelSlugSchema,
    name: channelNameSchema,
  })
  .strict();

const channelUpdateInput = z
  .object({
    name: channelNameSchema,
  })
  .strict();

function validationIssues(
  error: z.ZodError,
): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

const persistedChannel = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1),
  name: z.string().min(1),
  created_at: z.number().int(),
  updated_at: z.number().int(),
});

type ChannelRow = z.input<typeof persistedChannel>;

function channelFromRow(row: ChannelRow): Channel {
  const parsed = persistedChannel.parse(row);
  return {
    id: parsed.id,
    slug: parsed.slug,
    name: parsed.name,
    createdAt: new Date(parsed.created_at).toISOString(),
    updatedAt: new Date(parsed.updated_at).toISOString(),
  };
}

export type CreateChannelResult =
  | { ok: true; channel: Channel }
  | {
      ok: false;
      reason: "invalid";
      issues: Array<{ path: string; message: string }>;
    }
  | { ok: false; reason: "slug-conflict" };

export type UpdateChannelResult =
  | { ok: true; channel: Channel }
  | {
      ok: false;
      reason: "invalid";
      issues: Array<{ path: string; message: string }>;
    }
  | { ok: false; reason: "not-found" };

export type DeleteChannelResult =
  | { ok: true }
  | { ok: false; reason: "not-found" }
  | {
      ok: false;
      reason: "referenced";
      references: { draftCount: number; currentPublicationCount: number };
    };

export async function listChannels(database: D1Database): Promise<Channel[]> {
  const { results } = await database
    .prepare(
      `SELECT id, slug, name, created_at, updated_at
       FROM channel
       ORDER BY name COLLATE NOCASE ASC, slug ASC`,
    )
    .all<ChannelRow>();
  return results.map(channelFromRow);
}

export async function readChannelBySlug(
  database: D1Database,
  slug: string,
): Promise<Channel | null> {
  const row = await database
    .prepare(
      `SELECT id, slug, name, created_at, updated_at
       FROM channel
       WHERE slug = ?
       LIMIT 1`,
    )
    .bind(slug)
    .first<ChannelRow>();
  return row ? channelFromRow(row) : null;
}

export async function createChannel(
  database: D1Database,
  input: unknown,
): Promise<CreateChannelResult> {
  const parsed = channelCreateInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid",
      issues: validationIssues(parsed.error),
    };
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await database
      .prepare(
        `INSERT INTO channel (id, slug, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(id, parsed.data.slug, parsed.data.name, now, now)
      .run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { ok: false, reason: "slug-conflict" };
    }
    throw error;
  }

  const created = await readChannelById(database, id);
  if (!created) throw new Error("Created Channel could not be read");
  return { ok: true, channel: created };
}

export async function updateChannelName(
  database: D1Database,
  channelId: string,
  input: unknown,
): Promise<UpdateChannelResult> {
  const parsed = channelUpdateInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid",
      issues: validationIssues(parsed.error),
    };
  }

  const now = Date.now();
  const updated = await database
    .prepare(
      `UPDATE channel
       SET name = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(parsed.data.name, now, channelId)
    .run();
  if (updated.meta.changes !== 1) return { ok: false, reason: "not-found" };

  const channel = await readChannelById(database, channelId);
  if (!channel) return { ok: false, reason: "not-found" };
  return { ok: true, channel };
}

export async function deleteChannel(
  database: D1Database,
  channelId: string,
): Promise<DeleteChannelResult> {
  const channel = await readChannelById(database, channelId);
  if (!channel) return { ok: false, reason: "not-found" };

  const references = await channelReferenceCounts(database, channel.slug);
  if (references.draftCount > 0 || references.currentPublicationCount > 0) {
    return { ok: false, reason: "referenced", references };
  }

  const deleted = await database
    .prepare(`DELETE FROM channel WHERE id = ?`)
    .bind(channelId)
    .run();
  if (deleted.meta.changes !== 1) return { ok: false, reason: "not-found" };
  return { ok: true };
}

async function readChannelById(
  database: D1Database,
  channelId: string,
): Promise<Channel | null> {
  const row = await database
    .prepare(
      `SELECT id, slug, name, created_at, updated_at
       FROM channel
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(channelId)
    .first<ChannelRow>();
  return row ? channelFromRow(row) : null;
}

async function channelReferenceCounts(
  database: D1Database,
  slug: string,
): Promise<{ draftCount: number; currentPublicationCount: number }> {
  const draftRow = await database
    .prepare(
      `SELECT COUNT(*) AS count
       FROM article_draft
       WHERE article_draft.channel_slug = ?`,
    )
    .bind(slug)
    .first<{ count: number }>();
  const publicationRow = await database
    .prepare(
      `SELECT COUNT(*) AS count
       FROM article
       JOIN publication ON publication.id = article.current_publication_id
                       AND publication.article_id = article.id
       WHERE publication.channel_slug = ?
         AND article.trashed_at IS NULL`,
    )
    .bind(slug)
    .first<{ count: number }>();
  return {
    draftCount: draftRow?.count ?? 0,
    currentPublicationCount: publicationRow?.count ?? 0,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error && /UNIQUE constraint failed/iu.test(error.message)
  );
}
