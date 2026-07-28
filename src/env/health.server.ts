import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { runtimeMetadata } from "../db/schema";
import type { RuntimeBindings } from "./runtime.server";

export const APPLICATION_SCHEMA_VERSION = 1;
const HEALTH_PROBE_OBJECT_KEY = "__briefly_health_probe__";

type HealthResult =
  | {
      ok: true;
      schemaVersion: number;
    }
  | {
      ok: false;
      code: "SCHEMA_INCOMPATIBLE";
      actualSchemaVersion: number | null;
    }
  | {
      ok: false;
      code: "STORAGE_UNAVAILABLE";
      storage: "d1" | "r2";
    };

export async function checkRuntimeHealth(
  bindings: RuntimeBindings,
): Promise<HealthResult> {
  let actualSchemaVersion: number | null = null;

  try {
    await bindings.DB.prepare("SELECT 1 AS ready").first();
  } catch {
    return { ok: false, code: "STORAGE_UNAVAILABLE", storage: "d1" };
  }

  try {
    const database = drizzle(bindings.DB);
    const [metadata] = await database
      .select({ schemaVersion: runtimeMetadata.schemaVersion })
      .from(runtimeMetadata)
      .where(eq(runtimeMetadata.id, 1))
      .limit(1);
    actualSchemaVersion = metadata?.schemaVersion ?? null;
  } catch {
    return {
      ok: false,
      code: "SCHEMA_INCOMPATIBLE",
      actualSchemaVersion: null,
    };
  }

  if (actualSchemaVersion !== APPLICATION_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "SCHEMA_INCOMPATIBLE",
      actualSchemaVersion,
    };
  }

  try {
    await bindings.MEDIA_BUCKET.head(HEALTH_PROBE_OBJECT_KEY);
  } catch {
    return { ok: false, code: "STORAGE_UNAVAILABLE", storage: "r2" };
  }

  return { ok: true, schemaVersion: actualSchemaVersion };
}
