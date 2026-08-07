import { describe, expect, it } from "vitest";

import {
  APP_LOCALE_OPTIONS,
  APP_LOCALES,
  COOKIE_NAME,
  canonicalizeAppLocale,
  localeFromRequestCookie,
  localeFromRequestUrl,
  mergeVary,
  normalizeLocalePathUrl,
  resolveAcceptLanguage,
  resolveSiteLocale,
  selectLocalizedValue,
} from "../src/locales/locale";
import { matchOrderedAppLocales } from "../src/locales/matcher";

function request(
  url = "https://briefly.test/",
  headers?: Record<string, string>,
): Request {
  return new Request(url, { headers });
}

describe("application locale registry", () => {
  it("contains the canonical locale set and labels", () => {
    expect(APP_LOCALES).toEqual(["en", "zh-Hans", "zh-Hant", "ja", "ko"]);
    expect(APP_LOCALE_OPTIONS.map(({ id }) => id)).toEqual([...APP_LOCALES]);
  });

  it.each([
    ["en", "en"],
    ["EN", "en"],
    ["zh-CN", "zh-Hans"],
    ["zh-cn", "zh-Hans"],
    ["zh-Hant", "zh-Hant"],
    ["JA-jp", undefined],
    ["ko-KR", undefined],
    ["en-US", undefined],
    ["not-a-locale", undefined],
    ["*", undefined],
    [null, undefined],
  ] as const)("canonicalizes %s as %s", (input, expected) => {
    expect(canonicalizeAppLocale(input)).toBe(expected);
  });

  it("keeps a subset fallback inside the supplied available locales", () => {
    expect(matchOrderedAppLocales(["fr"], ["ja"], "en")).toBe("ja");
  });
});

describe("Accept-Language negotiation", () => {
  it("uses quality ordering and script-aware best fit", () => {
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "ja;q=0.2, zh-TW;q=0.9, en;q=0.5",
        }),
      ),
    ).toBe("zh-Hant");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "zh-HK, zh;q=0.9",
        }),
      ),
    ).toBe("zh-Hant");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "en-US;q=0.4, ja;q=0.3",
        }),
      ),
    ).toBe("en");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "und;q=0.9, ja;q=0.8",
        }),
      ),
    ).toBe("ja");

    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.5",
        }),
      ),
    ).toBe("zh-Hans");

    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "en; Q = 0.1, ja; q = 0.9",
        }),
      ),
    ).toBe("ja");

    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "en;q=2, ja;q=0.5",
        }),
      ),
    ).toBe("ja");
  });

  it("ignores zero-quality, wildcard, and malformed preferences", () => {
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "fr;q=0, *;q=0.8, garbage;q=0.7",
        }),
      ),
    ).toBe("en");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "ja;q=0",
        }),
      ),
    ).toBe("en");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "*, ja;q=0.1",
        }),
      ),
    ).toBe("en");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "ja;q=0.9, *;q=0.8",
        }),
      ),
    ).toBe("ja");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "en;q=0.5, *;q=0.8",
        }),
      ),
    ).not.toBe("en");

    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "ja;q=0, *;q=0.8",
        }),
        ["ja", "en"],
        "ja",
      ),
    ).toBe("en");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "ja;q=0,JA;q=1",
        }),
      ),
    ).toBe("ja");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "zh-CN;q=0, zh-Hans;q=1",
        }),
      ),
    ).toBe("zh-Hans");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "zh;q=0, zh-Hans;q=1, *;q=0.8",
        }),
      ),
    ).toBe("zh-Hans");

    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "zh-CN;q=0, *;q=0.8",
        }),
      ),
    ).not.toBe("zh-Hans");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "zh-TW;q=0, *;q=0.8",
        }),
      ),
    ).not.toBe("zh-Hant");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "zh-TW;q=0, zh-Hant;q=1, *;q=0.8",
        }),
      ),
    ).toBe("zh-Hant");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "zh-TW;q=0, zh-Hans;q=1, *;q=0.8",
        }),
      ),
    ).not.toBe("zh-Hant");

    // A broad zero-quality range must not be resurrected by FormatJS's
    // best-fit fallback. More-specific positive ranges remain eligible.
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "zh-CN;q=0, zh;q=0.5",
        }),
      ),
    ).toBe("zh-Hant");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "zh;q=0, zh-Hans;q=0.5",
        }),
      ),
    ).toBe("zh-Hans");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "zh;q=0, zh-TW;q=0.5",
        }),
      ),
    ).toBe("zh-Hant");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "*;q=0, zh-CN;q=0.5",
        }),
      ),
    ).toBe("zh-Hans");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "*;q=0, zh-SG;q=0.5",
        }),
      ),
    ).toBe("zh-Hans");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "en;q=0, en-US;q=0.5",
        }),
      ),
    ).toBe("en");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "ja;q=0, ja-JP;q=0.5",
        }),
      ),
    ).toBe("ja");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "zh-Hans;q=0, *;q=0.8, zh-CN;q=0.9",
        }),
      ),
    ).toBe("zh-Hans");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language":
            "en;q=0, zh-Hans;q=0, ja;q=0, ko;q=0, zh-HK;q=0, *;q=0.8",
        }),
      ),
    ).toBe("en");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "*;q=0, *;q=0.8",
        }),
        ["ja", "en"],
        "en",
      ),
    ).toBe("ja");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language":
            "en;q=0,zh-Hans;q=0,zh-Hant;q=0,ja;q=0,ko;q=0,zh-HK;q=0.5",
        }),
      ),
    ).toBe("en");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "en;q=0, *;q=0.8, zh-CN;q=0.1",
        }),
      ),
    ).toBe("zh-Hant");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "en;q=0, *;q=0.8, zh-Hans;q=0.1",
        }),
      ),
    ).toBe("zh-Hant");
    // Regional ranges that collapse to one configured representation are
    // equivalent at the application boundary. An equally specific positive
    // sibling can reopen the representation excluded by its counterpart.
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "zh-TW;q=0, zh-HK;q=0.5, *;q=0.1",
        }),
      ),
    ).toBe("zh-Hant");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "en-US;q=0, en-GB;q=0.5, *;q=0.1",
        }),
      ),
    ).toBe("en");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "zh-CN;q=0, zh-SG;q=0.5, *;q=0.1",
        }),
      ),
    ).toBe("zh-Hans");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "*;q=0.8, zh-TW;q=0.1",
        }),
        ["zh-Hant", "zh-Hans", "en"],
        "en",
      ),
    ).toBe("zh-Hans");
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "*;q=0.8, zh-Hant;q=0.1",
        }),
        ["zh-Hant", "zh-Hans", "en"],
        "en",
      ),
    ).toBe("zh-Hans");
  });

  it("honors a supported subset and its fallback", () => {
    expect(
      resolveAcceptLanguage(
        request("https://briefly.test/", {
          "accept-language": "zh-TW, ja;q=0.9",
        }),
        ["en", "ja"],
        "en",
      ),
    ).toBe("ja");
  });
});

describe("request locale precedence", () => {
  it("uses URL, then manual cookie, then Accept-Language, then English", () => {
    expect(
      resolveSiteLocale(
        request("https://briefly.test/zh-Hant/articles/story", {
          "accept-language": "ja",
          cookie: `${COOKIE_NAME}=en`,
        }),
      ),
    ).toBe("zh-Hant");

    expect(
      resolveSiteLocale(
        request("https://briefly.test/articles/story", {
          "accept-language": "ja",
          cookie: `${COOKIE_NAME}=zh-CN`,
        }),
      ),
    ).toBe("zh-Hans");

    expect(
      resolveSiteLocale(
        request("https://briefly.test/", {
          "accept-language": "ja",
          cookie: `${COOKIE_NAME}=zh-Hans`,
        }),
      ),
    ).toBe("zh-Hans");

    expect(
      resolveSiteLocale(
        request("https://briefly.test/articles/story", {
          "accept-language": "ko, en;q=0.5",
        }),
      ),
    ).toBe("ko");

    expect(resolveSiteLocale(request())).toBe("en");

    // Reserved transport/operation paths stay unprefixed. A compatibility
    // locale segment on one of them must not override the explicit cookie or
    // header preference.
    expect(
      resolveSiteLocale(
        request("https://briefly.test/zh-Hans/api/site", {
          cookie: `${COOKIE_NAME}=ja`,
          "accept-language": "ko",
        }),
      ),
    ).toBe("ja");
    expect(
      resolveSiteLocale(
        request("https://briefly.test/zh-Hans/admin/login", {
          "accept-language": "ko",
        }),
      ),
    ).toBe("ko");
  });

  it("ignores invalid manual values and reads encoded cookie values", () => {
    expect(
      localeFromRequestCookie(
        request("https://briefly.test/", {
          cookie: `${COOKIE_NAME}=en-US; ${COOKIE_NAME}=zh-Hant`,
          "accept-language": "ja",
        }),
      ),
    ).toBe("zh-Hant");

    expect(
      resolveSiteLocale(
        request("https://briefly.test/", {
          cookie: `${COOKIE_NAME}=en-US`,
          "accept-language": "ja",
        }),
      ),
    ).toBe("ja");

    expect(
      localeFromRequestCookie(
        request("https://briefly.test/", {
          cookie: `${COOKIE_NAME}=%7A%68%2DHant`,
        }),
      ),
    ).toBe("zh-Hant");
  });

  it("recognizes canonical and legacy locale URL prefixes only", () => {
    expect(
      localeFromRequestUrl(request("https://briefly.test/zh-CN/articles")),
    ).toBe("zh-Hans");
    expect(
      localeFromRequestUrl(request("https://briefly.test/%7A%68-Hant/home")),
    ).toBe("zh-Hant");
    expect(
      localeFromRequestUrl(request("https://briefly.test/articles/ja")),
    ).toBeUndefined();
    expect(
      localeFromRequestUrl(request("https://briefly.test/ZH-HANS/articles")),
    ).toBe("zh-Hans");

    expect(
      normalizeLocalePathUrl(new URL("https://briefly.test/%7A%68-CN/articles"))
        .pathname,
    ).toBe("/zh-Hans/articles");
  });
});

describe("localized values and response headers", () => {
  it("falls back to English and reports the supplying locale", () => {
    expect(
      selectLocalizedValue({ en: "English", "zh-Hant": "繁體中文" }, "zh-Hans"),
    ).toEqual({ locale: "en", value: "English" });

    expect(
      selectLocalizedValue({ en: "English", "zh-Hant": "繁體中文" }, "zh-Hant"),
    ).toEqual({ locale: "zh-Hant", value: "繁體中文" });

    expect(selectLocalizedValue({}, "ja")).toEqual({
      locale: "ja",
      value: null,
    });

    expect(selectLocalizedValue({ "zh-Hans": "" }, "zh-Hans")).toEqual({
      locale: "zh-Hans",
      value: "",
    });
    expect(
      selectLocalizedValue({ "zh-Hans": null, en: "English" }, "zh-Hans"),
    ).toEqual({ locale: "en", value: "English" });
  });

  it("merges Vary fields without duplicates", () => {
    expect(
      mergeVary("Accept-Encoding", "Accept-Language", "accept-language"),
    ).toBe("Accept-Encoding, Accept-Language");
    expect(mergeVary("*", "Accept-Language")).toBe("*");
    expect(mergeVary(null, "Accept-Language")).toBe("Accept-Language");
  });
});
