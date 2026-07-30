import {
  SELF,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApiClient } from "../src/api/client";
import worker from "../src/server";

const administrator = {
  email: "administrator@example.com",
  password: "correct horse battery staple",
};

async function initialize(
  credentials: { email: string; password: string } = administrator,
) {
  return SELF.fetch("http://briefly.test/api/initialize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ setupSecret: env.SETUP_SECRET, ...credentials }),
  });
}

async function signIn(
  credentials: { email: string; password: string } = administrator,
) {
  return SELF.fetch("http://briefly.test/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://briefly.test",
    },
    body: JSON.stringify(credentials),
  });
}

async function recover(
  recoverySecret: string,
  newPassword: string,
  fetcher: typeof fetch = SELF.fetch.bind(SELF) as typeof fetch,
) {
  return fetcher("http://briefly.test/api/recover", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recoverySecret, newPassword }),
  });
}

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) throw new Error("Expected a session cookie");
  return setCookie.split(";", 1)[0];
}

describe("sole Administrator authentication", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM auth_session"),
      env.DB.prepare("DELETE FROM auth_account"),
      env.DB.prepare("DELETE FROM auth_user"),
      env.DB.prepare("DELETE FROM auth_rate_limit"),
      env.DB.prepare(
        "UPDATE installation SET state = 'uninitialized', initialized_at = NULL WHERE id = 1",
      ),
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects initialization without the configured setup secret and never reveals it", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const suppliedSecret = "incorrect-setup-secret-that-must-stay-private";

    const response = await SELF.fetch("http://briefly.test/api/initialize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        setupSecret: suppliedSecret,
        ...administrator,
      }),
    });
    const responseText = await response.text();

    expect(response.status).toBe(403);
    expect(JSON.parse(responseText)).toEqual({
      status: "error",
      code: "INITIALIZATION_DENIED",
    });
    expect(responseText).not.toContain(suppliedSecret);
    expect(consoleInfo.mock.calls.flat().join(" ")).not.toContain(
      suppliedSecret,
    );
  });

  it("uses the same generic denial when recovery is disabled or the dedicated secret is wrong", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const wrongSecret = "wrong-recovery-secret-that-must-stay-private";
    const withoutRecoverySecret = { ...env, RECOVERY_SECRET: undefined };
    const context = createExecutionContext();

    const disabledResponse = await recover(
      env.SETUP_SECRET,
      "replacement password is long enough",
      (request, init) =>
        worker.fetch(
          new Request(request, init) as Request<
            unknown,
            IncomingRequestCfProperties
          >,
          withoutRecoverySecret,
          context,
        ),
    );
    await waitOnExecutionContext(context);
    const disabledText = await disabledResponse.text();
    const wrongSecretResponse = await recover(
      wrongSecret,
      "replacement password is long enough",
    );
    const wrongSecretText = await wrongSecretResponse.text();

    expect(disabledResponse.status).toBe(403);
    expect(wrongSecretResponse.status).toBe(403);
    expect(disabledText).toBe(wrongSecretText);
    expect(JSON.parse(disabledText)).toEqual({
      status: "error",
      code: "RECOVERY_DENIED",
    });
    for (const secret of [env.SETUP_SECRET, wrongSecret]) {
      expect(disabledText).not.toContain(secret);
      expect(wrongSecretText).not.toContain(secret);
      expect(consoleInfo.mock.calls.flat().join(" ")).not.toContain(secret);
    }
  });

  it("recovers the existing Administrator and revokes every issued session before success", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    expect((await initialize()).status).toBe(201);
    const originalIdentity = await env.DB.prepare(
      "SELECT id, email FROM auth_user",
    ).first<{ id: string; email: string }>();
    const cookies = [cookieFrom(await signIn()), cookieFrom(await signIn())];
    const newPassword = "a fresh password from the operator";

    const recoveryResponse = await recover(env.RECOVERY_SECRET, newPassword);

    expect(recoveryResponse.status).toBe(200);
    expect(await recoveryResponse.json()).toEqual({ status: "ok" });
    const client = createApiClient(
      "http://briefly.test",
      SELF.fetch.bind(SELF) as typeof fetch,
    );
    for (const cookie of cookies) {
      expect(
        (await client.admin.session.get({ headers: { cookie } })).status,
      ).toBe(401);
    }
    expect((await signIn()).status).toBe(401);
    expect(
      (
        await signIn({
          email: administrator.email,
          password: newPassword,
        })
      ).status,
    ).toBe(200);
    expect(
      await env.DB.prepare("SELECT id, email FROM auth_user").all(),
    ).toMatchObject({ results: [originalIdentity] });
    const logText = consoleInfo.mock.calls.flat().join(" ");
    expect(logText).not.toContain(env.RECOVERY_SECRET);
    expect(logText).not.toContain(newPassword);
  });

  it("does not let recovery initialize an installation and denies invalid account input generically", async () => {
    const emptyInstallationResponse = await recover(
      env.RECOVERY_SECRET,
      "valid replacement password",
    );
    const emptyInstallationText = await emptyInstallationResponse.text();
    expect((await initialize()).status).toBe(201);
    const invalidPasswordResponse = await recover(
      env.RECOVERY_SECRET,
      "too-short",
    );
    const invalidPasswordText = await invalidPasswordResponse.text();
    const setupSecretResponse = await recover(
      env.SETUP_SECRET,
      "valid replacement password",
    );
    const setupSecretText = await setupSecretResponse.text();
    const responseTexts = [
      emptyInstallationText,
      invalidPasswordText,
      setupSecretText,
    ];

    expect([
      emptyInstallationResponse.status,
      invalidPasswordResponse.status,
      setupSecretResponse.status,
    ]).toEqual([403, 403, 403]);
    expect(new Set(responseTexts)).toEqual(
      new Set([JSON.stringify({ status: "error", code: "RECOVERY_DENIED" })]),
    );
    expect((await signIn()).status).toBe(200);
  });

  it("never accepts the recovery secret from a URL query string", async () => {
    expect((await initialize()).status).toBe(201);
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const newPassword = "query strings cannot recover accounts";

    const response = await SELF.fetch(
      `http://briefly.test/api/recover?recoverySecret=${encodeURIComponent(env.RECOVERY_SECRET)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newPassword }),
      },
    );
    const responseText = await response.text();

    expect(response.status).toBe(403);
    expect(JSON.parse(responseText)).toEqual({
      status: "error",
      code: "RECOVERY_DENIED",
    });
    expect((await signIn()).status).toBe(200);
    expect(responseText).not.toContain(env.RECOVERY_SECRET);
    expect(consoleInfo.mock.calls.flat().join(" ")).not.toContain(
      env.RECOVERY_SECRET,
    );
  });

  it("revokes the submitting and every other session after an authenticated password change", async () => {
    expect((await initialize()).status).toBe(201);
    const submittingCookie = cookieFrom(await signIn());
    const otherCookie = cookieFrom(await signIn());
    const newPassword = "a normal fresh administrator password";

    const changeResponse = await SELF.fetch(
      "http://briefly.test/api/auth/change-password",
      {
        method: "POST",
        headers: {
          cookie: submittingCookie,
          "content-type": "application/json",
          origin: "http://briefly.test",
        },
        body: JSON.stringify({
          currentPassword: administrator.password,
          newPassword,
          revokeOtherSessions: false,
        }),
      },
    );

    expect(changeResponse.status).toBe(200);
    expect(await changeResponse.json()).toEqual({ status: "ok" });
    const client = createApiClient(
      "http://briefly.test",
      SELF.fetch.bind(SELF) as typeof fetch,
    );
    for (const cookie of [submittingCookie, otherCookie]) {
      expect(
        (await client.admin.session.get({ headers: { cookie } })).status,
      ).toBe(401);
    }
    expect((await signIn()).status).toBe(401);
    expect(
      (
        await signIn({
          email: administrator.email,
          password: newPassword,
        })
      ).status,
    ).toBe(200);
  });

  it("keeps the old password and sessions when all-session revocation cannot commit", async () => {
    expect((await initialize()).status).toBe(201);
    const cookie = cookieFrom(await signIn());
    const newPassword = "a password that must roll back";
    await env.DB.prepare(
      `CREATE TRIGGER fail_auth_session_delete
       BEFORE DELETE ON auth_session
       BEGIN
         SELECT RAISE(ABORT, 'injected session deletion failure');
       END`,
    ).run();

    try {
      const response = await SELF.fetch(
        "http://briefly.test/api/auth/change-password",
        {
          method: "POST",
          headers: {
            cookie,
            "content-type": "application/json",
            origin: "http://briefly.test",
          },
          body: JSON.stringify({
            currentPassword: administrator.password,
            newPassword,
          }),
        },
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({
        status: "error",
        code: "INTERNAL_ERROR",
      });
      const client = createApiClient(
        "http://briefly.test",
        SELF.fetch.bind(SELF) as typeof fetch,
      );
      expect(
        (await client.admin.session.get({ headers: { cookie } })).status,
      ).toBe(200);
      expect((await signIn()).status).toBe(200);
      expect(
        (
          await signIn({
            email: administrator.email,
            password: newPassword,
          })
        ).status,
      ).toBe(401);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_auth_session_delete").run();
    }
  }, 15_000);

  it("initializes the installation exactly once without returning the configured identity", async () => {
    const response = await initialize();
    const responseText = await response.text();

    expect(response.status).toBe(201);
    expect(JSON.parse(responseText)).toEqual({ status: "ok" });
    expect(responseText).not.toContain("administrator@example.com");

    const statusResponse = await SELF.fetch(
      "http://briefly.test/api/installation",
    );
    expect(statusResponse.status).toBe(200);
    expect(await statusResponse.json()).toEqual({ initialized: true });

    const retryResponse = await initialize({
      email: "second@example.com",
      password: "another correct horse battery staple",
    });
    expect(retryResponse.status).toBe(409);
    expect(await retryResponse.json()).toEqual({
      status: "error",
      code: "INITIALIZATION_CLOSED",
    });
  });

  it("enforces the documented twelve-character password minimum without consuming initialization", async () => {
    const shortPassword = "short-pass";
    const rejectedResponse = await initialize({
      email: administrator.email,
      password: shortPassword,
    });
    const rejectedText = await rejectedResponse.text();

    expect(rejectedResponse.status).toBe(400);
    expect(JSON.parse(rejectedText)).toEqual({
      status: "error",
      code: "INITIALIZATION_INVALID",
    });
    expect(rejectedText).not.toContain(shortPassword);
    expect((await initialize()).status).toBe(201);
  });

  it("rolls back the entire identity when credential persistence fails", async () => {
    await env.DB.prepare(
      `CREATE TRIGGER fail_auth_account_insert
       BEFORE INSERT ON auth_account
       BEGIN
         SELECT RAISE(ABORT, 'injected account failure');
       END`,
    ).run();

    try {
      const failedResponse = await initialize();
      expect(failedResponse.status).toBe(400);
      expect(await failedResponse.json()).toEqual({
        status: "error",
        code: "INITIALIZATION_INVALID",
      });
      expect(
        await (await SELF.fetch("http://briefly.test/api/installation")).json(),
      ).toEqual({ initialized: false });
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_auth_account_insert").run();
    }

    expect((await initialize()).status).toBe(201);
    expect((await signIn()).status).toBe(200);
  });

  it("allows at most one Administrator across concurrent valid initialization attempts", async () => {
    const candidates = [
      administrator,
      {
        email: "other-administrator@example.com",
        password: "another correct horse battery staple",
      },
    ];
    const initializationResponses = await Promise.all(
      candidates.map((candidate) => initialize(candidate)),
    );

    expect(initializationResponses.map(({ status }) => status).sort()).toEqual([
      201, 409,
    ]);

    const signInResponses = await Promise.all(candidates.map(signIn));
    expect(signInResponses.map(({ status }) => status).sort()).toEqual([
      200, 401,
    ]);
  });

  it("keeps Better Auth public sign-up closed before and after initialization", async () => {
    const signUpResponse = await SELF.fetch(
      "http://briefly.test/api/auth/sign-up/email",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Intruder",
          email: "intruder@example.com",
          password: "another correct horse battery staple",
        }),
      },
    );
    const signUpText = await signUpResponse.text();

    expect(signUpResponse.status).toBe(400);
    expect(signUpText).not.toContain("intruder@example.com");
    expect((await initialize()).status).toBe(201);

    const secondSignUpResponse = await SELF.fetch(
      "http://briefly.test/api/auth/sign-up/email",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Second Administrator",
          email: "second@example.com",
          password: "yet another correct horse battery staple",
        }),
      },
    );
    expect(secondSignUpResponse.status).toBe(400);
    expect(await secondSignUpResponse.text()).not.toContain(
      "second@example.com",
    );
  });

  it("signs in, authorizes an Eden operation, and revokes the session on sign-out", async () => {
    expect((await initialize()).status).toBe(201);

    const signInStartedAt = Date.now();
    const signInResponse = await signIn();
    const signInFinishedAt = Date.now();
    const setCookie = signInResponse.headers.get("set-cookie") ?? "";
    const cookie = cookieFrom(signInResponse);

    expect(signInResponse.status).toBe(200);
    expect(setCookie).toContain("briefly.session_token=");
    expect(setCookie).toContain("Max-Age=604800");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).not.toContain("Secure");

    const initialSession = await env.DB.prepare(
      "SELECT expires_at AS expiresAt FROM auth_session",
    ).first<{ expiresAt: number }>();
    expect(initialSession?.expiresAt).toBeGreaterThanOrEqual(
      signInStartedAt + 7 * 24 * 60 * 60 * 1000,
    );
    expect(initialSession?.expiresAt).toBeLessThanOrEqual(
      signInFinishedAt + 7 * 24 * 60 * 60 * 1000,
    );

    const client = createApiClient(
      "http://briefly.test",
      SELF.fetch.bind(SELF) as typeof fetch,
    );
    const protectedResponse = await client.admin.session.get({
      headers: { cookie },
    });
    expect(protectedResponse.status).toBe(200);
    expect(protectedResponse.data).toEqual({ authenticated: true });

    const signOutResponse = await SELF.fetch(
      "http://briefly.test/api/auth/sign-out",
      {
        method: "POST",
        headers: { cookie, origin: "http://briefly.test" },
      },
    );
    expect(signOutResponse.status).toBe(200);

    const discardedSessionResponse = await client.admin.session.get({
      headers: { cookie },
    });
    expect(discardedSessionResponse.status).toBe(401);
    expect(discardedSessionResponse.error?.value).toEqual({
      status: "error",
      code: "AUTHENTICATION_REQUIRED",
    });
  });

  it("returns the same generic failure for an unknown email and a wrong password", async () => {
    expect((await initialize()).status).toBe(201);
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const wrongPasswordResponse = await signIn({
      email: administrator.email,
      password: "wrong but sufficiently long password",
    });
    const unknownEmailResponse = await signIn({
      email: "unknown-administrator@example.com",
      password: "wrong but sufficiently long password",
    });
    const [wrongPasswordText, unknownEmailText] = await Promise.all([
      wrongPasswordResponse.text(),
      unknownEmailResponse.text(),
    ]);

    expect(wrongPasswordResponse.status).toBe(401);
    expect(unknownEmailResponse.status).toBe(401);
    expect(wrongPasswordText).toBe(unknownEmailText);
    for (const leakedIdentity of [
      administrator.email,
      "unknown-administrator@example.com",
    ]) {
      expect(wrongPasswordText).not.toContain(leakedIdentity);
      expect(unknownEmailText).not.toContain(leakedIdentity);
      expect(consoleInfo.mock.calls.flat().join(" ")).not.toContain(
        leakedIdentity,
      );
      expect(consoleWarn.mock.calls.flat().join(" ")).not.toContain(
        leakedIdentity,
      );
    }
  });

  it("expires old sessions and renews active sessions after one day", async () => {
    expect((await initialize()).status).toBe(201);
    const client = createApiClient(
      "http://briefly.test",
      SELF.fetch.bind(SELF) as typeof fetch,
    );

    const expiringSignInResponse = await signIn();
    const expiringCookie = cookieFrom(expiringSignInResponse);
    await env.DB.prepare("UPDATE auth_session SET expires_at = ?")
      .bind(Date.now() - 1)
      .run();
    expect(
      (
        await client.admin.session.get({
          headers: { cookie: expiringCookie },
        })
      ).status,
    ).toBe(401);

    const renewingSignInResponse = await signIn();
    const renewingCookie = cookieFrom(renewingSignInResponse);
    const now = Date.now();
    const renewingSession = await env.DB.prepare(
      "SELECT id FROM auth_session WHERE expires_at > ? ORDER BY created_at DESC LIMIT 1",
    )
      .bind(now)
      .first<{ id: string }>();
    if (!renewingSession) throw new Error("Expected an active D1 session");
    await env.DB.prepare(
      "UPDATE auth_session SET updated_at = ?, expires_at = ? WHERE id = ?",
    )
      .bind(
        now - 2 * 24 * 60 * 60 * 1000,
        now + 5 * 24 * 60 * 60 * 1000,
        renewingSession.id,
      )
      .run();
    const renewalStartedAt = Date.now();
    const renewedResponse = await client.admin.session.get({
      headers: { cookie: renewingCookie },
    });
    const renewalFinishedAt = Date.now();

    expect(renewedResponse.status).toBe(200);
    expect(renewedResponse.response.headers.get("set-cookie")).toContain(
      "Max-Age=604800",
    );
    const renewedSession = await env.DB.prepare(
      "SELECT expires_at AS expiresAt FROM auth_session WHERE id = ?",
    )
      .bind(renewingSession.id)
      .first<{ expiresAt: number }>();
    expect(renewedSession?.expiresAt).toBeGreaterThanOrEqual(
      renewalStartedAt + 7 * 24 * 60 * 60 * 1000,
    );
    expect(renewedSession?.expiresAt).toBeLessThanOrEqual(
      renewalFinishedAt + 7 * 24 * 60 * 60 * 1000,
    );
  });

  it("uses a Secure HttpOnly cookie at the production HTTPS origin", async () => {
    expect((await initialize()).status).toBe(201);
    const context = createExecutionContext();
    const response = await worker.fetch(
      new Request("https://publication.example.com/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://publication.example.com",
        },
        body: JSON.stringify(administrator),
      }) as Request<unknown, IncomingRequestCfProperties>,
      {
        ...env,
        APP_ENV: "production",
        APP_ORIGIN: "https://publication.example.com",
      },
      context,
    );
    await waitOnExecutionContext(context);

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(response.status).toBe(200);
    expect(setCookie).toContain("__Secure-briefly.session_token=");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("HttpOnly");
  });

  it("rate-limits malformed initialization attempts before body validation", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await SELF.fetch("http://briefly.test/api/initialize", {
        method: "POST",
        headers: {
          "cf-connecting-ip": "192.0.2.10",
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      });
      statuses.push(response.status);
      if (attempt === 5) {
        expect(response.status).toBe(429);
        expect(response.headers.get("retry-after")).toEqual(
          expect.stringMatching(/^\d+$/),
        );
        expect(await response.json()).toEqual({
          status: "error",
          code: "RATE_LIMITED",
        });
      }
    }

    expect(statuses).toEqual([422, 422, 422, 422, 422, 429]);
    const otherClientResponse = await SELF.fetch(
      "http://briefly.test/api/initialize",
      {
        method: "POST",
        headers: {
          "cf-connecting-ip": "192.0.2.11",
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );
    expect(otherClientResponse.status).toBe(422);
  });

  it("rate-limits repeated sign-in failures per client", async () => {
    expect((await initialize()).status).toBe(201);
    const statuses: number[] = [];

    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await SELF.fetch(
        "http://briefly.test/api/auth/sign-in/email",
        {
          method: "POST",
          headers: {
            "cf-connecting-ip": "198.51.100.20",
            "content-type": "application/json",
            origin: "http://briefly.test",
          },
          body: JSON.stringify({
            email: "unknown@example.com",
            password: "wrong but sufficiently long password",
          }),
        },
      );
      statuses.push(response.status);
      if (attempt === 10) {
        expect(response.headers.get("retry-after")).toEqual(
          expect.stringMatching(/^\d+$/),
        );
        expect(await response.json()).toMatchObject({
          status: "error",
          code: "RATE_LIMITED",
        });
      }
    }

    expect(statuses).toEqual([
      401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 429,
    ]);
    const otherClientResponse = await SELF.fetch(
      "http://briefly.test/api/auth/sign-in/email",
      {
        method: "POST",
        headers: {
          "cf-connecting-ip": "198.51.100.21",
          "content-type": "application/json",
          origin: "http://briefly.test",
        },
        body: JSON.stringify({
          email: "unknown@example.com",
          password: "wrong but sufficiently long password",
        }),
      },
    );
    expect(otherClientResponse.status).toBe(401);
  });

  it("rate-limits recovery attempts and allows recovery after the window resets", async () => {
    expect((await initialize()).status).toBe(201);
    const newPassword = "recovered after rate limit reset";
    const statuses: number[] = [];

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await SELF.fetch("http://briefly.test/api/recover", {
        method: "POST",
        headers: {
          "cf-connecting-ip": "203.0.113.30",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          recoverySecret:
            attempt === 5 ? env.RECOVERY_SECRET : "incorrect secret",
          newPassword,
        }),
      });
      statuses.push(response.status);
      if (attempt === 5) {
        expect(response.headers.get("retry-after")).toEqual(
          expect.stringMatching(/^\d+$/),
        );
        expect(await response.json()).toEqual({
          status: "error",
          code: "RATE_LIMITED",
        });
      }
    }

    expect(statuses).toEqual([403, 403, 403, 403, 403, 429]);
    expect((await signIn()).status).toBe(200);
    await env.DB.prepare(
      "UPDATE auth_rate_limit SET reset_at = 0 WHERE key LIKE 'recovery:%'",
    ).run();

    const recoveredResponse = await SELF.fetch(
      "http://briefly.test/api/recover",
      {
        method: "POST",
        headers: {
          "cf-connecting-ip": "203.0.113.30",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          recoverySecret: env.RECOVERY_SECRET,
          newPassword,
        }),
      },
    );
    expect(recoveredResponse.status).toBe(200);
    expect(
      (
        await signIn({
          email: administrator.email,
          password: newPassword,
        })
      ).status,
    ).toBe(200);
  });

  it("redirects anonymous administration navigation without treating it as authorization", async () => {
    const anonymousResponse = await SELF.fetch("http://briefly.test/admin", {
      redirect: "manual",
    });
    expect(anonymousResponse.status).toBe(302);
    expect(anonymousResponse.headers.get("location")).toBe(
      "http://briefly.test/sign-in",
    );

    expect((await initialize()).status).toBe(201);
    const cookie = cookieFrom(await signIn());
    const authenticatedResponse = await SELF.fetch(
      "http://briefly.test/admin",
      { headers: { cookie } },
    );
    expect(authenticatedResponse.status).toBe(200);
    const authenticatedHtml = await authenticatedResponse.text();
    expect(authenticatedHtml).toContain("Administrator session");
    expect(authenticatedHtml).toContain("Change password");
    expect(authenticatedHtml).toContain("revokes every Administrator session");

    const recoveryResponse = await SELF.fetch("http://briefly.test/recover");
    const recoveryHtml = await recoveryResponse.text();
    expect(recoveryResponse.status).toBe(200);
    expect(recoveryHtml).toContain("Recover Administrator");
    expect(recoveryHtml).toContain("revokes every Administrator session");
    expect(recoveryHtml).toContain('name="recoverySecret"');
    expect(recoveryHtml).toContain('name="newPassword"');
  }, 30_000);
});
