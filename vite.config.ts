import { cloudflare } from "@cloudflare/vite-plugin";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { paraglideCompileOptions } from "./scripts/paraglide-options";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const wranglerConfig = readFileSync(
  new URL("./wrangler.jsonc", import.meta.url),
  "utf8",
);
const configuredWorkerName =
  wranglerConfig.match(/^\s*"name"\s*:\s*"([^"]+)"/m)?.[1] ?? "";

export default defineConfig(({ mode }) => {
  const isPlaywright = mode === "playwright";
  const workerName =
    process.env.WRANGLER_CI_OVERRIDE_NAME ?? configuredWorkerName;

  return {
    define: {
      "import.meta.env.BRIEFLY_WORKER_NAME": JSON.stringify(workerName),
    },
    server: {
      host: isPlaywright ? "127.0.0.1" : undefined,
      port: 3000,
      strictPort: isPlaywright,
    },
    plugins: [
      cloudflare({
        viteEnvironment: { name: "ssr" },
        ...(isPlaywright
          ? {
              configPath: "./playwright/wrangler.jsonc",
              persistState: { path: ".output/playwright/state" },
            }
          : {}),
      }),
      paraglideVitePlugin({
        project: "./project.inlang",
        outdir: "./src/paraglide",
        emitTsDeclarations: true,
        ...paraglideCompileOptions,
      }),
      tailwindcss(),
      tanstackStart(),
      react(),
    ],
  };
});
