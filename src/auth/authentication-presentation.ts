export type AuthenticationAppEnvironment = "local" | "test" | "production";

export function cloudflareWorkerSettingsHref({
  appEnvironment,
  workerName,
}: Readonly<{
  appEnvironment: AuthenticationAppEnvironment;
  workerName: string;
}>): string | undefined {
  if (appEnvironment !== "production" || workerName.length === 0) {
    return undefined;
  }

  const destination = `/:account/workers/services/view/${workerName}/production/settings`;
  return `https://dash.cloudflare.com/?to=${encodeURIComponent(destination)}`;
}
