import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { load } from "js-yaml";

const PULL_REQUEST_WORKFLOW = ".github/workflows/pull-request.yml";
const PRODUCTION_WORKFLOW = ".github/workflows/deploy-production.yml";
const WRANGLER_CONFIGURATION = "wrangler.jsonc";

function readJsonc(path) {
  const source = readFileSync(path, "utf8");
  return JSON.parse(source.replace(/,\s*([}\]])/gu, "$1"));
}

function packageScripts() {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.ok(
    packageJson.scripts && typeof packageJson.scripts === "object",
    "package.json must define scripts",
  );
  return packageJson.scripts;
}

function readWorkflow(path) {
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    assert.fail(`Missing release workflow: ${path}`);
  }

  const workflow = load(source);
  assert.ok(
    workflow && typeof workflow === "object" && !Array.isArray(workflow),
    `${path} must contain a workflow object`,
  );
  return { source, workflow };
}

function workflowTrigger(workflow, path) {
  const trigger = workflow.on;
  assert.ok(
    trigger && typeof trigger === "object" && !Array.isArray(trigger),
    `${path} must define mapped workflow triggers`,
  );
  return trigger;
}

function onlyJob(workflow, path) {
  const jobs = workflow.jobs;
  assert.ok(
    jobs && typeof jobs === "object" && !Array.isArray(jobs),
    `${path} must define jobs`,
  );
  const entries = Object.entries(jobs);
  assert.equal(entries.length, 1, `${path} must define one auditable job`);
  return entries[0][1];
}

function runCommands(job, path) {
  assert.ok(Array.isArray(job.steps), `${path} job must define steps`);
  return job.steps
    .map((step) => step.run)
    .filter((run) => typeof run === "string");
}

function stepWithCommand(job, command, path) {
  const step = job.steps.find((candidate) => candidate.run === command);
  assert.ok(step, `${path} must run ${command}`);
  return step;
}

function validatePullRequestWorkflow() {
  const { source, workflow } = readWorkflow(PULL_REQUEST_WORKFLOW);
  assert.deepEqual(
    Object.keys(workflowTrigger(workflow, PULL_REQUEST_WORKFLOW)),
    ["pull_request"],
    "Pull-request checks must only run for pull requests",
  );
  assert.deepEqual(workflow.permissions, { contents: "read" });

  const job = onlyJob(workflow, PULL_REQUEST_WORKFLOW);
  const commands = runCommands(job, PULL_REQUEST_WORKFLOW);
  for (const command of [
    "pnpm format",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm test",
    "pnpm build",
  ]) {
    assert.ok(commands.includes(command), `Pull requests must run ${command}`);
  }

  for (const productionCapability of [
    "secrets.",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "--remote",
    "wrangler deploy",
  ]) {
    assert.ok(
      !source.includes(productionCapability),
      `Pull-request checks must not receive production capability: ${productionCapability}`,
    );
  }
}

function validateProductionWorkflow() {
  const { source, workflow } = readWorkflow(PRODUCTION_WORKFLOW);
  assert.deepEqual(
    workflowTrigger(workflow, PRODUCTION_WORKFLOW),
    { push: { branches: ["main"] } },
    "Production releases must only be triggered by pushes to protected main",
  );
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(workflow.concurrency, {
    group: "production-release",
    "cancel-in-progress": false,
  });

  const job = onlyJob(workflow, PRODUCTION_WORKFLOW);
  assert.equal(job.environment?.name, "production");
  assert.equal(job.environment?.url, "${{ vars.PRODUCTION_ORIGIN }}");
  assert.equal(
    job.env,
    undefined,
    "Credentials must be scoped to mutating steps",
  );

  const commands = runCommands(job, PRODUCTION_WORKFLOW);
  const buildIndex = commands.indexOf("pnpm build:production");
  const migrationIndex = commands.indexOf("pnpm db:migrate:production");
  const deployIndex = commands.indexOf("pnpm deploy:worker");
  const smokeIndex = commands.indexOf("pnpm smoke:production");
  assert.ok(buildIndex >= 0, "Production releases must build before mutation");
  assert.ok(
    buildIndex < migrationIndex &&
      migrationIndex < deployIndex &&
      deployIndex < smokeIndex,
    "Production steps must run build, migration, deploy, then smoke in order",
  );

  const credentialEnvironment = {
    CLOUDFLARE_API_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}",
    CLOUDFLARE_ACCOUNT_ID: "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
  };
  const migrationStep = stepWithCommand(
    job,
    "pnpm db:migrate:production",
    PRODUCTION_WORKFLOW,
  );
  const deployStep = stepWithCommand(
    job,
    "pnpm deploy:worker",
    PRODUCTION_WORKFLOW,
  );
  assert.deepEqual(migrationStep.env, credentialEnvironment);
  assert.deepEqual(deployStep.env, credentialEnvironment);
  assert.notEqual(migrationStep["continue-on-error"], true);
  assert.notEqual(deployStep["continue-on-error"], true);

  const smokeStep = stepWithCommand(
    job,
    "pnpm smoke:production",
    PRODUCTION_WORKFLOW,
  );
  assert.deepEqual(smokeStep.env, {
    PRODUCTION_ORIGIN: "${{ vars.PRODUCTION_ORIGIN }}",
  });
  assert.notEqual(smokeStep["continue-on-error"], true);

  for (const forbiddenMigrationMechanism of [
    "drizzle-kit push",
    "db:push",
    "d1 execute",
    "schema push",
  ]) {
    assert.ok(
      !source.includes(forbiddenMigrationMechanism),
      `Production must not use ${forbiddenMigrationMechanism}`,
    );
  }

  const scripts = packageScripts();
  assert.equal(
    scripts["build:production"],
    "CLOUDFLARE_ENV=production vite build && node scripts/verify-client-boundary.mjs",
  );
  assert.equal(
    scripts["db:migrate:production"],
    "wrangler d1 migrations apply DB --env production --remote",
    "Wrangler must apply committed production migrations and own its ledger",
  );
  assert.equal(scripts["deploy:worker"], "wrangler deploy --env production");
  assert.equal(
    scripts["smoke:production"],
    "node scripts/smoke-production.mjs",
  );
  assert.equal(
    scripts["db:migrate:deploy"],
    "wrangler d1 migrations apply DB --remote",
  );
  assert.equal(
    scripts.deploy,
    "pnpm db:migrate:deploy && wrangler deploy",
    "The public template deploy command must migrate its D1 binding before deployment",
  );
}

function validatePublicDeployTemplate() {
  const scripts = packageScripts();
  assert.equal(scripts.dev, "CLOUDFLARE_ENV=local vite dev");
  assert.equal(
    scripts.build,
    "vite build && node scripts/verify-client-boundary.mjs",
  );

  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.deepEqual(Object.keys(packageJson.cloudflare?.bindings ?? {}).sort(), [
    "BETTER_AUTH_SECRET",
    "DB",
    "MEDIA_BUCKET",
    "SETUP_SECRET",
  ]);

  const wrangler = readJsonc(WRANGLER_CONFIGURATION);
  assert.equal(wrangler.workers_dev, true);
  assert.deepEqual(wrangler.vars, { APP_ENV: "production" });
  assert.equal(wrangler.d1_databases?.[0]?.binding, "DB");
  assert.equal(wrangler.d1_databases?.[0]?.database_name, "briefly");
  assert.equal(wrangler.r2_buckets?.[0]?.binding, "MEDIA_BUCKET");
  assert.equal(wrangler.r2_buckets?.[0]?.bucket_name, "briefly-media");
  assert.deepEqual(wrangler.env?.local?.vars, {
    APP_ENV: "local",
    APP_ORIGIN: "http://localhost:3000",
  });

  const secretTemplate = readFileSync(".dev.vars.example", "utf8");
  assert.match(secretTemplate, /^BETTER_AUTH_SECRET=/mu);
  assert.match(secretTemplate, /^SETUP_SECRET=/mu);
  assert.doesNotMatch(secretTemplate, /^APP_ORIGIN=/mu);

  const readme = readFileSync("README.md", "utf8");
  assert.ok(
    readme.includes(
      "[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/MondaYJStudio/Briefly)",
    ),
    "README must expose the public Deploy to Cloudflare button",
  );
  const chineseReadme = readFileSync("README.zh-CN.md", "utf8");
  assert.ok(
    chineseReadme.includes(
      "[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/MondaYJStudio/Briefly)",
    ),
    "Chinese README must expose the public Deploy to Cloudflare button",
  );
}

validatePullRequestWorkflow();
validateProductionWorkflow();
validatePublicDeployTemplate();
console.log("Release workflow definitions are valid.");
