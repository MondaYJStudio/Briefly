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

const publicResponseHeaders = {
  "Access-Control-Allow-Origin": {
    $ref: "#/components/headers/AccessControlAllowOrigin",
  },
  "Cache-Control": { $ref: "#/components/headers/CacheControl" },
  ETag: { $ref: "#/components/headers/ETag" },
} satisfies Record<string, OpenAPIV3_1.ReferenceObject>;

const articleUnavailableDescription =
  "The Article is unavailable; this response intentionally does not disclose why.";

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
  tags: [{ name: "Articles" }],
  paths: {
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
          description: "Current canonical Unicode Article slug.",
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
        summary: "Retrieve a Current Publication by canonical slug",
        description:
          "Returns the stored semantic HTML fragment. Media URLs in cover metadata and rendered HTML are absolute stable public references.",
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
          404: {
            description: articleUnavailableDescription,
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
    },
    schemas: {
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
    },
  },
} satisfies OpenAPIV3_1.Document;
