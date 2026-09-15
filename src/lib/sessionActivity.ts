export const ACTIVE_SESSION_THRESHOLD_MS = 5 * 60 * 1000;

export function isSessionActive(
  updatedAt: string | null,
  now: number = Date.now(),
  thresholdMs: number = ACTIVE_SESSION_THRESHOLD_MS,
): boolean {
  if (updatedAt === null) return false;
  const parsed = Date.parse(updatedAt);
  if (Number.isNaN(parsed)) return false;
  return now - parsed < thresholdMs;
}
