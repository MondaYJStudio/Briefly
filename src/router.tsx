import { createRouter } from "@tanstack/react-router";

import {
  isReservedApplicationPath,
  normalizeLocalePathUrl,
} from "./locales/locale-path";
import { deLocalizeUrl, localizeUrl, locales } from "./paraglide/runtime.js";
import { routeTree } from "./routeTree.gen";

function rewriteInputUrl(url: URL): URL {
  const normalizedUrl = normalizeLocalePathUrl(url);
  const firstSegment = normalizedUrl.pathname.split("/")[1];
  if (
    (locales as readonly string[]).some(
      (locale) => locale.toLowerCase() === firstSegment?.toLowerCase(),
    )
  ) {
    return deLocalizeUrl(normalizedUrl);
  }
  return url;
}

function rewriteOutputUrl(url: URL): URL {
  if (isReservedApplicationPath(url.pathname)) {
    return url;
  }
  return localizeUrl(url);
}

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    rewrite: {
      input: ({ url }) => rewriteInputUrl(url),
      output: ({ url }) => rewriteOutputUrl(url),
    },
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
