import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  out: "./src/db/migrations",
  schema: "./src/db/schema/index.ts",
});
