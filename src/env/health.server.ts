import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { runtimeMetadata } from "../db/schema";
import type { RuntimeBindings } from "./runtime.server";

const HEALTH_PROBE_OBJECT_KEY = "__briefly_health_probe__";

type HealthResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      code: "SCHEMA_INCOMPATIBLE";
    }
  | {
      ok: false;
      code: "STORAGE_UNAVAILABLE";
      storage: "d1" | "r2";
    };

export async function checkRuntimeHealth(
  bindings: RuntimeBindings,
): Promise<HealthResult> {
  try {
    await bindings.DB.prepare("SELECT 1 AS ready").first();
  } catch {
    return { ok: false, code: "STORAGE_UNAVAILABLE", storage: "d1" };
  }

  try {
    const database = drizzle(bindings.DB);
    const [metadata] = await database
      .select({ id: runtimeMetadata.id })
      .from(runtimeMetadata)
      .where(eq(runtimeMetadata.id, 1))
      .limit(1);
    if (!metadata) {
      return { ok: false, code: "SCHEMA_INCOMPATIBLE" };
    }

    const authentication = await bindings.DB.prepare(
      `SELECT
         (SELECT COUNT(id) + COUNT(singleton) + COUNT(name) + COUNT(email) +
                 COUNT(email_verified) + COUNT(image) + COUNT(created_at) +
                 COUNT(updated_at)
            FROM auth_user) AS userColumns,
         (SELECT COUNT(id) + COUNT(account_id) + COUNT(provider_id) +
                 COUNT(user_id) + COUNT(access_token) + COUNT(refresh_token) +
                 COUNT(id_token) + COUNT(access_token_expires_at) +
                 COUNT(refresh_token_expires_at) + COUNT(scope) +
                 COUNT(password) + COUNT(created_at) + COUNT(updated_at)
            FROM auth_account) AS accountColumns,
         (SELECT COUNT(id) + COUNT(expires_at) + COUNT(token) +
                 COUNT(created_at) + COUNT(updated_at) + COUNT(ip_address) +
                 COUNT(user_agent) + COUNT(user_id)
            FROM auth_session) AS sessionColumns,
         (SELECT COUNT(id) + COUNT(identifier) + COUNT(value) +
                 COUNT(expires_at) + COUNT(created_at) + COUNT(updated_at)
            FROM auth_verification) AS verificationColumns,
         (SELECT COUNT(key) + COUNT(attempts) + COUNT(reset_at)
            FROM auth_rate_limit) AS rateLimitColumns,
         (SELECT COUNT(id) + COUNT(original_filename) + COUNT(mime_type) +
                 COUNT(byte_size) + COUNT(width) + COUNT(height) +
                 COUNT(uploaded_at) + COUNT(object_key) +
                 COUNT(lifecycle_state) + COUNT(failure_code) +
                 COUNT(public_asset_id)
            FROM asset) AS assetColumns,
         (SELECT COUNT(*) FROM sqlite_master
            WHERE type = 'index'
              AND name IN (
                'auth_user_singleton_unique',
                'auth_user_email_unique',
                'auth_session_token_unique',
                'asset_object_key_unique',
                'asset_public_asset_id_unique'
              )) AS requiredIndexCount,
         (SELECT COUNT(*) FROM sqlite_master
            WHERE type = 'table' AND name = 'auth_user'
              AND sql LIKE '%auth_user_singleton%') AS userConstraints,
         (SELECT COUNT(*) FROM sqlite_master
            WHERE type = 'table' AND name = 'asset'
              AND sql LIKE '%asset_byte_size_positive%'
              AND sql LIKE '%asset_width_positive%'
              AND sql LIKE '%asset_height_positive%') AS assetConstraints`,
    ).first<{
      requiredIndexCount: number;
      userConstraints: number;
      assetConstraints: number;
    }>();
    if (
      !authentication ||
      authentication.requiredIndexCount !== 5 ||
      authentication.userConstraints !== 1 ||
      authentication.assetConstraints !== 1
    ) {
      return { ok: false, code: "SCHEMA_INCOMPATIBLE" };
    }
  } catch {
    return { ok: false, code: "SCHEMA_INCOMPATIBLE" };
  }

  try {
    await bindings.MEDIA_BUCKET.head(HEALTH_PROBE_OBJECT_KEY);
  } catch {
    return { ok: false, code: "STORAGE_UNAVAILABLE", storage: "r2" };
  }

  return { ok: true };
}
