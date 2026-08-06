import { env } from "cloudflare:workers";
import { getRequest } from "@tanstack/react-start/server";

import { applicationOriginForRequest } from "../env/origin.server";
import { validateRuntimeBindings } from "../env/runtime.server";
import { administratorInitialsFromEmail } from "./administrator-identity";
import { createAuth } from "./auth.server";

export async function readAdministratorIdentityFromRequest(): Promise<{
  email: string;
  initials: string;
}> {
  const request = getRequest();
  const configuration = validateRuntimeBindings(env);
  if (!configuration.ok) {
    throw new Error("Validated Worker bindings are unavailable");
  }

  const session = await createAuth(
    configuration.bindings,
    applicationOriginForRequest(configuration.bindings, request),
  ).api.getSession({
    headers: request.headers,
    query: { disableRefresh: true },
  });

  const email = session?.user?.email;
  if (!email) {
    throw new Error("Administrator session unavailable");
  }

  return {
    email,
    initials: administratorInitialsFromEmail(email),
  };
}
