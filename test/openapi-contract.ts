import type { OpenAPIV3_1 } from "openapi-types";
import { expect } from "vitest";

export function responseSchema(
  document: OpenAPIV3_1.Document,
  path: string,
  method: "get" | "head",
  status: number,
) {
  const operation = document.paths?.[path]?.[method];
  if (!operation) throw new Error(`Missing ${method.toUpperCase()} ${path}`);
  const response = operation.responses?.[status];
  if (!response || "$ref" in response)
    throw new Error(`Missing inline ${status} response for ${method} ${path}`);
  const mediaType = response.content?.["application/json"];
  if (!mediaType?.schema)
    throw new Error(`Missing JSON schema for ${status} ${method} ${path}`);
  return mediaType.schema;
}

export function expectResponseMatchesContract(
  document: OpenAPIV3_1.Document,
  path: string,
  method: "get" | "head",
  status: number,
  value: unknown,
) {
  expect(
    jsonSchemaMatches(
      document,
      responseSchema(document, path, method, status),
      value,
    ),
  ).toBe(true);
}

export function jsonSchemaMatches(
  document: OpenAPIV3_1.Document,
  schema: OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject,
  value: unknown,
): boolean {
  if ("$ref" in schema) {
    const name = schema.$ref.match(/^#\/components\/schemas\/(.+)$/u)?.[1];
    const referenced = name ? document.components?.schemas?.[name] : undefined;
    return referenced ? jsonSchemaMatches(document, referenced, value) : false;
  }
  if (schema.enum && !schema.enum.some((candidate) => candidate === value)) {
    return false;
  }
  if (schema.oneOf) {
    return (
      schema.oneOf.filter((candidate) =>
        jsonSchemaMatches(document, candidate, value),
      ).length === 1
    );
  }
  if (schema.type === "null") return value === null;
  if (schema.type === "string") {
    if (typeof value !== "string") return false;
    if (schema.minLength !== undefined && value.length < schema.minLength)
      return false;
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      return false;
    if (schema.format === "uuid") {
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        value,
      );
    }
    if (schema.format === "date-time") return !Number.isNaN(Date.parse(value));
    if (schema.format === "uri") {
      try {
        new URL(value);
      } catch {
        return false;
      }
    }
    return true;
  }
  if (schema.type === "integer" || schema.type === "number") {
    if (
      typeof value !== "number" ||
      (schema.type === "integer" && !Number.isInteger(value))
    ) {
      return false;
    }
    if (schema.minimum !== undefined && value < schema.minimum) return false;
    if (schema.maximum !== undefined && value > schema.maximum) return false;
    return true;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return false;
    if (schema.minItems !== undefined && value.length < schema.minItems)
      return false;
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      return false;
    return schema.items
      ? value.every((item) => jsonSchemaMatches(document, schema.items!, item))
      : true;
  }
  if (schema.type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return false;
    const record = value as Record<string, unknown>;
    if (schema.required?.some((name) => !(name in record))) return false;
    const properties = schema.properties ?? {};
    if (
      schema.additionalProperties === false &&
      Object.keys(record).some((name) => !(name in properties))
    ) {
      return false;
    }
    return Object.entries(properties).every(
      ([name, propertySchema]) =>
        !(name in record) ||
        jsonSchemaMatches(document, propertySchema, record[name]),
    );
  }
  return true;
}
