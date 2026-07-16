export async function api<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

export function kindLabel(kind: string): string {
  switch (kind) {
    case "root_agent":
      return "Root";
    case "subagent":
      return "Subagent";
    case "user_message":
      return "User";
    case "assistant_message":
      return "Assistant";
    case "tool_call":
      return "Tool";
    case "tool_result":
      return "Result";
    case "thinking":
      return "Thinking";
    case "system":
      return "System";
    default:
      return kind;
  }
}
