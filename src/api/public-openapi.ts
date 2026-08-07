import type { OpenAPIV3_1 } from "openapi-types";

import {
  ARTICLE_SLUG_MAXIMUM_LENGTH,
  ARTICLE_TAG_MAXIMUM_LENGTH,
  ARTICLE_TAGS_MAXIMUM_COUNT,
} from "../articles/articles";
import {
  PUBLIC_ARTICLE_LIST_DEFAULT_PAGE_SIZE,
  PUBLIC_ARTICLE_LIST_MAXIMUM_PAGE_SIZE,
} from "../articles/publications.server";
import { APP_LOCALES } from "../locales/registry";

const publicResponseHeaders = {
  "Access-Control-Allow-Origin": {
    $ref: "#/components/headers/AccessControlAllowOrigin",
  },
  "Cache-Control": { $ref: "#/components/headers/CacheControl" },
  ETag: { $ref: "#/components/headers/ETag" },
} satisfies Record<string, OpenAPIV3_1.ReferenceObject>;

const siteResponseHeaders = {
  ...publicResponseHeaders,
  "Content-Language": { $ref: "#/components/headers/ContentLanguage" },
  Vary: { $ref: "#/components/headers/Vary" },
} satisfies Record<string, OpenAPIV3_1.ReferenceObject>;

const siteLocaleParameters = [
  {
    name: "Accept-Language",
    in: "header",
    required: false,
    description:
      "Optional ordered language ranges. The server applies the canonical Application Locale Registry and falls back to English when no range matches.",
    schema: { type: "string" },
  },
  {
    name: "Cookie",
    in: "header",
    required: false,
    description:
      "Optional PARAGLIDE_LOCALE preference cookie. It takes precedence over Accept-Language when the request has no locale URL prefix.",
    schema: { type: "string" },
  },
] satisfies OpenAPIV3_1.ParameterObject[];

const canonicalRedirectHeaders = {
  "Access-Control-Allow-Origin":
    publicResponseHeaders["Access-Control-Allow-Origin"],
  "Cache-Control": publicResponseHeaders["Cache-Control"],
  Location: { $ref: "#/components/headers/CanonicalArticleLocation" },
} satisfies Record<string, OpenAPIV3_1.ReferenceObject>;

const articleUnavailableDescription =
  "The Article is unavailable; this response intentionally does not disclose why.";
const canonicalRedirectDescription =
  "The requested formerly public slug permanently redirects to the Current Publication's canonical detail URL.";
const purgedArticleDescription =
  "The normalized slug is permanently reserved because its Article was purged.";

const listParameters = [
  {
    name: "cursor",
    in: "query",
    required: false,
    description:
      "Opaque continuation cursor returned as nextCursor by the preceding page. A malformed cursor or an anchor that is no longer current is rejected.",
    schema: { type: "string", minLength: 1 },
  },
  {
    name: "limit",
    in: "query",
    required: false,
    description: `Page size. Defaults to ${PUBLIC_ARTICLE_LIST_DEFAULT_PAGE_SIZE} and cannot exceed ${PUBLIC_ARTICLE_LIST_MAXIMUM_PAGE_SIZE}.`,
    schema: {
      type: "integer",
      minimum: 1,
      maximum: PUBLIC_ARTICLE_LIST_MAXIMUM_PAGE_SIZE,
      default: PUBLIC_ARTICLE_LIST_DEFAULT_PAGE_SIZE,
    },
  },
  {
    name: "tag",
    in: "query",
    required: false,
    description: `One tag. Unicode is normalized to NFC, surrounding whitespace is removed, internal whitespace is collapsed, and casing is normalized exactly as Draft metadata is normalized. The normalized result cannot exceed ${ARTICLE_TAG_MAXIMUM_LENGTH} characters. Multiple tag expressions are not supported.`,
    schema: { type: "string", minLength: 1 },
  },
] satisfies OpenAPIV3_1.ParameterObject[];

const articleMetadataProperties = {
  id: {
    type: "string",
    format: "uuid",
    description: "Stable opaque Article ID.",
  },
  slug: {
    type: "string",
    description: "Current canonical Unicode slug.",
  },
  title: { type: "string" },
  summary: {
    oneOf: [{ type: "string" }, { type: "null" }],
    description: "Authored summary, or null when no summary was authored.",
  },
  tags: {
    type: "array",
    items: { type: "string" },
    maxItems: ARTICLE_TAGS_MAXIMUM_COUNT,
  },
  byline: { $ref: "#/components/schemas/Byline" },
  language: {
    type: "string",
    description: "Canonical BCP 47 language tag resolved at publication time.",
  },
  cover: {
    oneOf: [{ $ref: "#/components/schemas/Cover" }, { type: "null" }],
  },
  publishedAt: {
    type: "string",
    format: "date-time",
    description: "Time of the Article's first successful Publication.",
  },
  updatedAt: {
    type: "string",
    format: "date-time",
    description: "Publish time of the Current Publication.",
  },
} satisfies Record<
  string,
  OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject
>;

const articleMetadataRequired = [
  "id",
  "slug",
  "title",
  "summary",
  "tags",
  "byline",
  "language",
  "cover",
  "publishedAt",
  "updatedAt",
];

export const publicOpenApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Briefly Public Content API",
    version: "0.0.0",
    description:
      "Anonymous, unversioned access to Current Publications. Drafts, authentication data, ProseMirror JSON, old Publications, and trashed state are never part of this contract.",
  },
  servers: [{ url: "/", description: "Current Briefly origin" }],
  security: [],
  tags: [{ name: "Articles" }, { name: "Site" }],
  paths: {
    "/api/site": {
      get: {
        tags: ["Site"],
        operationId: "getSiteSettings",
        summary: "Read public Site Settings",
        description:
          "Returns the site's public identity: name, the description selected from the canonical locale registry, all configured description translations, default Byline, and default language. Draft-only or administrative settings are never part of this contract.",
        parameters: siteLocaleParameters,
        responses: {
          200: {
            description: "The public Site Settings.",
            headers: siteResponseHeaders,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SiteSettings" },
              },
            },
          },
          304: {
            description:
              "The Site Settings are unchanged for the supplied If-None-Match value.",
            headers: siteResponseHeaders,
          },
        },
      },
      head: {
        tags: ["Site"],
        operationId: "headSiteSettings",
        summary: "Read Site Settings metadata without a response body",
        parameters: siteLocaleParameters,
        responses: {
          200: {
            description: "The Site Settings exist; the body is omitted.",
            headers: siteResponseHeaders,
          },
          304: {
            description: "The Site Settings are unchanged.",
            headers: siteResponseHeaders,
          },
        },
      },
    },
    "/api/articles": {
      get: {
        tags: ["Articles"],
        operationId: "listArticles",
        summary: "List Current Publications",
        description:
          "Returns Current Publications ordered by first Published At descending and stable Article ID ascending. List items omit Publication HTML and all source content.",
        parameters: listParameters,
        responses: {
          200: {
            description: "A deterministic page of current Articles.",
            headers: publicResponseHeaders,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ArticleListPage" },
              },
            },
          },
          304: {
            description:
              "The selected page is unchanged for the supplied If-None-Match value.",
            headers: publicResponseHeaders,
          },
          400: {
            description:
              "The list query, opaque cursor encoding, or cursor anchor is invalid.",
            headers: {
              "Access-Control-Allow-Origin":
                publicResponseHeaders["Access-Control-Allow-Origin"],
              "Cache-Control": publicResponseHeaders["Cache-Control"],
            },
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ArticleListError" },
              },
            },
          },
        },
      },
      head: {
        tags: ["Articles"],
        operationId: "headArticleList",
        summary: "Read list metadata without a response body",
        parameters: listParameters,
        responses: {
          200: {
            description: "The selected page exists; the body is omitted.",
            headers: publicResponseHeaders,
          },
          304: {
            description: "The selected page is unchanged.",
            headers: publicResponseHeaders,
          },
          400: {
            description: "The list query or cursor is invalid.",
            headers: {
              "Access-Control-Allow-Origin":
                publicResponseHeaders["Access-Control-Allow-Origin"],
              "Cache-Control": publicResponseHeaders["Cache-Control"],
            },
          },
        },
      },
    },
    "/api/articles/{slug}": {
      parameters: [
        {
          name: "slug",
          in: "path",
          required: true,
          description:
            "Current canonical or formerly public Unicode Article slug. Claim lookup trims and NFC-normalizes the input, lowercases it with the locale-independent und locale, then NFC-normalizes the key again.",
          schema: {
            type: "string",
            minLength: 1,
            maxLength: ARTICLE_SLUG_MAXIMUM_LENGTH,
          },
        },
      ],
      get: {
        tags: ["Articles"],
        operationId: "getArticleBySlug",
        summary: "Retrieve or locate a Current Publication by slug",
        description:
          "A canonical slug returns the stored semantic HTML fragment. A formerly public slug redirects permanently to the current canonical detail URL. Media URLs in cover metadata and rendered HTML are absolute stable public references.",
        responses: {
          200: {
            description: "The Current Publication.",
            headers: publicResponseHeaders,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ArticleDetail" },
              },
            },
          },
          304: {
            description: "The Current Publication is unchanged.",
            headers: publicResponseHeaders,
          },
          308: {
            description: canonicalRedirectDescription,
            headers: canonicalRedirectHeaders,
          },
          404: {
            description: articleUnavailableDescription,
            headers: {
              "Access-Control-Allow-Origin":
                publicResponseHeaders["Access-Control-Allow-Origin"],
              "Cache-Control": publicResponseHeaders["Cache-Control"],
            },
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ArticleNotFoundError" },
              },
            },
          },
          410: {
            description: purgedArticleDescription,
            headers: {
              "Access-Control-Allow-Origin":
                publicResponseHeaders["Access-Control-Allow-Origin"],
              "Cache-Control": publicResponseHeaders["Cache-Control"],
            },
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ArticleGoneError" },
              },
            },
          },
        },
      },
      head: {
        tags: ["Articles"],
        operationId: "headArticleBySlug",
        summary: "Read Article metadata without a response body",
        responses: {
          200: {
            description: "The Current Publication exists; the body is omitted.",
            headers: publicResponseHeaders,
          },
          304: {
            description: "The Current Publication is unchanged.",
            headers: publicResponseHeaders,
          },
          308: {
            description: canonicalRedirectDescription,
            headers: canonicalRedirectHeaders,
          },
          404: {
            description: articleUnavailableDescription,
            headers: {
              "Access-Control-Allow-Origin":
                publicResponseHeaders["Access-Control-Allow-Origin"],
              "Cache-Control": publicResponseHeaders["Cache-Control"],
            },
          },
          410: {
            description: purgedArticleDescription,
            headers: {
              "Access-Control-Allow-Origin":
                publicResponseHeaders["Access-Control-Allow-Origin"],
              "Cache-Control": publicResponseHeaders["Cache-Control"],
            },
          },
        },
      },
    },
  },
  components: {
    headers: {
      AccessControlAllowOrigin: {
        description: "Public content may be read from any origin.",
        schema: { type: "string", enum: ["*"] },
      },
      CacheControl: {
        description:
          "Shared caches must revalidate so publication changes are visible immediately.",
        schema: {
          type: "string",
          enum: ["public, max-age=0, must-revalidate"],
        },
      },
      ETag: {
        description: "Deterministic strong entity tag for this representation.",
        schema: { type: "string" },
      },
      ContentLanguage: {
        description:
          "The canonical locale that supplied the localized site description.",
        schema: { type: "string", enum: [...APP_LOCALES] },
      },
      Vary: {
        description:
          "Request headers that participate in selecting the representation.",
        schema: { type: "string", enum: ["Accept-Language, Cookie"] },
      },
      CanonicalArticleLocation: {
        description:
          "Origin-relative canonical Article detail URL. The normalized canonical slug is percent-encoded as exactly one path segment; no query or fragment is preserved.",
        schema: {
          type: "string",
          format: "uri-reference",
          pattern: "^/api/articles/(?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+$",
        },
      },
    },
    schemas: {
      SiteSettings: {
        type: "object",
        additionalProperties: false,
        required: [
          "siteName",
          "siteDescription",
          "siteDescriptions",
          "siteDescriptionLocale",
          "defaultByline",
          "defaultLanguage",
        ],
        properties: {
          siteName: { type: "string", minLength: 1 },
          siteDescription: {
            oneOf: [{ type: "string" }, { type: "null" }],
          },
          siteDescriptions: {
            type: "object",
            additionalProperties: false,
            required: ["en", "zh-Hans", "zh-Hant", "ja", "ko"],
            properties: {
              en: { oneOf: [{ type: "string" }, { type: "null" }] },
              "zh-Hans": {
                oneOf: [{ type: "string" }, { type: "null" }],
              },
              "zh-Hant": {
                oneOf: [{ type: "string" }, { type: "null" }],
              },
              ja: { oneOf: [{ type: "string" }, { type: "null" }] },
              ko: { oneOf: [{ type: "string" }, { type: "null" }] },
            },
            description:
              "Localized descriptions keyed by the canonical application locale.",
          },
          siteDescriptionLocale: {
            type: "string",
            enum: [...APP_LOCALES],
            description:
              "Locale selected for the siteDescription compatibility projection.",
          },
          defaultByline: { $ref: "#/components/schemas/Byline" },
          defaultLanguage: {
            type: "string",
            description: "Default BCP 47 language tag for Publications.",
          },
        },
      },
      Byline: {
        type: "object",
        additionalProperties: false,
        required: ["name", "url"],
        properties: {
          name: { type: "string", minLength: 1 },
          url: {
            oneOf: [{ type: "string", format: "uri" }, { type: "null" }],
          },
        },
      },
      Cover: {
        type: "object",
        additionalProperties: false,
        required: ["url", "width", "height", "alt"],
        properties: {
          url: {
            type: "string",
            format: "uri",
            description: "Absolute stable public Asset URL.",
          },
          width: { type: "integer", minimum: 1 },
          height: { type: "integer", minimum: 1 },
          alt: { type: "string", minLength: 1 },
        },
      },
      ArticleListItem: {
        type: "object",
        additionalProperties: false,
        required: articleMetadataRequired,
        properties: articleMetadataProperties,
      },
      ArticleDetail: {
        type: "object",
        additionalProperties: false,
        required: [...articleMetadataRequired, "html"],
        properties: {
          ...articleMetadataProperties,
          html: {
            type: "string",
            description:
              "Stored semantic HTML fragment for the Current Publication; never ProseMirror JSON.",
          },
        },
      },
      ArticleListPage: {
        type: "object",
        additionalProperties: false,
        required: ["items", "nextCursor"],
        properties: {
          items: {
            type: "array",
            items: { $ref: "#/components/schemas/ArticleListItem" },
            maxItems: PUBLIC_ARTICLE_LIST_MAXIMUM_PAGE_SIZE,
          },
          nextCursor: {
            oneOf: [{ type: "string", minLength: 1 }, { type: "null" }],
          },
        },
      },
      ArticleListError: {
        type: "object",
        additionalProperties: false,
        required: ["status", "code"],
        properties: {
          status: { type: "string", enum: ["error"] },
          code: {
            type: "string",
            enum: [
              "ARTICLE_LIST_QUERY_INVALID",
              "ARTICLE_LIST_CURSOR_INVALID",
              "ARTICLE_LIST_CURSOR_STALE",
            ],
          },
        },
      },
      ArticleNotFoundError: {
        type: "object",
        additionalProperties: false,
        required: ["status", "code"],
        properties: {
          status: { type: "string", enum: ["error"] },
          code: {
            type: "string",
            enum: ["ARTICLE_NOT_FOUND"],
            description:
              "Generic unavailable code shared by unknown, Draft-only, unpublished, and other non-public Articles.",
          },
        },
      },
      ArticleGoneError: {
        type: "object",
        additionalProperties: false,
        required: ["status", "code"],
        properties: {
          status: { type: "string", enum: ["error"] },
          code: {
            type: "string",
            enum: ["ARTICLE_GONE"],
            description:
              "The normalized slug is a minimal permanent tombstone and no Article content is retained.",
          },
        },
      },
    },
  },
} satisfies OpenAPIV3_1.Document;
