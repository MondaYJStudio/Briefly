import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";
import { mcp } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { drizzle } from "drizzle-orm/d1";

import { betterAuthSchema } from "../db/schema";
import type { RuntimeBindings } from "../env/runtime.server";
import {
  MCP_ACCESS_TOKEN_LIFETIME_SECONDS,
  MCP_CONSENT_PAGE,
  MCP_ENDPOINT_PATH,
  MCP_LOGIN_PAGE,
  MCP_REFRESH_TOKEN_LIFETIME_SECONDS,
  PASSWORD_MAXIMUM_LENGTH,
  PASSWORD_MINIMUM_LENGTH,
  SESSION_LIFETIME_SECONDS,
  SESSION_RENEWAL_AGE_SECONDS,
} from "./policy";

export function createAuth(
  bindings: RuntimeBindings,
  applicationOrigin: string,
) {
  const database = drizzle(bindings.DB, { schema: betterAuthSchema });

  return betterAuth({
    appName: "Briefly",
    baseURL: applicationOrigin,
    basePath: "/api/auth",
    secret: bindings.BETTER_AUTH_SECRET,
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema: betterAuthSchema,
      transaction: false,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      autoSignIn: false,
      minPasswordLength: PASSWORD_MINIMUM_LENGTH,
      maxPasswordLength: PASSWORD_MAXIMUM_LENGTH,
    },
    session: {
      expiresIn: SESSION_LIFETIME_SECONDS,
      updateAge: SESSION_RENEWAL_AGE_SECONDS,
    },
    advanced: {
      useSecureCookies: bindings.APP_ENV === "production",
      cookiePrefix: "briefly",
    },
    trustedOrigins: [applicationOrigin],
    rateLimit: { enabled: false },
    logger: { disabled: true },
    plugins: [
      tanstackStartCookies(),
      // MCP clients authorize through OAuth 2.1. The consent page is
      // mandatory: the Worker forces `prompt=consent` on every authorization
      // request before it reaches this plugin.
      mcp({
        loginPage: MCP_LOGIN_PAGE,
        resource: `${applicationOrigin}${MCP_ENDPOINT_PATH}`,
        oidcConfig: {
          loginPage: MCP_LOGIN_PAGE,
          consentPage: MCP_CONSENT_PAGE,
          requirePKCE: true,
          allowPlainCodeChallengeMethod: false,
          accessTokenExpiresIn: MCP_ACCESS_TOKEN_LIFETIME_SECONDS,
          refreshTokenExpiresIn: MCP_REFRESH_TOKEN_LIFETIME_SECONDS,
        },
      }),
    ],
  });
}
