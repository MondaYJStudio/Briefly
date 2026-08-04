import type { PublicationIssue } from "../../articles/publication-workflow";

export type PublicationIssueSurface =
  "title" | "slug" | "body" | "byline" | "language" | "cover" | "asset";

const publicationIssueSurfaceLabels: Record<PublicationIssueSurface, string> = {
  title: "Title",
  slug: "Slug",
  body: "Body",
  byline: "Byline",
  language: "Language",
  cover: "Cover",
  asset: "Asset",
};

function pathIsAtOrBelow(path: string, field: string): boolean {
  return path === field || path.startsWith(`${field}.`);
}

/**
 * Maps the Workflow's stable Draft-domain paths to administrator authoring
 * surfaces. Unknown future paths deliberately have no behavioral mapping;
 * their server-provided message remains the human-readable fallback.
 */
export function publicationIssueSurface(
  path: string,
): PublicationIssueSurface | null {
  if (pathIsAtOrBelow(path, "draft.title")) return "title";
  if (pathIsAtOrBelow(path, "draft.slug")) return "slug";
  if (pathIsAtOrBelow(path, "draft.document")) return "body";
  if (pathIsAtOrBelow(path, "draft.byline")) return "byline";
  if (pathIsAtOrBelow(path, "draft.language")) return "language";
  if (pathIsAtOrBelow(path, "draft.cover")) return "cover";
  if (
    pathIsAtOrBelow(path, "draft.assets") ||
    pathIsAtOrBelow(path, "draft.asset")
  ) {
    return "asset";
  }
  return null;
}

export function publicationIssuesForSurface(
  issues: PublicationIssue[],
  surface: PublicationIssueSurface,
): PublicationIssue[] {
  return issues.filter(
    (issue) => publicationIssueSurface(issue.path) === surface,
  );
}

export function publicationIssueGuidance(issue: PublicationIssue): string {
  const surface = publicationIssueSurface(issue.path);
  return surface
    ? `${publicationIssueSurfaceLabels[surface]}: ${issue.message}`
    : issue.message;
}
