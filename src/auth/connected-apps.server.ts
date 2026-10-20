import type { ConnectedApp, OAuthClientSummary } from "./connected-apps";

/**
 * Connected Apps: MCP clients the Administrator has authorized.
 *
 * Better Auth's `mcp` plugin owns the client, token, and consent rows. Admin
 * only reads them, shows the consent page what it is about to authorize, and
 * deletes a client with everything it holds when the Administrator
 * disconnects it.
 */

/** Registrations nobody ever authorized are dropped after this long. */
const UNUSED_REGISTRATION_LIFETIME_MILLISECONDS = 24 * 60 * 60 * 1000;

function redirectHosts(redirectUrls: string): string[] {
  const hosts = new Set<string>();
  for (const value of redirectUrls.split(",")) {
    try {
      const url = new URL(value.trim());
      hosts.add(url.host || `${url.protocol}//`);
    } catch {
      hosts.add(value.trim());
    }
  }
  return [...hosts].filter((host) => host.length > 0);
}

function clientName(name: string | null, clientId: string): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : clientId;
}

export async function readOAuthClient(
  database: D1Database,
  clientId: string,
): Promise<OAuthClientSummary | null> {
  const row = await database
    .prepare(
      `SELECT client_id AS clientId, name, redirect_urls AS redirectUrls
       FROM auth_oauth_application
       WHERE client_id = ? AND (disabled IS NULL OR disabled = 0)
       LIMIT 1`,
    )
    .bind(clientId)
    .first<{ clientId: string; name: string | null; redirectUrls: string }>();
  if (!row) return null;
  return {
    clientId: row.clientId,
    name: clientName(row.name, row.clientId),
    redirectHosts: redirectHosts(row.redirectUrls),
  };
}

export async function listConnectedApps(
  database: D1Database,
): Promise<ConnectedApp[]> {
  await database
    .prepare(
      `DELETE FROM auth_oauth_application
       WHERE created_at < ?
         AND client_id NOT IN (SELECT client_id FROM auth_oauth_access_token)
         AND client_id NOT IN (SELECT client_id FROM auth_oauth_consent)`,
    )
    .bind(Date.now() - UNUSED_REGISTRATION_LIFETIME_MILLISECONDS)
    .run();

  const { results } = await database
    .prepare(
      `SELECT application.client_id AS clientId,
              application.name AS name,
              application.redirect_urls AS redirectUrls,
              MIN(token.created_at) AS connectedAt,
              MAX(token.updated_at) AS lastAuthorizedAt
       FROM auth_oauth_application AS application
       JOIN auth_oauth_access_token AS token
         ON token.client_id = application.client_id
       GROUP BY application.client_id
       ORDER BY lastAuthorizedAt DESC, application.client_id ASC`,
    )
    .all<{
      clientId: string;
      name: string | null;
      redirectUrls: string;
      connectedAt: number;
      lastAuthorizedAt: number;
    }>();
  return results.map((row) => ({
    clientId: row.clientId,
    name: clientName(row.name, row.clientId),
    redirectHosts: redirectHosts(row.redirectUrls),
    connectedAt: new Date(row.connectedAt).toISOString(),
    lastAuthorizedAt: new Date(row.lastAuthorizedAt).toISOString(),
  }));
}

/** Revokes every token the client holds and forgets the client. */
export async function disconnectConnectedApp(
  database: D1Database,
  clientId: string,
): Promise<boolean> {
  const results = await database.batch([
    database
      .prepare("DELETE FROM auth_oauth_access_token WHERE client_id = ?")
      .bind(clientId),
    database
      .prepare("DELETE FROM auth_oauth_consent WHERE client_id = ?")
      .bind(clientId),
    database
      .prepare("DELETE FROM auth_oauth_application WHERE client_id = ?")
      .bind(clientId),
  ]);
  return (results[2]?.meta.changes ?? 0) > 0;
}
