export type SlugFollowMode = "auto" | "manual";

export interface SlugFollowState {
  mode: SlugFollowMode;
  slug: string | null;
}

/** NFC + trim Title into a candidate Slug. Empty Title produces no value. */
export function deriveSlugFromTitle(title: string): string | null {
  const normalized = title.normalize("NFC").trim();
  return normalized.length === 0 ? null : normalized;
}

export function slugAfterTitleChange(
  state: SlugFollowState,
  title: string,
): SlugFollowState {
  if (state.mode === "manual") return state;
  return { mode: "auto", slug: deriveSlugFromTitle(title) };
}

export function slugAfterManualEdit(value: string): SlugFollowState {
  const normalized = value.normalize("NFC").trim();
  return {
    mode: "manual",
    slug: normalized.length === 0 ? null : normalized,
  };
}

export function slugAfterReset(title: string): SlugFollowState {
  return { mode: "auto", slug: deriveSlugFromTitle(title) };
}
