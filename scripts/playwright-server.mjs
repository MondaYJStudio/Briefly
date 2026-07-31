import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const statePath = path.join(projectRoot, ".output/playwright/state");
const wrangler = path.join(projectRoot, "node_modules/.bin/wrangler");

rmSync(statePath, { force: true, recursive: true });
mkdirSync(path.dirname(statePath), { recursive: true });

const migration = spawnSync(
  wrangler,
  [
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--persist-to",
    statePath,
    "--config",
    "playwright/wrangler.jsonc",
  ],
  {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: path.join(
        projectRoot,
        ".output/playwright/wrangler.log",
      ),
      WRANGLER_SEND_METRICS: "false",
    },
  },
);

if (migration.status !== 0) {
  process.stderr.write(migration.stdout ?? "");
  process.stderr.write(migration.stderr ?? "");
  process.exit(migration.status ?? 1);
}

const server = await createServer({ mode: "playwright" });
await server.listen();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
}
