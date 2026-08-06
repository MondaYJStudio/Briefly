import type { RuntimeBindings } from "../env/runtime.server";
import { PASSWORD_MAXIMUM_LENGTH, PASSWORD_MINIMUM_LENGTH } from "./policy";

interface AdministratorCredential {
  accountId: string;
  passwordHash: string;
  userId: string;
}

type PasswordChangeResult =
  | { ok: true }
  | { ok: false; reason: "authentication-required" | "invalid-input" };

function validNewPassword(password: string): boolean {
  return (
    password.length >= PASSWORD_MINIMUM_LENGTH &&
    password.length <= PASSWORD_MAXIMUM_LENGTH
  );
}

async function findAdministratorCredential(
  database: D1Database,
  requiredUserId: string | null,
): Promise<AdministratorCredential | undefined> {
  const accounts = await database
    .prepare(
      `SELECT auth_account.id AS accountId,
              auth_account.password AS passwordHash,
              auth_account.user_id AS userId
         FROM auth_account
         INNER JOIN auth_user ON auth_user.id = auth_account.user_id
         INNER JOIN installation
           ON installation.id = 1 AND installation.state = 'initialized'
        WHERE auth_user.singleton = 1
          AND auth_account.provider_id = 'credential'
          AND auth_account.password IS NOT NULL
          AND (? IS NULL OR auth_user.id = ?)`,
    )
    .bind(requiredUserId, requiredUserId)
    .all<AdministratorCredential>();

  return accounts.results.length === 1 ? accounts.results[0] : undefined;
}

async function replacePasswordAndRevokeSessions(
  bindings: RuntimeBindings,
  credential: AdministratorCredential,
  newPassword: string,
): Promise<boolean> {
  const { hashPassword } = await import("better-auth/crypto");
  const passwordHash = await hashPassword(newPassword);
  const [passwordUpdate] = await bindings.DB.batch([
    bindings.DB.prepare(
      `UPDATE auth_account
          SET password = ?, updated_at = ?
        WHERE id = ? AND user_id = ? AND password = ?`,
    ).bind(
      passwordHash,
      Date.now(),
      credential.accountId,
      credential.userId,
      credential.passwordHash,
    ),
    bindings.DB.prepare(
      `DELETE FROM auth_session
        WHERE user_id = ?
          AND EXISTS (
            SELECT 1 FROM auth_account
             WHERE id = ? AND user_id = ? AND password = ?
          )`,
    ).bind(
      credential.userId,
      credential.accountId,
      credential.userId,
      passwordHash,
    ),
  ]);

  return passwordUpdate.meta.changes === 1;
}

export async function recoverAdministrator(
  bindings: RuntimeBindings,
  newPassword: string,
): Promise<{ ok: boolean }> {
  if (!validNewPassword(newPassword)) return { ok: false };
  const credential = await findAdministratorCredential(bindings.DB, null);
  if (!credential) return { ok: false };

  return {
    ok: await replacePasswordAndRevokeSessions(
      bindings,
      credential,
      newPassword,
    ),
  };
}

export async function changeAdministratorPassword(
  bindings: RuntimeBindings,
  applicationOrigin: string,
  headers: Headers,
  passwords: { currentPassword: string; newPassword: string },
): Promise<PasswordChangeResult> {
  const { createAuth } = await import("./auth.server");
  const session = await createAuth(bindings, applicationOrigin).api.getSession({
    headers,
    query: { disableRefresh: true },
  });
  if (!session) return { ok: false, reason: "authentication-required" };
  if (!validNewPassword(passwords.newPassword)) {
    return { ok: false, reason: "invalid-input" };
  }

  const credential = await findAdministratorCredential(
    bindings.DB,
    session.user.id,
  );
  if (!credential) return { ok: false, reason: "invalid-input" };
  const { verifyPassword } = await import("better-auth/crypto");
  if (
    !(await verifyPassword({
      hash: credential.passwordHash,
      password: passwords.currentPassword,
    }))
  ) {
    return { ok: false, reason: "invalid-input" };
  }

  return (await replacePasswordAndRevokeSessions(
    bindings,
    credential,
    passwords.newPassword,
  ))
    ? { ok: true }
    : { ok: false, reason: "invalid-input" };
}
