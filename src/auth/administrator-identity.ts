/**
 * Stable avatar initials for the sole Administrator, derived from the
 * sign-in email local part (never from prototype fixture names).
 */
export function administratorInitialsFromEmail(email: string): string {
  const local = email.split("@", 1)[0] ?? "";
  const parts = local.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase();
  }
  const alnum = local.replace(/[^a-zA-Z0-9]/g, "");
  return (alnum.slice(0, 2) || "?").toUpperCase();
}
