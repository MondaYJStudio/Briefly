/** The sole Administrator, as identified by a resolved Administrator Session. */
export interface Administrator {
  id: string;
  email: string;
  initials: string;
}

/** The subset of an Administrator the admin shell presents. */
export type AdministratorIdentity = Pick<Administrator, "email" | "initials">;

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

/**
 * Display-safe form of the sign-in email for the identity menu: keeps the
 * first character of the local part and the domain, e.g. `a***@example.com`.
 */
export function maskAdministratorEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;
  return `${email[0]!}***${email.slice(at)}`;
}
