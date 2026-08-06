import type { PublicationRestorationIssue } from "../../articles/publication-restoration";
import type {
  PublicationIssue,
  PublicationIssueCode,
} from "../../articles/publication-workflow";
import { m } from "../../paraglide/messages.js";

export type PublicationIssueSurface =
  | "title"
  | "slug"
  | "body"
  | "byline"
  | "language"
  | "cover"
  | "asset";

const publicationIssueSurfaceLabels: Record<
  PublicationIssueSurface,
  () => string
> = {
  title: () => m.title_label(),
  slug: () => m.issue_surface_slug(),
  body: () => m.issue_surface_body(),
  byline: () => m.issue_surface_byline(),
  language: () => m.issue_surface_language(),
  cover: () => m.cover_label(),
  asset: () => m.asset(),
};

const persistedFieldLabels: Record<string, () => string> = {
  version: () => m.pub_field_version(),
  title: () => m.pub_field_title(),
  slug: () => m.pub_field_slug(),
  summary: () => m.pub_field_summary(),
  tags: () => m.pub_field_tags(),
  byline: () => m.pub_field_byline(),
  language: () => m.pub_field_language(),
  cover: () => m.pub_field_cover(),
  document: () => m.pub_field_document(),
};

const publicationIssueByCode: Partial<
  Record<PublicationIssueCode, () => string>
> = {
  TITLE_REQUIRED: () => m.pub_issue_title_required(),
  SLUG_REQUIRED: () => m.pub_issue_slug_required(),
  BODY_REQUIRED: () => m.pub_issue_body_required(),
  BYLINE_INVALID: () => m.pub_issue_byline_invalid(),
  LANGUAGE_INVALID: () => m.pub_issue_language_invalid(),
  ASSET_NOT_RESOLVED: () => m.pub_issue_asset_not_resolved(),
  FIGURE_ALT_REQUIRED: () => m.pub_issue_figure_alt_required(),
  INVALID_ASSET_IDENTITY: () => m.pub_issue_invalid_asset_identity(),
  INVALID_ASSET_RESOLUTION: () => m.pub_issue_invalid_asset_resolution(),
  INVALID_COVER: () => m.pub_issue_invalid_cover(),
  INVALID_DOCUMENT: () => m.pub_issue_invalid_document(),
  INVALID_DOCUMENT_STRUCTURE: () => m.pub_issue_invalid_document_structure(),
  INVALID_HEADING_LEVEL: () => m.pub_issue_invalid_heading_level(),
  INVALID_NODE_ATTRIBUTES: () => m.pub_issue_invalid_node_attributes(),
  INVALID_PROVIDER_IDENTIFIER: () => m.pub_issue_invalid_provider_identifier(),
  UNSAFE_LINK: () => m.pub_issue_unsafe_link(),
  UNSUPPORTED_DOCUMENT_SCHEMA_VERSION: () =>
    m.pub_issue_unsupported_document_schema_version(),
  UNSUPPORTED_MARK: () => m.pub_issue_unsupported_mark(),
  UNSUPPORTED_NODE: () => m.pub_issue_unsupported_node(),
};

/** Maps known English server messages emitted under coarse legacy codes. */
const legacyPublicationMessageLocalizers: Record<string, () => string> = {
  "A title is required for publication.": () => m.pub_issue_title_required(),
  "A slug is required for publication.": () => m.pub_issue_slug_required(),
  "Substantive body content is required for publication.": () =>
    m.pub_issue_body_required(),
  "A valid Byline is required for publication.": () =>
    m.pub_issue_byline_invalid(),
  "A valid language is required for publication.": () =>
    m.pub_issue_language_invalid(),
  "A referenced Asset is unavailable for publication.": () =>
    m.pub_issue_asset_not_resolved(),
  "Alternative text is required for this figure.": () =>
    m.pub_issue_figure_alt_required(),
  "The saved Draft contains an invalid Asset identity.": () =>
    m.pub_issue_invalid_asset_identity(),
  "A referenced Asset has unsafe delivery facts.": () =>
    m.pub_issue_invalid_asset_resolution(),
  "The saved Draft cover is invalid.": () => m.pub_issue_invalid_cover(),
  "The saved Draft Document is invalid.": () => m.pub_issue_invalid_document(),
  "The saved Draft Document structure is invalid.": () =>
    m.pub_issue_invalid_document_structure(),
  "The saved Draft contains an invalid heading level.": () =>
    m.pub_issue_invalid_heading_level(),
  "The saved Draft contains invalid Document attributes.": () =>
    m.pub_issue_invalid_node_attributes(),
  "The saved Draft contains an invalid video identifier.": () =>
    m.pub_issue_invalid_provider_identifier(),
  "The saved Draft contains an unsafe link.": () => m.pub_issue_unsafe_link(),
  "The saved Draft uses an unsupported Document Schema Version.": () =>
    m.pub_issue_unsupported_document_schema_version(),
  "The saved Draft contains an unsupported Document mark.": () =>
    m.pub_issue_unsupported_mark(),
  "The saved Draft contains an unsupported Document node.": () =>
    m.pub_issue_unsupported_node(),
};

function isCoarsePublicationIssueCode(code: PublicationIssueCode): boolean {
  return (
    code === "REQUIRED" ||
    code === "INVALID" ||
    code === "UNSUPPORTED" ||
    code === "UNSAFE" ||
    code === "UNAVAILABLE"
  );
}

const draftValidationMessages: Record<string, () => string> = {
  "Use an HTTP or HTTPS URL.": () => m.draft_issue_http_https_url(),
  "Use a valid BCP 47 language tag, such as en or zh-Hans.": () =>
    m.draft_issue_bcp47_language(),
  "A cover must reference an existing internal Asset.": () =>
    m.draft_issue_cover_asset(),
  "A cover requires meaningful alternative text.": () =>
    m.draft_issue_cover_alt(),
  "Referenced Asset must exist and be ready.": () =>
    m.draft_issue_referenced_asset(),
  "Enter a slug or leave it absent.": () => m.draft_issue_slug_or_absent(),
  "Slug must contain only well-formed Unicode.": () =>
    m.draft_issue_slug_unicode(),
  "Slug cannot contain control characters.": () => m.draft_issue_slug_control(),
  "Slug cannot contain path-reserved characters.": () =>
    m.draft_issue_slug_path_reserved(),
  "Slug cannot be a URL dot path segment.": () =>
    m.draft_issue_slug_dot_segment(),
  "Code block language must be a short language identifier.": () =>
    m.draft_issue_code_block_language(),
  "A non-decorative figure requires alternative text.": () =>
    m.draft_issue_figure_alt(),
  "Document content does not satisfy the Article schema.": () =>
    m.draft_issue_document_schema(),
};

const assetValidationMessages: Record<string, () => string> = {
  "Use a filename without control characters, up to 255 characters.": () =>
    m.asset_issue_filename(),
  "Upload an image no larger than 8 MiB.": () => m.asset_issue_size(),
  "The declared image type must match verified image bytes.": () =>
    m.asset_issue_type_mismatch(),
  "Image dimensions must be at most 8192 px per side and 8388608 pixels total.":
    () => m.asset_issue_dimensions(),
  "Decoded image dimensions do not match its container.": () =>
    m.asset_issue_dimension_mismatch(),
  "The image pixel data could not be decoded.": () =>
    m.asset_issue_decode_failed(),
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

function persistedFieldLabel(path: string): string {
  const field = path.startsWith("draft.") ? path.slice("draft.".length) : path;
  const root = field.split(".")[0] ?? field;
  return persistedFieldLabels[root]?.() ?? root;
}

/**
 * Localizes a Publication Issue by its stable `code`. Custom mock messages that
 * use coarse legacy codes intentionally keep the provided English text so UI
 * fixtures can assert on deliberate copy.
 */
export function localizePublicationIssue(issue: PublicationIssue): string {
  if (issue.code === "PERSISTED_FIELD_INVALID") {
    return m.pub_issue_persisted_field_invalid({
      field: persistedFieldLabel(issue.path),
    });
  }

  if (!isCoarsePublicationIssueCode(issue.code)) {
    return publicationIssueByCode[issue.code]?.() ?? issue.message;
  }

  const fromLegacyMessage = legacyPublicationMessageLocalizers[issue.message];
  if (fromLegacyMessage) return fromLegacyMessage();

  if (
    issue.message.startsWith("The saved Draft ") &&
    issue.message.endsWith(" is invalid.")
  ) {
    return m.pub_issue_persisted_field_invalid({
      field: persistedFieldLabel(issue.path),
    });
  }

  // Deliberate UI mock / unknown payload — preserve the provided message.
  return issue.message;
}

export function publicationIssueGuidance(issue: PublicationIssue): string {
  const localized = localizePublicationIssue(issue);
  const surface = publicationIssueSurface(issue.path);
  return surface
    ? m.publication_issue_with_surface({
        surface: publicationIssueSurfaceLabels[surface](),
        message: localized,
      })
    : localized;
}

export function localizeRestorationIssue(
  issue: PublicationRestorationIssue,
): string {
  switch (issue.code) {
    case "UNSUPPORTED_DOCUMENT_SCHEMA_VERSION": {
      const match =
        /^Publication Document Schema Version (\d+) cannot be migrated safely$/.exec(
          issue.message,
        );
      return match
        ? m.restore_issue_unsupported_schema({ version: match[1]! })
        : m.restore_issue_unsupported_schema({ version: "?" });
    }
    case "DOCUMENT_SCHEMA_VERSION_MISMATCH":
      return m.restore_issue_schema_mismatch();
    case "PUBLICATION_DOCUMENT_INVALID":
      return m.restore_issue_document_invalid();
    case "PUBLICATION_DOCUMENT_NON_CANONICAL":
      return m.restore_issue_document_non_canonical();
    case "PUBLICATION_COVER_INVALID":
      return m.restore_issue_cover_invalid();
    case "PUBLICATION_COVER_ASSET_UNRESOLVED":
      return m.restore_issue_cover_asset_unresolved();
    case "PUBLICATION_METADATA_INVALID":
      return m.restore_issue_metadata_invalid();
    case "PUBLICATION_ASSET_REFERENCES_INVALID":
      return m.restore_issue_asset_references_invalid();
    default:
      return issue.message || m.restore_issue_generic();
  }
}

/** Localizes Draft-save and Asset-upload validation messages by English text. */
export function localizeServerIssueMessage(message: string): string {
  return (
    draftValidationMessages[message]?.() ??
    assetValidationMessages[message]?.() ??
    message
  );
}
