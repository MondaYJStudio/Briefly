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
