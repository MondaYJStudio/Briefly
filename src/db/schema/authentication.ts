import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const user = sqliteTable(
  "auth_user",
  {
    id: text("id").primaryKey(),
    singleton: integer("singleton").notNull().default(1).unique(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: integer("email_verified", { mode: "boolean" })
      .default(false)
      .notNull(),
    image: text("image"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [check("auth_user_singleton", sql`${table.singleton} = 1`)],
);

export const session = sqliteTable(
  "auth_session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("auth_session_user_id_idx").on(table.userId)],
);

export const account = sqliteTable(
  "auth_account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("auth_account_user_id_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "auth_verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("auth_verification_identifier_idx").on(table.identifier)],
);

export const installation = sqliteTable(
  "installation",
  {
    id: integer("id").primaryKey(),
    state: text("state", {
      enum: ["uninitialized", "initialized"],
    })
      .notNull()
      .default("uninitialized"),
    initializedAt: integer("initialized_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    check("installation_singleton", sql`${table.id} = 1`),
    check(
      "installation_valid_state",
      sql`${table.state} IN ('uninitialized', 'initialized')`,
    ),
  ],
);

export const authenticationRateLimit = sqliteTable(
  "auth_rate_limit",
  {
    key: text("key").primaryKey(),
    attempts: integer("attempts").notNull(),
    resetAt: integer("reset_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("auth_rate_limit_reset_at_idx").on(table.resetAt)],
);

export const betterAuthSchema = { user, session, account, verification };
