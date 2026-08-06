import type { SVGProps } from "react";

export type AdminIconName =
  | "account"
  | "alert"
  | "articles"
  | "back"
  | "bold"
  | "break"
  | "check"
  | "chevron"
  | "chevron-down"
  | "chevron-right"
  | "clock"
  | "close"
  | "code"
  | "code-block"
  | "conflict"
  | "divider"
  | "external"
  | "eye"
  | "globe"
  | "history"
  | "image"
  | "italic"
  | "list-ol"
  | "list-ul"
  | "link"
  | "media"
  | "menu"
  | "moon"
  | "more"
  | "offline"
  | "panel"
  | "plus"
  | "quote"
  | "redo"
  | "search"
  | "settings"
  | "strike"
  | "sun"
  | "trash"
  | "undo"
  | "upload"
  | "video";

const STROKE_ICONS: Record<Exclude<AdminIconName, "more">, string> = {
  account:
    "M12 12m-4-4a4 4 0 1 0 8 0 4 4 0 1 0-8 0|M4 21c0-4 3.6-6 8-6s8 2 8 6",
  alert: "M12 12m-9 0a9 9 0 1 0 18 0 9 9 0 1 0-18 0|M12 8v5m0 3v.01",
  articles:
    "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z|M14 3v6h6M9 13h6M9 17h6",
  back: "M19 12H5m7-7-7 7 7 7",
  bold: "M7 4h6a3.5 3.5 0 0 1 0 7H7zM7 11h7a3.5 3.5 0 0 1 0 7H7z",
  break: "M9 10 4 15l5 5|M4 15h10a6 6 0 0 0 6-6V4",
  check: "M20 6 9 17l-5-5",
  chevron: "m18 15-6-6-6 6",
  "chevron-down": "m6 9 6 6 6-6",
  "chevron-right": "m9 6 6 6-6 6",
  clock: "M12 12m-9 0a9 9 0 1 0 18 0 9 9 0 1 0-18 0|M12 7v5l3 2",
  close: "M18 6 6 18M6 6l12 12",
  code: "m16 18 6-6-6-6M8 6l-6 6 6 6",
  "code-block":
    "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z|m8 10-2 2 2 2m4-4 2 2-2 2m2-8-4 12",
  conflict: "M8 7h12M8 12h12M8 17h12M4 7v.01M4 12v.01M4 17v.01",
  divider: "M4 12h16",
  external:
    "M15 3h6v6|M10 14 21 3|M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z|M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0",
  globe:
    "M12 12m-9 0a9 9 0 1 0 18 0 9 9 0 1 0-18 0|M3 12h18|M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18",
  history: "M3 3v5h5|M3.05 13A9 9 0 1 0 6 5.3L3 8|M12 7v5l4 2",
  image:
    "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z|M9 9m-2 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0|m21 15-4.5-4.5L6 21",
  italic: "M19 4h-9M14 20H5M15 4 9 20",
  "list-ol": "M10 6h11M10 12h11M10 18h11M4 6h1v4m-1 0h2M4 12h2l-2 3h2",
  "list-ul": "M8 6h13M8 12h13M8 18h13M4 6v.01M4 12v.01M4 18v.01",
  link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  media:
    "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z|M9 9m-2 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0|m21 15-4.5-4.5L6 21",
  menu: "M4 7h16M4 12h16M4 17h16",
  moon: "M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z",
  offline:
    "m2 2 20 20|M8.5 16.5a5 5 0 0 1 7 0|M5 13a10 10 0 0 1 3.6-2.2m7.8.5A10 10 0 0 1 19 13|M12 20h.01|M3 8.8A15 15 0 0 1 8.7 5.4m6.6.1A15 15 0 0 1 21 8.8",
  panel:
    "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z|M15 3v18",
  plus: "M12 5v14M5 12h14",
  quote:
    "M10 8c-3 1-5 3.5-5 7v1h5v-6H7.5C8 9 9 8.5 10 8V8zm9 0c-3 1-5 3.5-5 7v1h5v-6h-2.5C17 9 18 8.5 19 8V8z",
  redo: "M21 7v6h-6m6 0a9 9 0 1 1-3-7.7L21 7",
  search: "M11 11m-7 0a7 7 0 1 0 14 0 7 7 0 1 0-14 0|m20 20-3.5-3.5",
  settings:
    "M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0|M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  strike:
    "M5 12h14M16 6c-.6-1.2-2.1-2-4-2-2.5 0-4 1.3-4 3 0 1 .5 1.7 1.3 2.2M8 18c.6 1.2 2.1 2 4 2 2.5 0 4-1.3 4-3 0-.8-.4-1.5-1-2",
  sun: "M12 12m-4 0a4 4 0 1 0 8 0 4 4 0 1 0-8 0|M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  trash:
    "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",
  undo: "M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 7",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M17 8l-5-5-5 5M12 3v12",
  video:
    "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z|m10 9 5 3-5 3V9Z",
};

export function AdminIcon({
  name,
  size = 18,
  strokeWidth = 1.8,
  ...rest
}: Readonly<
  { name: AdminIconName; size?: number; strokeWidth?: number } & Omit<
    SVGProps<SVGSVGElement>,
    "name"
  >
>) {
  if (name === "more") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        {...rest}
      >
        <circle cx="12" cy="5" r="1.6" />
        <circle cx="12" cy="12" r="1.6" />
        <circle cx="12" cy="19" r="1.6" />
      </svg>
    );
  }
  const paths = STROKE_ICONS[name].split("|");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
