import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  const isPlaywright = mode === "playwright";

  return {
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
      tailwindcss(),
      tanstackStart(),
      react(),
    ],
  };
});
