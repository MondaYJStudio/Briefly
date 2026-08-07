/** Shared Trash purge confirmation rules (UI + Worker). */

export const purgeConfirmationPhrases = {
  en: "confirm delete",
  "zh-Hans": "确认删除",
  "zh-Hant": "確認刪除",
  ja: "削除を確認",
  ko: "삭제 확인",
  // Compatibility with data/tests written before the registry used zh-Hans.
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
