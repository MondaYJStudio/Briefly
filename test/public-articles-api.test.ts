import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { OpenAPIV3_1 } from "openapi-types";
import { beforeEach, describe, expect, it } from "vitest";

import { administrator, initializeAndSignIn } from "./administrator-fixture";
import { uploadOnePixelPngAsset } from "./asset-fixture";
import {
  expectResponseMatchesContract,
  jsonSchemaMatches,
  responseSchema,
} from "./openapi-contract";

function textDocument(text: string) {
  return {
    documentSchemaVersion: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text }],
        },
      ],
    },
  };
}

async function createArticle(
  cookie: string,
  input: {
    slug: string;
    title: string;
    summary?: string | null;
    tags?: string[];
    cover?: { assetId: string; alt: string };
  },
): Promise<{ id: string; publicationId: string }> {
  const created = await SELF.fetch("http://briefly.test/api/admin/articles", {
    method: "POST",
    headers: { cookie },
  });
  expect(created.status).toBe(201);
  const { id } = await created.json<{ id: string }>();

  const saved = await SELF.fetch(
    `http://briefly.test/api/admin/articles/${id}/draft`,
    {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        title: input.title,
        slug: input.slug,
        summary: input.summary ?? null,
        tags: input.tags ?? [],
        byline: { name: "Public Writer", url: null },
        language: "en",
        cover: input.cover ?? null,
        document: textDocument(`Private source for ${input.title}`),
      }),
    },
  );
  expect(saved.status).toBe(200);

  const published = await SELF.fetch(
    `http://briefly.test/api/admin/articles/${id}/publications`,
    {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        draftVersion: 2,
        expectedCurrentPublicationId: null,
      }),
    },
  );
  expect(published.status).toBe(201);
  const { publicationId } = await published.json<{ publicationId: string }>();
  return { id, publicationId };
}

async function createDraftOnlyArticle(cookie: string): Promise<string> {
  const created = await SELF.fetch("http://briefly.test/api/admin/articles", {
    method: "POST",
    headers: { cookie },
  });
  expect(created.status).toBe(201);
  const { id } = await created.json<{ id: string }>();
  const saved = await SELF.fetch(
    `http://briefly.test/api/admin/articles/${id}/draft`,
    {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        title: "Draft-only secret title",
        slug: "draft-only-secret",
        summary: "Draft-only secret summary",
        tags: ["secret"],
        byline: null,
        language: null,
        document: textDocument("Draft-only secret source"),
      }),
    },
  );
  expect(saved.status).toBe(200);
  return id;
}

describe("public Article API", () => {
  beforeEach(async () => {
    const { results } = await env.DB.prepare(
      "SELECT object_key FROM asset",
    ).all<{ object_key: string }>();
    await Promise.all(
      results.map(({ object_key }) => env.MEDIA_BUCKET.delete(object_key)),
    );
    await env.DB.batch([
      env.DB.prepare("UPDATE article SET current_publication_id = NULL"),
      env.DB.prepare("DELETE FROM publication"),
      env.DB.prepare("DELETE FROM article_draft"),
      env.DB.prepare("DELETE FROM article"),
      env.DB.prepare("DELETE FROM asset"),
      env.DB.prepare("DELETE FROM auth_session"),
      env.DB.prepare("DELETE FROM auth_account"),
      env.DB.prepare("DELETE FROM auth_user"),
      env.DB.prepare("DELETE FROM auth_rate_limit"),
      env.DB.prepare(
        "UPDATE installation SET state = 'uninitialized', initialized_at = NULL WHERE id = 1",
      ),
    ]);
  });

  it("lists only Current Publications in deterministic first-published order without private content", async () => {
    const cookie = await initializeAndSignIn();
    const first = await createArticle(cookie, {
      slug: "first-current",
      title: "First current",
      summary: null,
      tags: ["Featured"],
    });
    const second = await createArticle(cookie, {
      slug: "second-current",
      title: "Second current",
      summary: "Authored summary",
      tags: ["news"],
    });
    const trashed = await createArticle(cookie, {
      slug: "trashed-current",
      title: "Trashed secret title",
    });
    await createDraftOnlyArticle(cookie);

    const tiedPublishedAt = Date.parse("2026-07-01T00:00:00.000Z");
    await env.DB.batch([
      env.DB.prepare("UPDATE article SET published_at = ? WHERE id = ?").bind(
        tiedPublishedAt,
        first.id,
      ),
      env.DB.prepare("UPDATE article SET published_at = ? WHERE id = ?").bind(
        tiedPublishedAt,
        second.id,
      ),
      env.DB.prepare("UPDATE article SET trashed_at = ? WHERE id = ?").bind(
        Date.parse("2026-07-02T00:00:00.000Z"),
        trashed.id,
      ),
      env.DB.prepare(
        `INSERT INTO publication
           (id, article_id, slug, slug_key, publication_number, title,
            summary, tags, byline, language, cover, document_schema_version,
            document, renderer_version, provider_facts, html, published_at,
            created_at)
         SELECT ?, article_id, slug, slug_key, 2, ?, summary, tags, byline,
                language, cover, document_schema_version, document,
                renderer_version, provider_facts, ?, published_at - 1,
                created_at - 1
         FROM publication WHERE id = ?`,
      ).bind(
        crypto.randomUUID(),
        "Old secret publication title",
        "<p>Old secret publication body</p>",
        first.publicationId,
      ),
    ]);

    const response = await SELF.fetch("http://briefly.test/api/articles", {
      headers: {
        cookie: "better-auth.session_token=must-be-ignored",
        origin: "https://reader.example",
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json<{
      items: Array<Record<string, unknown> & { id: string }>;
      nextCursor: string | null;
    }>();
    const expectedIds = [first.id, second.id].sort();
    expect(payload.items.map(({ id }) => id)).toEqual(expectedIds);
    expect(payload.nextCursor).toBeNull();
    expect(Object.keys(payload.items[0] ?? {}).sort()).toEqual(
      [
        "byline",
        "cover",
        "id",
        "language",
        "publishedAt",
        "slug",
        "summary",
        "tags",
        "title",
        "updatedAt",
      ].sort(),
    );
    expect(JSON.stringify(payload)).not.toMatch(
      /Private source|Draft-only secret|Trashed secret|Old secret|administrator@example\.com|document|html|currentPublicationId/u,
    );
  }, 30_000);

  it("traverses a normalized single-tag result set with an opaque stable cursor", async () => {
    const cookie = await initializeAndSignIn();
    const inputs = [
      { slug: "newest", title: "Newest", tags: ["  FeAtUrEd  "] },
      { slug: "not-featured", title: "Not featured", tags: ["news"] },
      { slug: "middle", title: "Middle", tags: ["featured"] },
      { slug: "oldest", title: "Oldest", tags: ["FEATURED"] },
    ];
    const publications = [];
    for (const input of inputs) {
      publications.push(await createArticle(cookie, input));
    }
    const tiedPublishedAt = Date.parse("2026-06-01T00:00:00.000Z");
    await env.DB.batch(
      publications.map(({ id }) =>
        env.DB.prepare("UPDATE article SET published_at = ? WHERE id = ?").bind(
          tiedPublishedAt,
          id,
        ),
      ),
    );
    const expectedIds = [
      publications[0]?.id,
      publications[2]?.id,
      publications[3]?.id,
    ].sort();

    const tag = encodeURIComponent(`${" ".repeat(100)}FEATURED  `);
    const firstResponse = await SELF.fetch(
      `http://briefly.test/api/articles?limit=2&tag=${tag}`,
    );
    expect(firstResponse.status).toBe(200);
    const firstPage = await firstResponse.json<{
      items: Array<{ id: string; tags: string[] }>;
      nextCursor: string | null;
    }>();
    expect(firstPage.items.map(({ id }) => id)).toEqual(
      expectedIds.slice(0, 2),
    );
    expect(firstPage.items.every(({ tags }) => tags[0] === "featured")).toBe(
      true,
    );
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(firstPage.nextCursor).not.toContain(expectedIds[1]);

    const secondResponse = await SELF.fetch(
      `http://briefly.test/api/articles?limit=2&tag=${tag}&cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`,
    );
    expect(secondResponse.status).toBe(200);
    const secondPage = await secondResponse.json<{
      items: Array<{ id: string }>;
      nextCursor: string | null;
    }>();
    expect(secondPage.items.map(({ id }) => id)).toEqual(expectedIds.slice(2));
    expect(secondPage.nextCursor).toBeNull();
    expect(
      [...firstPage.items, ...secondPage.items].map(({ id }) => id),
    ).toEqual(expectedIds);
  }, 30_000);

  it("rejects unsupported list queries and distinguishes malformed from stale cursors", async () => {
    const cookie = await initializeAndSignIn();
    const newer = await createArticle(cookie, {
      slug: "cursor-newer",
      title: "Cursor newer",
      tags: ["cursor"],
    });
    const older = await createArticle(cookie, {
      slug: "cursor-older",
      title: "Cursor older",
      tags: ["cursor"],
    });
    await env.DB.batch([
      env.DB.prepare("UPDATE article SET published_at = ? WHERE id = ?").bind(
        Date.parse("2026-06-02T00:00:00.000Z"),
        newer.id,
      ),
      env.DB.prepare("UPDATE article SET published_at = ? WHERE id = ?").bind(
        Date.parse("2026-06-01T00:00:00.000Z"),
        older.id,
      ),
    ]);

    for (const query of [
      "limit=0",
      "limit=101",
      "limit=1.5",
      "tag=one&tag=two",
      "search=cursor",
      "sort=title",
    ]) {
      const invalid = await SELF.fetch(
        `http://briefly.test/api/articles?${query}`,
      );
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({
        status: "error",
        code: "ARTICLE_LIST_QUERY_INVALID",
      });
    }

    const malformed = await SELF.fetch(
      "http://briefly.test/api/articles?cursor=not-a-cursor",
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({
      status: "error",
      code: "ARTICLE_LIST_CURSOR_INVALID",
    });

    const firstResponse = await SELF.fetch(
      "http://briefly.test/api/articles?limit=1&tag=cursor",
    );
    expect(firstResponse.status).toBe(200);
    const firstPage = await firstResponse.json<{
      items: Array<{ id: string }>;
      nextCursor: string;
    }>();
    expect(firstPage.items.map(({ id }) => id)).toEqual([newer.id]);
    await env.DB.prepare("UPDATE article SET trashed_at = ? WHERE id = ?")
      .bind(Date.now(), newer.id)
      .run();

    const stale = await SELF.fetch(
      `http://briefly.test/api/articles?limit=1&tag=cursor&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
    );
    expect(stale.status).toBe(400);
    expect(await stale.json()).toEqual({
      status: "error",
      code: "ARTICLE_LIST_CURSOR_STALE",
    });
  }, 30_000);

  it("serves cookie-independent CORS, HEAD, ETag, revalidation, and immediate list visibility", async () => {
    const cookie = await initializeAndSignIn();
    const first = await createArticle(cookie, {
      slug: "cache-first",
      title: "Cache first",
    });

    const anonymous = await SELF.fetch(
      "http://briefly.test/api/articles?limit=10",
      { headers: { origin: "https://reader-one.example" } },
    );
    const withCookie = await SELF.fetch(
      "http://briefly.test/api/articles?limit=10",
      {
        headers: {
          cookie,
          origin: "https://reader-two.example",
        },
      },
    );
    expect(anonymous.status).toBe(200);
    expect(withCookie.status).toBe(200);
    expect(await withCookie.clone().json()).toEqual(
      await anonymous.clone().json(),
    );
    for (const response of [anonymous, withCookie]) {
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("cache-control")).toBe(
        "public, max-age=0, must-revalidate",
      );
      expect(response.headers.get("etag")).toMatch(/^"[^"]+"$/u);
      expect(response.headers.get("vary") ?? "").not.toContain("Cookie");
    }
    const etag = anonymous.headers.get("etag");
    if (!etag) throw new Error("Expected a list ETag");
    expect(withCookie.headers.get("etag")).toBe(etag);

    const head = await SELF.fetch("http://briefly.test/api/articles?limit=10", {
      method: "HEAD",
      headers: { origin: "https://reader.example" },
    });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("etag")).toBe(etag);
    expect(head.headers.get("access-control-allow-origin")).toBe("*");

    const conditional = await SELF.fetch(
      "http://briefly.test/api/articles?limit=10",
      {
        headers: {
          "if-none-match": `W/${etag}`,
          origin: "https://reader.example",
        },
      },
    );
    expect(conditional.status).toBe(304);
    expect(await conditional.text()).toBe("");
    expect(conditional.headers.get("etag")).toBe(etag);
    expect(conditional.headers.get("access-control-allow-origin")).toBe("*");

    const second = await createArticle(cookie, {
      slug: "cache-second",
      title: "Cache second",
    });
    const afterPublish = await SELF.fetch(
      "http://briefly.test/api/articles?limit=10",
      { headers: { "if-none-match": etag } },
    );
    expect(afterPublish.status).toBe(200);
    expect(afterPublish.headers.get("etag")).not.toBe(etag);
    expect(
      (await afterPublish.json<{ items: Array<{ id: string }> }>()).items.map(
        ({ id }) => id,
      ),
    ).toEqual(expect.arrayContaining([first.id, second.id]));

    const invalid = await SELF.fetch(
      "http://briefly.test/api/articles?limit=101",
      { headers: { origin: "https://reader.example" } },
    );
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("access-control-allow-origin")).toBe("*");
    expect(invalid.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
  }, 30_000);

  it("serves an OpenAPI 3.1 contract that validates real list and detail behavior", async () => {
    const cookie = await initializeAndSignIn();
    const coverAsset = await uploadOnePixelPngAsset(cookie, "contract.png");
    const contractArticle = await createArticle(cookie, {
      slug: "contract-article",
      title: "Contract article",
      summary: null,
      tags: ["Contract"],
      cover: { assetId: coverAsset.id, alt: "Contract cover" },
    });

    const contractResponse = await SELF.fetch(
      "http://briefly.test/api/openapi.json",
      { headers: { origin: "https://reader.example" } },
    );
    expect(contractResponse.status).toBe(200);
    expect(contractResponse.headers.get("access-control-allow-origin")).toBe(
      "*",
    );
    const contract = await contractResponse.json<OpenAPIV3_1.Document>();
    expect(contract.openapi).toBe("3.1.0");
    expect(Object.keys(contract.paths ?? {}).sort()).toEqual([
      "/api/articles",
      "/api/articles/{slug}",
      "/api/site",
    ]);
    const unavailableDescription =
      "The Article is unavailable; this response intentionally does not disclose why.";
    for (const method of ["get", "head"] as const) {
      const unavailable =
        contract.paths?.["/api/articles/{slug}"]?.[method]?.responses?.[404];
      if (!unavailable || "$ref" in unavailable) {
        throw new Error(`Missing inline 404 response for ${method}`);
      }
      expect(unavailable.description).toBe(unavailableDescription);
    }

    const listParameters = contract.paths?.["/api/articles"]?.get?.parameters;
    if (!listParameters) throw new Error("Missing list parameters");
    const inlineParameters = listParameters.filter(
      (parameter): parameter is OpenAPIV3_1.ParameterObject =>
        !("$ref" in parameter),
    );
    expect(inlineParameters.map(({ name }) => name)).toEqual([
      "cursor",
      "limit",
      "tag",
    ]);
    const limit = inlineParameters.find(
      (parameter) => parameter.name === "limit",
    );
    expect(limit?.schema).toMatchObject({
      type: "integer",
      default: 20,
      maximum: 100,
      minimum: 1,
    });

    const listSuccess = await SELF.fetch(
      "http://briefly.test/api/articles?tag=contract",
    );
    const listSuccessBody = await listSuccess.json();
    expectResponseMatchesContract(
      contract,
      "/api/articles",
      "get",
      listSuccess.status,
      listSuccessBody,
    );
    expect(JSON.stringify(listSuccessBody)).not.toContain("html");
    const listPayload = listSuccessBody as {
      items: Array<Record<string, unknown> & { cover: { url: string } }>;
    };
    expect(new URL(listPayload.items[0]?.cover.url).origin).toBe(
      "http://briefly.test",
    );
    const leakingListPayload = structuredClone(listPayload);
    leakingListPayload.items[0]!.document = { private: true };
    expect(
      jsonSchemaMatches(
        contract,
        responseSchema(contract, "/api/articles", "get", 200),
        leakingListPayload,
      ),
    ).toBe(false);

    const listError = await SELF.fetch(
      "http://briefly.test/api/articles?cursor=malformed",
    );
    expectResponseMatchesContract(
      contract,
      "/api/articles",
      "get",
      listError.status,
      await listError.json(),
    );

    const detailSuccess = await SELF.fetch(
      "http://briefly.test/api/articles/contract-article",
    );
    const detailEtag = detailSuccess.headers.get("etag");
    expect(detailEtag).toBeTruthy();
    const detailSuccessBody = await detailSuccess.json();
    expectResponseMatchesContract(
      contract,
      "/api/articles/{slug}",
      "get",
      detailSuccess.status,
      detailSuccessBody,
    );
    expect(detailSuccessBody).toMatchObject({ summary: null });

    const detailError = await SELF.fetch(
      "http://briefly.test/api/articles/missing-article",
    );
    const detailErrorBody = await detailError.json();
    expectResponseMatchesContract(
      contract,
      "/api/articles/{slug}",
      "get",
      detailError.status,
      detailErrorBody,
    );

    const unpublished = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${contractArticle.id}/current-publication`,
      { method: "DELETE", headers: { cookie } },
    );
    expect(unpublished.status).toBe(200);
    const unavailable = await SELF.fetch(
      "http://briefly.test/api/articles/contract-article",
      { headers: { "if-none-match": detailEtag! } },
    );
    const unavailableBody = await unavailable.json();
    expect(unavailable.status).toBe(404);
    expect(unavailable.headers.get("etag")).toBeNull();
    expect(unavailableBody).toEqual(detailErrorBody);
    expectResponseMatchesContract(
      contract,
      "/api/articles/{slug}",
      "get",
      unavailable.status,
      unavailableBody,
    );

    const unavailableHead = await SELF.fetch(
      "http://briefly.test/api/articles/contract-article",
      { method: "HEAD", headers: { "if-none-match": detailEtag! } },
    );
    expect(unavailableHead.status).toBe(404);
    expect(unavailableHead.headers.get("etag")).toBeNull();
    expect(await unavailableHead.text()).toBe("");
  }, 30_000);

  it("documents and serves safely encoded permanent redirects from former public slugs", async () => {
    const cookie = await initializeAndSignIn();
    const published = await createArticle(cookie, {
      slug: "former-locator",
      title: "Former locator",
    });
    const canonicalSlug = "规范 slug";
    const revised = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${published.id}/draft`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          version: 2,
          title: "Canonical locator",
          slug: canonicalSlug,
          summary: null,
          tags: [],
          byline: { name: "Public Writer", url: null },
          language: "en",
          cover: null,
          document: textDocument("Canonical public source"),
        }),
      },
    );
    expect(revised.status).toBe(200);
    const republished = await SELF.fetch(
      `http://briefly.test/api/admin/articles/${published.id}/publications`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          draftVersion: 3,
          expectedCurrentPublicationId: published.publicationId,
        }),
      },
    );
    expect(republished.status).toBe(201);

    const contract = await (
      await SELF.fetch("http://briefly.test/api/openapi.json")
    ).json<OpenAPIV3_1.Document>();
    for (const method of ["get", "head"] as const) {
      const redirectResponse =
        contract.paths?.["/api/articles/{slug}"]?.[method]?.responses?.[308];
      if (!redirectResponse || "$ref" in redirectResponse) {
        throw new Error(`Missing inline 308 response for ${method}`);
      }
      expect(redirectResponse.description).toBe(
        "The requested formerly public slug permanently redirects to the Current Publication's canonical detail URL.",
      );
      expect(redirectResponse.headers?.Location).toEqual({
        $ref: "#/components/headers/CanonicalArticleLocation",
      });

      const response = await SELF.fetch(
        "http://briefly.test/api/articles/former-locator?next=https://attacker.example/path#fragment",
        {
          method: method.toUpperCase(),
          redirect: "manual",
          headers: {
            origin: "https://reader.example",
            "if-none-match": "*",
          },
        },
      );
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe(
        "/api/articles/%E8%A7%84%E8%8C%83%20slug",
      );
      expect(response.headers.get("location")).not.toContain("attacker");
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("cache-control")).toBe(
        "public, max-age=0, must-revalidate",
      );
      expect(response.headers.get("etag")).toBeNull();
      expect(await response.text()).toBe("");
    }
    expect(
      contract.components?.headers?.CanonicalArticleLocation,
    ).toMatchObject({
      description:
        "Origin-relative canonical Article detail URL. The normalized canonical slug is percent-encoded as exactly one path segment; no query or fragment is preserved.",
      schema: {
        type: "string",
        format: "uri-reference",
        pattern: "^/api/articles/(?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+$",
      },
    });
  }, 30_000);
});
