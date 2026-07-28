import { z } from "zod";

export type ApplicationEnvironment = "local" | "test" | "production";

export interface RuntimeBindings {
  APP_ENV: ApplicationEnvironment;
  APP_ORIGIN: string;
  BETTER_AUTH_SECRET: string;
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  SETUP_SECRET: string;
}

const bindingNames = [
  "APP_ENV",
  "APP_ORIGIN",
  "BETTER_AUTH_SECRET",
  "DB",
  "MEDIA_BUCKET",
  "SETUP_SECRET",
] as const;

export type RuntimeBindingName = (typeof bindingNames)[number];

export interface RuntimeConfigurationIssue {
  binding: RuntimeBindingName;
  reason: "missing" | "invalid";
}

export type RuntimeConfigurationResult =
  | { ok: true; bindings: RuntimeBindings }
  | { ok: false; issues: RuntimeConfigurationIssue[] };

function isD1Database(value: unknown): value is D1Database {
  if (typeof value !== "object" || value === null) return false;
  const database = value as Partial<D1Database>;
  return (
    typeof database.prepare === "function" &&
    typeof database.batch === "function" &&
    typeof database.exec === "function"
  );
}

function isR2Bucket(value: unknown): value is R2Bucket {
  if (typeof value !== "object" || value === null) return false;
  const bucket = value as Partial<R2Bucket>;
  return (
    typeof bucket.get === "function" &&
    typeof bucket.head === "function" &&
    typeof bucket.put === "function" &&
    typeof bucket.delete === "function"
  );
}

const runtimeBindingsSchema = z
  .object({
    APP_ENV: z.enum(["local", "test", "production"]),
    APP_ORIGIN: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    DB: z.custom<D1Database>(isD1Database),
    MEDIA_BUCKET: z.custom<R2Bucket>(isR2Bucket),
    SETUP_SECRET: z.string().min(32),
  })
  .superRefine((bindings, context) => {
    if (!URL.canParse(bindings.APP_ORIGIN)) return;

    const origin = new URL(bindings.APP_ORIGIN);
    const isCanonicalOrigin = origin.origin === bindings.APP_ORIGIN;
    const usesProductionHttps =
      bindings.APP_ENV !== "production" || origin.protocol === "https:";

    if (!isCanonicalOrigin || !usesProductionHttps) {
      context.addIssue({
        code: "custom",
        path: ["APP_ORIGIN"],
        message: "APP_ORIGIN must be a canonical origin",
      });
    }
  });

export function validateRuntimeBindings(
  value: unknown,
): RuntimeConfigurationResult {
  const parsed = runtimeBindingsSchema.safeParse(value);
  if (parsed.success) return { ok: true, bindings: parsed.data };

  const input =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const invalidBindings = new Set<RuntimeBindingName>();

  for (const issue of parsed.error.issues) {
    const binding = issue.path[0];
    if (
      typeof binding === "string" &&
      bindingNames.includes(binding as RuntimeBindingName)
    ) {
      invalidBindings.add(binding as RuntimeBindingName);
    }
  }

  return {
    ok: false,
    issues: bindingNames
      .filter((binding) => invalidBindings.has(binding))
      .map((binding) => ({
        binding,
        reason: input[binding] == null ? "missing" : "invalid",
      })),
  };
}
