import { createServerFn } from "@tanstack/react-start";

import type { AdministratorIdentity } from "../components/admin/admin-shell";

/**
 * SSR-safe Administrator identity for the admin shell. Runs only on the
 * server so Better Auth can read the incoming session cookie.
 */
export const loadAdministratorIdentity = createServerFn({
  method: "GET",
}).handler(async (): Promise<AdministratorIdentity> => {
  const { readAdministratorIdentityFromRequest } = await import(
    "./administrator-session.server"
  );
  return readAdministratorIdentityFromRequest();
});
