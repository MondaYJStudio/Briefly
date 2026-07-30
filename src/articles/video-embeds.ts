export const VIDEO_PROVIDER_IDENTIFIERS = {
  youtube: /^[A-Za-z0-9_-]{11}$/u,
  bilibili: /^BV[A-Za-z0-9]{10}$/u,
} as const;

export type VideoProvider = keyof typeof VIDEO_PROVIDER_IDENTIFIERS;

export interface VideoProviderFacts {
  provider: VideoProvider;
  id: string;
}

const YOUTUBE_PAGE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
]);
const YOUTUBE_EMBED_HOSTS = new Set([
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);
const YOUTUBE_SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);
const BILIBILI_PAGE_HOSTS = new Set([
  "bilibili.com",
  "www.bilibili.com",
  "m.bilibili.com",
]);

export function recognizeVideoEmbed(input: string): VideoProviderFacts | null {
  const normalized = input.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 2_048 ||
    /[\u0000-\u0020\u007f]/u.test(normalized)
  ) {
    return null;
  }

  if (VIDEO_PROVIDER_IDENTIFIERS.youtube.test(normalized)) {
    return { provider: "youtube", id: normalized };
  }
  if (VIDEO_PROVIDER_IDENTIFIERS.bilibili.test(normalized)) {
    return { provider: "bilibili", id: normalized };
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return null;
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    return null;
  }

  const path = url.pathname.split("/").filter(Boolean);
  if (YOUTUBE_SHORT_HOSTS.has(url.hostname) && path.length === 1) {
    return recognizedProvider("youtube", path[0]);
  }
  if (YOUTUBE_PAGE_HOSTS.has(url.hostname)) {
    if (url.pathname === "/watch") {
      return recognizedProvider("youtube", url.searchParams.get("v"));
    }
    if (path.length === 2 && (path[0] === "shorts" || path[0] === "embed")) {
      return recognizedProvider("youtube", path[1]);
    }
  }
  if (
    YOUTUBE_EMBED_HOSTS.has(url.hostname) &&
    path.length === 2 &&
    path[0] === "embed"
  ) {
    return recognizedProvider("youtube", path[1]);
  }
  if (
    BILIBILI_PAGE_HOSTS.has(url.hostname) &&
    path.length === 2 &&
    path[0] === "video"
  ) {
    return recognizedProvider("bilibili", path[1]);
  }
  if (
    url.hostname === "player.bilibili.com" &&
    url.pathname === "/player.html"
  ) {
    return recognizedProvider("bilibili", url.searchParams.get("bvid"));
  }
  return null;
}

function recognizedProvider(
  provider: VideoProvider,
  id: string | null | undefined,
): VideoProviderFacts | null {
  return id !== null &&
    id !== undefined &&
    VIDEO_PROVIDER_IDENTIFIERS[provider].test(id)
    ? { provider, id }
    : null;
}
