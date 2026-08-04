export interface PublicationRestorationIssue {
  code: string;
  path: string;
  message: string;
}

export function isPublicationRestorationIssue(
  value: unknown,
): value is PublicationRestorationIssue {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string" &&
    "path" in value &&
    typeof value.path === "string" &&
    "message" in value &&
    typeof value.message === "string"
  );
}
