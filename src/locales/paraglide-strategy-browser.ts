import { defineCustomClientStrategy } from "../paraglide/runtime.js";
import { canonicalizeAppLocale } from "./registry";
import { matchOrderedAppLocales } from "./matcher";
import {
  isReservedApplicationPath,
  normalizeLocalePathUrl,
} from "./locale-path";
import { localeFromCookieHeader, localeFromRequestUrl } from "./request";

/**
 * Keep hydration lightweight: the server's shared resolver handles the full
 * Negotiator/FormatJS policy, while the SSR `<html lang>` and persisted cookie
 * carry that decision into the browser. The small browser fallback only runs
 * for a client-rendered document that has neither signal.
 */
defineCustomClientStrategy("custom-accept-language", {
  getLocale() {
    // This module is imported by the SSR root as well as the browser bundle.
    // Node 24 exposes a global `navigator`, so checking it alone would make
    // the server try to construct a relative Request outside a browser.
    if (typeof window === "undefined" || typeof navigator === "undefined")
      return undefined;
    const languages = navigator.languages?.length
      ? navigator.languages
      : navigator.language
        ? [navigator.language]
        : [];
    try {
      const request = new Request(
        globalThis.location?.href ?? "http://localhost/",
      );
      const fromUrl = localeFromRequestUrl(request);
      if (fromUrl && !isReservedApplicationPath(new URL(request.url).pathname))
        return fromUrl;
    } catch {
      // A malformed location should not prevent the shell from hydrating.
    }

    const fromCookie = localeFromCookieHeader(
      typeof document === "undefined" ? undefined : document.cookie,
    );
    if (fromCookie) return fromCookie;

    // If this is an SSR document, its lang is the server's negotiated
    // snapshot. Prefer it only after an explicit cookie so a manual choice
    // made in another tab can take effect without a full navigation.
    const fromDocument =
      typeof document === "undefined"
        ? undefined
        : canonicalizeAppLocale(document.documentElement?.lang ?? "");
    return fromDocument ?? matchOrderedAppLocales(languages);
  },
  // The generated URL strategy only knows canonical project locales. Upgrade
  // a legacy/case-variant prefix in place before it computes the destination,
  // otherwise switching from `/zh-CN/articles` could produce the duplicated
  // path `/zh-Hant/zh-CN/articles`.
  setLocale() {
    if (typeof window === "undefined" || !window.location?.href) return;
    try {
      const current = new URL(window.location.href);
      const normalized = normalizeLocalePathUrl(current);
      if (normalized.href !== current.href) {
        window.history.replaceState(window.history.state, "", normalized.href);
      }
    } catch {
      // The built-in strategies remain available if browser history is locked.
    }
  },
});
