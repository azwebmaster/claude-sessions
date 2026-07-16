import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SessionListItem } from "@shared/types";
import { formatTokens, totalTokens } from "@shared/types";
import { api, formatDate } from "../lib/api";

interface SessionsResponse {
  sessions: SessionListItem[];
  roots: string[];
  count: number;
}

export function SessionListPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<SessionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    api<SessionsResponse>("/api/sessions")
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.sessions;
    return data.sessions.filter((s) => {
      const hay = [
        s.summary ?? "",
        s.projectPath,
        s.id,
        s.model ?? "",
        s.gitBranch ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [data, query]);

  if (error) {
    return (
      <div className="panel panel-pad error">
        Failed to load sessions: {error}
      </div>
    );
  }

  if (!data) {
    return <div className="panel panel-pad loading">Scanning session files…</div>;
  }

  return (
    <section className="hero-list">
      <div className="panel panel-pad">
        <div className="toolbar">
          <div>
            <strong>{data.count}</strong>{" "}
            <span className="muted">sessions on this system</span>
          </div>
          <input
            className="search"
            placeholder="Filter by project, summary, model, branch…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter sessions"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="empty">
            No sessions matched. Claude Code stores transcripts under{" "}
            <span className="mono">~/.claude/projects</span>. Demo fixtures are
            included so you can explore the UI immediately.
          </div>
        ) : (
          <table className="session-table">
            <thead>
              <tr>
                <th>Session</th>
                <th>Updated</th>
                <th>Tokens</th>
                <th>Peak ctx</th>
                <th>Tools</th>
                <th>Agents</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={`${s.projectEncoded}-${s.id}`}
                  className="session-row"
                  onClick={() => navigate(`/sessions/${s.id}`)}
                >
                  <td>
                    <div className="session-title">
                      {s.summary ?? "Untitled session"}
                    </div>
                    <div className="session-path">{s.projectPath}</div>
                    <div style={{ marginTop: "0.35rem" }}>
                      <span className={`pill ${s.source}`}>{s.source}</span>{" "}
                      {s.gitBranch ? (
                        <span className="pill">{s.gitBranch}</span>
                      ) : null}{" "}
                      {s.model ? (
                        <span className="pill">{s.model.replace(/^claude-/, "")}</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="mono">{formatDate(s.updatedAt)}</td>
                  <td className="mono">{formatTokens(totalTokens(s.usage))}</td>
                  <td className="mono">{formatTokens(s.peakContextTokens)}</td>
                  <td className="mono">{s.toolCallCount}</td>
                  <td className="mono">{1 + s.subagentCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
