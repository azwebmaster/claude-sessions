import type { SessionListItem } from "@shared/types";
import { totalTokens } from "@shared/types";

/** Parsed optional bounds for a numeric metric. Empty string / null = unbound. */
export type NumericBounds = {
  min: number | null;
  max: number | null;
};

export type SessionListFilters = {
  query: string;
  tokens: NumericBounds;
  peakCtx: NumericBounds;
  turns: NumericBounds;
  /** Max session age in ms from `updatedAt` (null = any age). */
  maxAgeMs: number | null;
};

export const EMPTY_BOUNDS: NumericBounds = { min: null, max: null };

const MS_HOUR = 60 * 60 * 1000;
const MS_DAY = 24 * MS_HOUR;

/** Default age window for the session list (Last 24 hours). */
export const DEFAULT_MAX_AGE_MS = MS_DAY;

export const EMPTY_SESSION_FILTERS: SessionListFilters = {
  query: "",
  tokens: EMPTY_BOUNDS,
  peakCtx: EMPTY_BOUNDS,
  turns: EMPTY_BOUNDS,
  maxAgeMs: null,
};

/** Initial filters for the session list page. */
export const DEFAULT_SESSION_FILTERS: SessionListFilters = {
  ...EMPTY_SESSION_FILTERS,
  maxAgeMs: DEFAULT_MAX_AGE_MS,
};

export type AgePreset = {
  label: string;
  /** null means no age limit */
  maxAgeMs: number | null;
};

export const AGE_PRESETS: AgePreset[] = [
  { label: "Any age", maxAgeMs: null },
  { label: "Last hour", maxAgeMs: MS_HOUR },
  { label: "Last 24 hours", maxAgeMs: MS_DAY },
  { label: "Last 7 days", maxAgeMs: 7 * MS_DAY },
  { label: "Last 30 days", maxAgeMs: 30 * MS_DAY },
  { label: "Last 90 days", maxAgeMs: 90 * MS_DAY },
];

/**
 * Parse a quantity typed by the user. Accepts plain integers/decimals and
 * `k` / `M` suffixes (e.g. `100k`, `1.5M`) matching `formatTokens` display.
 * Returns null for empty/invalid input.
 */
export function parseQuantity(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase().replace(/,/g, "");
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([km])?$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const suffix = match[2];
  if (suffix === "k") return Math.round(value * 1_000);
  if (suffix === "m") return Math.round(value * 1_000_000);
  return Math.round(value);
}

export function boundsFromInputs(minRaw: string, maxRaw: string): NumericBounds {
  return {
    min: parseQuantity(minRaw),
    max: parseQuantity(maxRaw),
  };
}

export function inNumericBounds(value: number, bounds: NumericBounds): boolean {
  if (bounds.min != null && value < bounds.min) return false;
  if (bounds.max != null && value > bounds.max) return false;
  return true;
}

/** Age of a session in ms based on `updatedAt` (or `startedAt` fallback). */
export function sessionAgeMs(
  session: Pick<SessionListItem, "updatedAt" | "startedAt">,
  nowMs: number = Date.now(),
): number | null {
  const iso = session.updatedAt ?? session.startedAt;
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, nowMs - t);
}

export function matchesTextQuery(session: SessionListItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    session.summary ?? "",
    session.projectPath,
    session.id,
    session.model ?? "",
    session.gitBranch ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export function matchesSessionFilters(
  session: SessionListItem,
  filters: SessionListFilters,
  nowMs: number = Date.now(),
): boolean {
  if (!matchesTextQuery(session, filters.query)) return false;

  if (!inNumericBounds(totalTokens(session.usage), filters.tokens)) return false;
  if (!inNumericBounds(session.peakContextTokens, filters.peakCtx)) return false;
  if (!inNumericBounds(session.turnCount, filters.turns)) return false;

  if (filters.maxAgeMs != null) {
    const age = sessionAgeMs(session, nowMs);
    if (age == null || age > filters.maxAgeMs) return false;
  }

  return true;
}

export function hasActiveMetricFilters(filters: SessionListFilters): boolean {
  const boundActive = (b: NumericBounds) => b.min != null || b.max != null;
  return (
    boundActive(filters.tokens) ||
    boundActive(filters.peakCtx) ||
    boundActive(filters.turns) ||
    filters.maxAgeMs != null
  );
}
