import { describe, expect, it } from "vitest";

import { cloudflareWorkerSettingsHref } from "../src/auth/authentication-presentation";

describe("authentication deployment presentation", () => {
  it("links production authentication fields to the deployed Worker settings", () => {
    expect(
      cloudflareWorkerSettingsHref({
        appEnvironment: "production",
        workerName: "my briefly worker",
      }),
    ).toBe(
      "https://dash.cloudflare.com/?to=%2F%3Aaccount%2Fworkers%2Fservices%2Fview%2Fmy%20briefly%20worker%2Fproduction%2Fsettings",
    );
  });

  it.each(["local", "test"] as const)(
    "does not show a Cloudflare link in %s",
    (appEnvironment) => {
      expect(
        cloudflareWorkerSettingsHref({
          appEnvironment,
          workerName: "briefly",
        }),
      ).toBeUndefined();
    },
  );
});
