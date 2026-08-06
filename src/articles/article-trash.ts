/** Shared Trash purge confirmation rules (UI + Worker). */

export const purgeConfirmationPhrases = {
  en: "confirm delete",
  "zh-CN": "确认删除",
} as const;

const acceptedPurgeConfirmationPhrases = Object.values(
  purgeConfirmationPhrases,
);

export function purgeConfirmationMatches(input: {
  confirmationTitle: string;
}): boolean {
  const normalized = input.confirmationTitle.trim();
  if (normalized.length === 0) return false;
  return acceptedPurgeConfirmationPhrases.includes(
    normalized as (typeof acceptedPurgeConfirmationPhrases)[number],
  );
}
