import { getLocale } from "../../paraglide/runtime.js";

export function formatPublicDate(iso: string): string {
  // Eden treaty may revive ISO strings into Date objects.
  const date = new Date(iso);
  return new Intl.DateTimeFormat(getLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function publicationTimestamp(iso: string): string {
  return new Date(iso).toISOString();
}
