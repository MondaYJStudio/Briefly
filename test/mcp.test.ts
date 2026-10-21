import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { initializeAndSignIn } from "./administrator-fixture";

const origin = "http://briefly.test";
const redirectUri = "http://127.0.0.1:6274/callback";

async function resetTables() {
  await env.DB.prepare(
    "UPDATE article SET current_publication_id = NULL",
  ).run();
  for (const table of [
    "publication_asset_reference",
    "article_draft_asset_reference",
    "publication",
    "article_draft",
    "article_slug",
    "purged_article_slug",
    "article",
    "auth_oauth_access_token",
    "auth_oauth_consent",
    "auth_oauth_application",
    "auth_verification",
    "auth_session",
    "auth_account",
    "auth_user",
    "auth_rate_limit",
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
}

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return btoa(String.fromCharCode(...array))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

async function pkcePair() {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64Url(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  return { verifier, challenge };
}

async function registerClient(name = "Test Agent"): Promise<string> {
  const response = await SELF.fetch(`${origin}/api/auth/mcp/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { client_id: string };
  return body.client_id;
}

function authorizeUrl(clientId: string, challenge: string, extra = "") {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "state-123",
    scope: "openid offline_access",
  });
  return `${origin}/api/auth/mcp/authorize?${query}${extra}`;
}

/** Authorizes as the signed-in Administrator and returns the consent code. */
async function requestConsent(cookie: string, url: string) {
  const response = await SELF.fetch(url, {
    headers: { cookie },
    redirect: "manual",
  });
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get("location") ?? "", origin);
  expect(location.pathname).toBe("/admin/oauth/consent");
  const consentCode = location.searchParams.get("consent_code");
  if (!consentCode) throw new Error("Expected a consent code");
  return consentCode;
}

async function answerConsent(
  cookie: string,
  consentCode: string,
  accept: boolean,
): Promise<URL> {
  const response = await SELF.fetch(`${origin}/api/auth/oauth2/consent`, {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json" },
    body: JSON.stringify({ accept, consent_code: consentCode }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { redirectURI: string };
  return new URL(body.redirectURI);
}

async function exchangeCode(
  clientId: string,
  code: string,
  verifier: string,
): Promise<Response> {
  return SELF.fetch(`${origin}/api/auth/mcp/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    }),
  });
}

async function connect(cookie: string) {
  const clientId = await registerClient();
  const { verifier, challenge } = await pkcePair();
  const consentCode = await requestConsent(
    cookie,
    authorizeUrl(clientId, challenge),
  );
  const redirect = await answerConsent(cookie, consentCode, true);
  const code = redirect.searchParams.get("code");
  expect(redirect.searchParams.get("state")).toBe("state-123");
  if (!code) throw new Error("Expected an authorization code");
  const token = await exchangeCode(clientId, code, verifier);
  expect(token.status).toBe(200);
  const { access_token: accessToken } = (await token.json()) as {
    access_token: string;
  };
  return { clientId, accessToken };
}

let nextId = 1;
async function mcp(
  accessToken: string,
  method: string,
  params: Record<string, unknown> = {},
) {
  const response = await SELF.fetch(`${origin}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  return response;
}

async function callTool(
  accessToken: string,
  name: string,
  args: Record<string, unknown>,
) {
  const response = await mcp(accessToken, "tools/call", {
    name,
    arguments: args,
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    result: { isError?: boolean; content: { type: string; text: string }[] };
  };
  const text = body.result.content.map((part) => part.text).join("\n");
  return {
    isError: body.result.isError === true,
    text,
    value: () => JSON.parse(body.result.content[0]?.text ?? "null"),
  };
}

describe("MCP access", () => {
  beforeEach(resetTables);

  it("publishes OAuth discovery metadata at the origin", async () => {
    const resource = await SELF.fetch(
      `${origin}/.well-known/oauth-protected-resource/mcp`,
    );
    expect(resource.status).toBe(200);
    expect(await resource.json()).toMatchObject({
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
    });

    const server = await SELF.fetch(
      `${origin}/.well-known/oauth-authorization-server`,
    );
    expect(server.status).toBe(200);
    expect(await server.json()).toMatchObject({
      issuer: origin,
      authorization_endpoint: `${origin}/api/auth/mcp/authorize`,
      token_endpoint: `${origin}/api/auth/mcp/token`,
      registration_endpoint: `${origin}/api/auth/mcp/register`,
      code_challenge_methods_supported: ["S256"],
    });
  });

  it("challenges an MCP request without a token", async () => {
    const response = await mcp("not-a-token", "tools/list");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it("sends an unauthenticated authorization to sign-in with its query", async () => {
    await initializeAndSignIn();
    const clientId = await registerClient();
    const { challenge } = await pkcePair();
    const response = await SELF.fetch(authorizeUrl(clientId, challenge), {
      redirect: "manual",
    });
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "", origin);
    expect(location.pathname).toBe("/admin/login");
    expect(location.searchParams.get("client_id")).toBe(clientId);
  });

  it("asks for consent even when the client does not request it", async () => {
    const cookie = await initializeAndSignIn();
    const clientId = await registerClient();
    const { challenge } = await pkcePair();
    // `prompt=none` would normally skip any interaction.
    await requestConsent(
      cookie,
      authorizeUrl(clientId, challenge, "&prompt=none"),
    );
  });

  it("returns access_denied when consent is refused", async () => {
    const cookie = await initializeAndSignIn();
    const clientId = await registerClient();
    const { challenge } = await pkcePair();
    const consentCode = await requestConsent(
      cookie,
      authorizeUrl(clientId, challenge),
    );
    const redirect = await answerConsent(cookie, consentCode, false);
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.get("code")).toBeNull();
  });

  it("refuses a code exchanged with the wrong PKCE verifier", async () => {
    const cookie = await initializeAndSignIn();
    const clientId = await registerClient();
    const { challenge } = await pkcePair();
    const consentCode = await requestConsent(
      cookie,
      authorizeUrl(clientId, challenge),
    );
    const redirect = await answerConsent(cookie, consentCode, true);
    const response = await exchangeCode(
      clientId,
      redirect.searchParams.get("code") ?? "",
      "wrong-verifier-wrong-verifier-wrong-verifier",
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("drafts, previews, and publishes an Article through MCP tools", async () => {
    const cookie = await initializeAndSignIn();
    const { accessToken } = await connect(cookie);

    const initialize = await mcp(accessToken, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(initialize.status).toBe(200);
    expect(await initialize.json()).toMatchObject({
      result: { serverInfo: { name: "briefly" } },
    });

    const list = await mcp(accessToken, "tools/list");
    const tools = (
      (await list.json()) as { result: { tools: { name: string }[] } }
    ).result.tools.map((tool) => tool.name);
    expect(tools.sort()).toEqual(
      [
        "create_article",
        "get_article",
        "link_translation",
        "list_articles",
        "list_channels",
        "preview_article",
        "publish_article",
        "unlink_translation",
        "update_draft",
      ].sort(),
    );

    const refusedMarkdown = await callTool(accessToken, "create_article", {
      title: "Broken",
      markdown: "<div>raw</div>",
    });
    expect(refusedMarkdown.isError).toBe(true);
    expect(refusedMarkdown.text).toContain("Raw HTML is not supported");
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM article").first(),
    ).toEqual({ count: 0 });

    const created = await callTool(accessToken, "create_article", {
      title: "How to Check Backlinks",
      slug: "check-backlinks",
      summary: "Free methods and what to look for.",
      tags: ["seo"],
      language: "en",
      markdown:
        "To check backlinks, start with **Search Console**.\n\n## Steps\n\n1. Enter a domain\n2. Read referring domains",
    });
    expect(created.isError).toBe(false);
    const article = created.value() as { id: string; draftVersion: number };
    expect(created.value()).toMatchObject({
      slug: "check-backlinks",
      lifecycle: "draft",
      currentPublicationId: null,
    });

    const read = await callTool(accessToken, "get_article", {
      articleId: article.id,
    });
    expect(read.value()).toMatchObject({
      title: "How to Check Backlinks",
      markdown:
        "To check backlinks, start with **Search Console**.\n\n## Steps\n\n1. Enter a domain\n2. Read referring domains",
    });

    const stale = await callTool(accessToken, "update_draft", {
      articleId: article.id,
      draftVersion: article.draftVersion + 5,
      summary: "Changed",
    });
    expect(stale.isError).toBe(true);

    const updated = await callTool(accessToken, "update_draft", {
      articleId: article.id,
      draftVersion: article.draftVersion,
      summary: "Changed",
    });
    expect(updated.isError).toBe(false);
    const { draftVersion } = updated.value() as { draftVersion: number };
    expect(updated.value()).toMatchObject({
      summary: "Changed",
      slug: "check-backlinks",
      tags: ["seo"],
    });

    const preview = await callTool(accessToken, "preview_article", {
      articleId: article.id,
      draftVersion,
    });
    expect(preview.value()).toMatchObject({
      ready: true,
      metadata: { slug: "check-backlinks", language: "en" },
    });

    const published = await callTool(accessToken, "publish_article", {
      articleId: article.id,
      draftVersion,
      expectedCurrentPublicationId: null,
    });
    expect(published.isError).toBe(false);
    expect(published.value()).toMatchObject({
      slug: "check-backlinks",
      publicApiUrl: `${origin}/api/articles/check-backlinks`,
    });

    const publicArticle = await SELF.fetch(
      `${origin}/api/articles/check-backlinks`,
    );
    expect(publicArticle.status).toBe(200);
    expect(await publicArticle.json()).toMatchObject({
      title: "How to Check Backlinks",
      summary: "Changed",
    });

    const republish = await callTool(accessToken, "publish_article", {
      articleId: article.id,
      draftVersion,
      expectedCurrentPublicationId: null,
    });
    expect(republish.isError).toBe(true);
    expect(republish.text).toContain("Publication Conflict");
  });

  it("creates translations in the source's Translation Group through MCP tools", async () => {
    const cookie = await initializeAndSignIn();
    const { accessToken } = await connect(cookie);
    const articleCount = async () =>
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS count FROM article WHERE trashed_at IS NULL",
        ).first<{ count: number }>()
      )?.count;

    const source = (
      await callTool(accessToken, "create_article", {
        title: "检查外链",
        language: "zh-Hans",
        markdown: "从 **Search Console** 开始。",
      })
    ).value() as { id: string; translations: unknown[] };
    expect(source.translations).toEqual([]);

    const withoutLanguage = await callTool(accessToken, "create_article", {
      title: "Check backlinks",
      markdown: "Start with Search Console.",
      translationOf: source.id,
    });
    expect(withoutLanguage.isError).toBe(true);
    expect(withoutLanguage.text).toContain("language is required");

    const sameLanguage = await callTool(accessToken, "create_article", {
      title: "检查外链（大陆）",
      language: "zh-CN",
      markdown: "从 Search Console 开始。",
      translationOf: source.id,
    });
    expect(sameLanguage.isError).toBe(true);
    expect(sameLanguage.text).toContain("already uses this language");
    expect(await articleCount()).toBe(1);

    const translation = await callTool(accessToken, "create_article", {
      title: "Check backlinks",
      language: "en",
      markdown: "Start with **Search Console**.",
      translationOf: source.id,
    });
    expect(translation.isError).toBe(false);
    const translated = translation.value() as { id: string };
    expect(translation.value()).toMatchObject({
      title: "Check backlinks",
      slug: "Check backlinks",
      language: "en",
      hasCover: false,
      translations: [
        {
          id: source.id,
          title: "检查外链",
          language: "zh-Hans",
          lifecycle: "draft",
        },
      ],
    });
    const translatedBody = await callTool(accessToken, "get_article", {
      articleId: translated.id,
    });
    expect(translatedBody.value()).toMatchObject({
      markdown: "Start with **Search Console**.",
    });

    const readSource = await callTool(accessToken, "get_article", {
      articleId: source.id,
    });
    expect(readSource.value()).toMatchObject({
      translations: [
        {
          id: translated.id,
          title: "Check backlinks",
          language: "en",
          lifecycle: "draft",
        },
      ],
    });

    // A refused save leaves the new Article in Trash, outside the group.
    const slugTaken = await callTool(accessToken, "create_article", {
      title: "バックリンク",
      slug: "检查外链",
      language: "ja",
      markdown: "Search Console から始めます。",
      translationOf: source.id,
    });
    expect(slugTaken.isError).toBe(true);
    expect(slugTaken.text).toContain("moved to Trash");
    const { results: grouped } = await env.DB.prepare(
      `SELECT id FROM article
       WHERE translation_group_id = (
         SELECT translation_group_id FROM article WHERE id = ?
       )
       ORDER BY id`,
    )
      .bind(source.id)
      .all<{ id: string }>();
    expect(grouped.map(({ id }) => id)).toEqual(
      [source.id, translated.id].sort(),
    );
  });

  it("links and unlinks existing Articles in Translation Groups through MCP tools", async () => {
    const cookie = await initializeAndSignIn();
    const { accessToken } = await connect(cookie);
    const create = async (title: string, language: string) =>
      (
        await callTool(accessToken, "create_article", {
          title,
          language,
          markdown: "Body.",
        })
      ).value() as { id: string };

    const source = await create("检查外链", "zh-Hans");
    const english = await create("Check backlinks", "en");
    const other = await create("其他文章", "zh-Hans");

    const linked = await callTool(accessToken, "link_translation", {
      articleId: source.id,
      translationArticleId: english.id,
    });
    expect(linked.isError).toBe(false);
    expect(linked.value()).toMatchObject({
      id: source.id,
      translations: [{ id: english.id, language: "en" }],
    });

    const self = await callTool(accessToken, "link_translation", {
      articleId: source.id,
      translationArticleId: source.id,
    });
    expect(self.text).toContain("cannot translate itself");

    // Moving between groups is unlink first, then link.
    const moved = await callTool(accessToken, "link_translation", {
      articleId: other.id,
      translationArticleId: english.id,
    });
    expect(moved.isError).toBe(true);
    expect(moved.text).toContain("unlink_translation");

    const unlinked = await callTool(accessToken, "unlink_translation", {
      articleId: english.id,
    });
    expect(unlinked.isError).toBe(false);
    expect(unlinked.value()).toMatchObject({
      id: english.id,
      translations: [],
    });
    const readSource = await callTool(accessToken, "get_article", {
      articleId: source.id,
    });
    expect(readSource.value()).toMatchObject({ translations: [] });

    const relinked = await callTool(accessToken, "link_translation", {
      articleId: other.id,
      translationArticleId: english.id,
    });
    expect(relinked.value()).toMatchObject({
      id: other.id,
      translations: [{ id: english.id }],
    });

    const again = await callTool(accessToken, "unlink_translation", {
      articleId: source.id,
    });
    expect(again.isError).toBe(false);
  });

  it("lists Connected Apps and refuses a disconnected one", async () => {
    const cookie = await initializeAndSignIn();
    const { clientId, accessToken } = await connect(cookie);

    const listed = await SELF.fetch(`${origin}/api/admin/connected-apps`, {
      headers: { cookie },
    });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      connectedApps: [
        { clientId, name: "Test Agent", redirectHosts: ["127.0.0.1:6274"] },
      ],
    });

    const client = await SELF.fetch(
      `${origin}/api/admin/oauth-clients/${clientId}`,
      { headers: { cookie } },
    );
    expect(await client.json()).toEqual({
      clientId,
      name: "Test Agent",
      redirectHosts: ["127.0.0.1:6274"],
    });

    expect((await mcp(accessToken, "tools/list")).status).toBe(200);
    const disconnected = await SELF.fetch(
      `${origin}/api/admin/connected-apps/${clientId}`,
      { method: "DELETE", headers: { cookie } },
    );
    expect(disconnected.status).toBe(204);
    expect((await mcp(accessToken, "tools/list")).status).toBe(401);
  });

  it("keeps the Connected Apps API behind the Administrator Session", async () => {
    const response = await SELF.fetch(`${origin}/api/admin/connected-apps`);
    expect(response.status).toBe(401);
  });
});
