import { env } from "cloudflare:workers";
import { getRequest } from "@tanstack/react-start/server";

import { applicationOriginForRequest } from "../env/origin.server";
import { validateRuntimeBindings } from "../env/runtime.server";
import type { RuntimeBindings } from "../env/runtime.server";
import { administratorInitialsFromEmail } from "./administrator-identity";
import type {
  Administrator,
  AdministratorIdentity,
} from "./administrator-identity";

export interface AdministratorSession {
  /** The signed-in Administrator, or `null` when the request has no session. */
  administrator: Administrator | null;
  /**
   * Headers Better Auth wants on the response. Empty unless a renewal
   * actually happened, so callers may merge them unconditionally.
   */
  headers: Headers;
}

/**
 * Resolves the Administrator Session for a request.
 *
 * Renewal is off by default: only the endpoint the admin shell polls should
 * extend a session, so an ordinary admin request cannot turn into a session
 * row write.
 */
export async function readAdministratorSession(
  bindings: RuntimeBindings,
  request: Request,
  options: { refresh?: boolean } = {},
): Promise<AdministratorSession> {
  // Better Auth drags in its Drizzle adapter, so keep it off the Worker's
  // initial evaluation path.
  const { createAuth } = await import("./auth.server");
  const { headers, response } = await createAuth(
    bindings,
    applicationOriginForRequest(bindings, request),
  ).api.getSession({
    headers: request.headers,
    query: { disableRefresh: !options.refresh },
    returnHeaders: true,
  });

  const user = response?.user;
  return {
    administrator: user?.email
      ? {
          id: user.id,
          email: user.email,
          initials: administratorInitialsFromEmail(user.email),
        }
      : null,
    headers: new Headers(headers),
  };
}

export async function readAdministratorIdentityFromRequest(): Promise<AdministratorIdentity> {
  const configuration = validateRuntimeBindings(env);
  if (!configuration.ok) {
    throw new Error("Validated Worker bindings are unavailable");
  }

  const { administrator } = await readAdministratorSession(
    configuration.bindings,
    getRequest(),
  );
  if (!administrator) {
    throw new Error("Administrator session unavailable");
  }

  return { email: administrator.email, initials: administrator.initials };
}
