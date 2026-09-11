/**
 * "Active" (live) session detection.
 *
 * A Claude Code session is considered active when its transcript was appended
 * to very recently — i.e. Claude is (or just was) working in it. Detection is
 * based on the last transcript activity time (`updatedAt`, falling back to
 * `startedAt`) rather than file mtime so bundled demo fixtures — whose files
 * are touched at checkout — never look live.
 */

/** Default window: activity within the last 10 minutes counts as active. */
export const DEFAULT_ACTIVE_WINDOW_MS = 10 * 60 * 1000;

/** Resolve the active-session window, honoring `$CLAUDE_SESSIONS_ACTIVE_WINDOW_MS`. */
export function activeWindowMs(requested?: number): number {
  if (requested !== undefined && Number.isFinite(requested) && requested >= 0) {
    return requested;
  }
  // `process` is only present server-side; guard so this stays browser-safe.
  const raw =
    typeof process !== "undefined"
      ? process.env?.CLAUDE_SESSIONS_ACTIVE_WINDOW_MS
      : undefined;
  const fromEnv = Number(raw);
  if (raw != null && raw !== "" && Number.isFinite(fromEnv) && fromEnv >= 0) {
    return fromEnv;
  }
  return DEFAULT_ACTIVE_WINDOW_MS;
}

export type ActiveSessionInput = {
  updatedAt: string | null;
  startedAt?: string | null;
  /** Fixtures are demo data and are never treated as active. */
  source?: "local" | "fixture";
};

/**
 * True when the session had transcript activity within `windowMs` of `nowMs`.
 * Fixtures, missing/invalid timestamps, and future timestamps are not active.
 */
export function isSessionActive(
  session: ActiveSessionInput,
  nowMs: number = Date.now(),
  windowMs: number = activeWindowMs(),
): boolean {
  if (session.source === "fixture") return false;
  const iso = session.updatedAt ?? session.startedAt ?? null;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const age = nowMs - t;
  if (age < 0) return false; // clock skew / future timestamp
  return age <= windowMs;
}
