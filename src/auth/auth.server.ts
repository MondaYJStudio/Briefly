import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { drizzle } from "drizzle-orm/d1";

import { betterAuthSchema } from "../db/schema";
import type { RuntimeBindings } from "../env/runtime.server";
import {
  PASSWORD_MAXIMUM_LENGTH,
  PASSWORD_MINIMUM_LENGTH,
  SESSION_LIFETIME_SECONDS,
  SESSION_RENEWAL_AGE_SECONDS,
} from "./policy";

export function createAuth(bindings: RuntimeBindings) {
  const database = drizzle(bindings.DB, { schema: betterAuthSchema });

  return betterAuth({
    appName: "Briefly",
    baseURL: bindings.APP_ORIGIN,
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
    trustedOrigins: [bindings.APP_ORIGIN],
    rateLimit: { enabled: false },
    logger: { disabled: true },
    plugins: [tanstackStartCookies()],
  });
}
