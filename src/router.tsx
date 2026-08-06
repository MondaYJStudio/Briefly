import { createRouter } from "@tanstack/react-router";

import { deLocalizeUrl, localizeUrl } from "./paraglide/runtime.js";
import { routeTree } from "./routeTree.gen";

function isPrivatePath(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/media/") ||
    pathname === "/health"
  );
}

function rewriteInputUrl(url: URL): URL {
  if (url.pathname === "/zh-CN" || url.pathname.startsWith("/zh-CN/")) {
    return deLocalizeUrl(url);
  }
  return url;
}

function rewriteOutputUrl(url: URL): URL {
  if (isPrivatePath(url.pathname)) {
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
