import type {
  AnalyzeModelAlias,
  AnalyzeStreamEvent,
  SessionAnalysis,
} from "@shared/types";

async function readError(res: Response): Promise<string> {
  const body = await res.text();
  if (!body) return `Request failed: ${res.status}`;
  try {
    const parsed = JSON.parse(body) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    // keep raw body
  }
  return body;
}

export async function api<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  return res.json() as Promise<T>;
}

export type ApiPostOptions = {
  /** AbortSignal for cancellation / client-side timeout. */
  signal?: AbortSignal;
};

export async function apiPost<T>(
  path: string,
  body: unknown = {},
  options: ApiPostOptions = {},
): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal: options.signal,
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  return res.json() as Promise<T>;
}

export type AnalyzeStreamHandlers = {
  signal?: AbortSignal;
  onEvent?: (event: AnalyzeStreamEvent) => void;
};

export type AnalyzeStreamResult = {
  analysis: SessionAnalysis;
  cached: boolean;
};

export type AnalyzeRequestBody = {
  model?: AnalyzeModelAlias;
  /** Bypass server cache and run a fresh Agent SDK query. */
  force?: boolean;
};

/**
 * GET a fingerprint-matched cached analysis, or null when none is stored.
 */
export async function apiGetCachedAnalysis(
  sessionId: string,
  model?: AnalyzeModelAlias,
  options: ApiPostOptions = {},
): Promise<SessionAnalysis | null> {
  const params = new URLSearchParams();
  if (model) params.set("model", model);
  const qs = params.toString();
  const res = await fetch(
    `/api/sessions/${sessionId}/analyze${qs ? `?${qs}` : ""}`,
    { signal: options.signal },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  const body = (await res.json()) as {
    analysis?: SessionAnalysis;
  };
  return body.analysis ?? null;
}

/**
 * POST analyze with an NDJSON progress stream.
 * Resolves with the final `result` analysis, or throws on `error` / HTTP failure.
 */
export async function apiAnalyzeStream(
  sessionId: string,
  body: AnalyzeRequestBody = {},
  handlers: AnalyzeStreamHandlers = {},
): Promise<AnalyzeStreamResult> {
  const res = await fetch(`/api/sessions/${sessionId}/analyze?stream=1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/x-ndjson",
    },
    body: JSON.stringify(body ?? {}),
    signal: handlers.signal,
  });

  if (!res.ok) {
    throw new Error(await readError(res));
  }
  if (!res.body) {
    throw new Error("Analyze stream returned no body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let analysis: SessionAnalysis | null = null;
  let cached = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line) continue;
      let event: AnalyzeStreamEvent;
      try {
        event = JSON.parse(line) as AnalyzeStreamEvent;
      } catch {
        throw new Error(`Invalid analyze stream line: ${line.slice(0, 120)}`);
      }
      handlers.onEvent?.(event);
      if (event.type === "result") {
        analysis = event.analysis;
        cached = event.cached === true;
      } else if (event.type === "error") {
        throw new Error(event.error);
      }
    }
  }

  const trailing = buffer.trim();
  if (trailing) {
    const event = JSON.parse(trailing) as AnalyzeStreamEvent;
    handlers.onEvent?.(event);
    if (event.type === "result") {
      analysis = event.analysis;
      cached = event.cached === true;
    } else if (event.type === "error") {
      throw new Error(event.error);
    }
  }

  if (!analysis) {
    throw new Error("Analyze stream ended without a result");
  }
  return { analysis, cached };
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
