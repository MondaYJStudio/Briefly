import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      BETTER_AUTH_SECRET: string;
      MIGRATION_DB: D1Database;
      SETUP_SECRET: string;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
