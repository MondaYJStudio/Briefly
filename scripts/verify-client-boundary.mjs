import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const clientOutput = path.resolve("dist/client");
const forbiddenMarkers = [
  "cloudflare:workers",
  "D1Database",
  "R2Bucket",
  "MEDIA_BUCKET",
  "runtime_metadata",
  "RUNTIME_CONFIGURATION_INVALID",
  "BETTER_AUTH_SECRET",
];

// SETUP_SECRET and RECOVERY_SECRET are intentionally shown as field labels.
// Their values remain server bindings and must never be injected into the client.

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(entryPath) : [entryPath];
    }),
  );
  return files.flat();
}

const leaks = [];
for (const file of await filesBelow(clientOutput)) {
  const contents = await readFile(file, "utf8");
  for (const marker of forbiddenMarkers) {
    if (contents.includes(marker)) {
      leaks.push(`${path.relative(clientOutput, file)} contains ${marker}`);
    }
  }
}

if (leaks.length > 0) {
  throw new Error(
    `Server-only values entered the client bundle:\n${leaks.join("\n")}`,
  );
}

console.log(
  "Verified that server-only bindings and secrets are absent from the client bundle.",
);
