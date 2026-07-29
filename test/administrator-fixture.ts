import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect } from "vitest";

export const administrator = {
  email: "administrator@example.com",
  password: "correct horse battery staple",
};

export async function initializeAndSignIn(): Promise<string> {
  const initialization = await SELF.fetch(
    "http://briefly.test/api/initialize",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        setupSecret: env.SETUP_SECRET,
        ...administrator,
      }),
    },
  );
  expect(initialization.status).toBe(201);

  const signIn = await SELF.fetch(
    "http://briefly.test/api/auth/sign-in/email",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://briefly.test",
      },
      body: JSON.stringify(administrator),
    },
  );
  expect(signIn.status).toBe(200);
  const setCookie = signIn.headers.get("set-cookie");
  if (!setCookie) throw new Error("Expected a session cookie");
  return setCookie.split(";", 1)[0];
}
