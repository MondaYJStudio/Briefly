import path from "node:path";

import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    path.join(import.meta.dirname, "src/db/migrations"),
  );

  return {
    plugins: [
      tanstackStart(),
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            APP_ENV: "test",
            APP_ORIGIN: "http://briefly.test",
            BETTER_AUTH_SECRET:
              "test-only-better-auth-secret-32-characters-minimum",
            SETUP_SECRET: "test-only-setup-secret-32-characters-minimum",
            TEST_MIGRATIONS: migrations,
          },
          d1Databases: ["DB", "MIGRATION_DB"],
          r2Buckets: ["MEDIA_BUCKET"],
        },
      }),
    ],
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
