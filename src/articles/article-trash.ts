/** Shared Trash purge confirmation rules (UI + Worker). */

export function expectedPurgeConfirmation(input: {
  articleId: string;
  title: string;
}): string {
  return input.title.length > 0 ? input.title : input.articleId;
}

export function purgeConfirmationMatches(input: {
  articleId: string;
  title: string;
  confirmationTitle: string;
}): boolean {
  if (input.confirmationTitle.length === 0) return false;
  return (
    input.confirmationTitle ===
    expectedPurgeConfirmation({
      articleId: input.articleId,
      title: input.title,
    })
  );
}
