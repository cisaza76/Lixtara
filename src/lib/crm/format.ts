// Small display helpers for the CRM admin screens.
import type { Locale } from "@/lib/i18n";

const intl = (lang: Locale) => (lang === "es" ? "es-US" : "en-US");

// Operating time zone of the CRM (Miami). The database stores UTC instants (timestamptz); the
// server renders on Vercel in UTC, so every displayed date must name the zone explicitly.
// America/New_York switches EDT (UTC-4) ↔ EST (UTC-5) on its own. Same zone as src/lib/email.ts.
export const CRM_TIME_ZONE = "America/New_York";

/** Replaces {name} placeholders. */
export function fill(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function money(lang: Locale, value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(intl(lang), { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export function dateTime(lang: Locale, iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString(intl(lang), { timeZone: CRM_TIME_ZONE, dateStyle: "medium", timeStyle: "short" });
}

export function label<T extends Record<string, string>>(map: T, key: string | null | undefined): string {
  if (!key) return "—";
  return (map as Record<string, string>)[key] ?? key;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
