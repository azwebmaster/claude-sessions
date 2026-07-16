import type { SessionListItem } from "@shared/types";
import { totalTokens } from "@shared/types";

/** Columns the session list can sort by. */
export type SessionSortKey =
  | "updatedAt"
  | "summary"
  | "tokens"
  | "peakCtx"
  | "turns"
  | "tools"
  | "agents";

export type SortDirection = "asc" | "desc";

export type SessionListSort = {
  key: SessionSortKey;
  direction: SortDirection;
};

/** Matches the API default: newest `updatedAt` first. */
export const DEFAULT_SESSION_SORT: SessionListSort = {
  key: "updatedAt",
  direction: "desc",
};

export type SessionSortOption = {
  key: SessionSortKey;
  label: string;
};

/** Labels for mobile sort select and accessible table headers. */
export const SESSION_SORT_OPTIONS: SessionSortOption[] = [
  { key: "updatedAt", label: "Updated" },
  { key: "summary", label: "Session" },
  { key: "tokens", label: "Tokens" },
  { key: "peakCtx", label: "Peak ctx" },
  { key: "turns", label: "Turns" },
  { key: "tools", label: "Tools" },
  { key: "agents", label: "Agents" },
];

function sessionTitle(session: SessionListItem): string {
  return (session.summary ?? "Untitled session").trim().toLowerCase();
}

function sortValue(
  session: SessionListItem,
  key: SessionSortKey,
): string | number {
  switch (key) {
    case "updatedAt":
      return session.updatedAt ?? session.startedAt ?? "";
    case "summary":
      return sessionTitle(session);
    case "tokens":
      return totalTokens(session.usage);
    case "peakCtx":
      return session.peakContextTokens;
    case "turns":
      return session.turnCount;
    case "tools":
      return session.toolCallCount;
    case "agents":
      return 1 + session.subagentCount;
  }
}

function compareValues(a: string | number, b: string | number): number {
  if (typeof a === "string" && typeof b === "string") {
    return a.localeCompare(b);
  }
  return (a as number) - (b as number);
}

/**
 * Stable sort of sessions by the given key/direction.
 * Ties break on session id so order stays deterministic across renders.
 */
export function sortSessions(
  sessions: SessionListItem[],
  sort: SessionListSort,
): SessionListItem[] {
  const { key, direction } = sort;
  const dir = direction === "asc" ? 1 : -1;
  return [...sessions].sort((left, right) => {
    const cmp = compareValues(sortValue(left, key), sortValue(right, key));
    if (cmp !== 0) return cmp * dir;
    return left.id.localeCompare(right.id);
  });
}

/** Toggle direction when the same column is clicked; otherwise start on a sensible default. */
export function nextSessionSort(
  current: SessionListSort,
  clickedKey: SessionSortKey,
): SessionListSort {
  if (current.key === clickedKey) {
    return {
      key: clickedKey,
      direction: current.direction === "asc" ? "desc" : "asc",
    };
  }
  // Text sorts A→Z; metrics and dates prefer high/newest first.
  const direction: SortDirection = clickedKey === "summary" ? "asc" : "desc";
  return { key: clickedKey, direction };
}
