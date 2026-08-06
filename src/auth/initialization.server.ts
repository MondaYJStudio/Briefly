import { z } from "zod";

import type { RuntimeBindings } from "../env/runtime.server";
import { PASSWORD_MAXIMUM_LENGTH, PASSWORD_MINIMUM_LENGTH } from "./policy";

export type InitializationResult =
  { ok: true } | { ok: false; reason: "already-initialized" | "invalid-input" };

export async function installationIsInitialized(
  database: D1Database,
): Promise<boolean> {
  const row = await database
    .prepare("SELECT 1 AS ok FROM auth_user LIMIT 1")
    .first<{ ok: number }>();
  return row !== null;
}

export async function initializeAdministrator(
  bindings: RuntimeBindings,
  credentials: { email: string; password: string },
): Promise<InitializationResult> {
  if (await installationIsInitialized(bindings.DB)) {
    return { ok: false, reason: "already-initialized" };
  }

  const email = credentials.email.toLowerCase();
  if (
    !z.email().safeParse(email).success ||
    credentials.password.length < PASSWORD_MINIMUM_LENGTH ||
    credentials.password.length > PASSWORD_MAXIMUM_LENGTH
  ) {
    return { ok: false, reason: "invalid-input" };
  }

  try {
    const { hashPassword } = await import("better-auth/crypto");
    const passwordHash = await hashPassword(credentials.password);
    const userId = crypto.randomUUID();
    const now = Date.now();

    await bindings.DB.batch([
      bindings.DB.prepare(
        `INSERT INTO auth_user
             (id, singleton, name, email, email_verified, created_at, updated_at)
           VALUES (?, 1, 'Administrator', ?, 0, ?, ?)`,
      ).bind(userId, email, now, now),
      bindings.DB.prepare(
        `INSERT INTO auth_account
             (id, account_id, provider_id, user_id, password, created_at, updated_at)
           VALUES (?, ?, 'credential', ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), userId, userId, passwordHash, now, now),
    ]);
    return { ok: true };
  } catch {
    return (await installationIsInitialized(bindings.DB))
      ? { ok: false, reason: "already-initialized" }
      : { ok: false, reason: "invalid-input" };
  }
}
