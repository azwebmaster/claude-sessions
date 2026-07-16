import type { AgentBreakdownRow } from "@shared/types";
import { formatTokens, totalTokens } from "@shared/types";

interface Props {
  rows: AgentBreakdownRow[];
}

export function AgentBreakdown({ rows }: Props) {
  if (rows.length === 0) {
    return <div className="empty">No agents found.</div>;
  }

  return (
    <div className="agent-list">
      {rows.map((row) => (
        <div key={row.agentId} className="agent-row">
          <div>
            <div style={{ fontWeight: 600 }}>{row.label}</div>
            <div className="muted mono" style={{ fontSize: "0.75rem" }}>
              {row.kind.replace("_", " ")}
              {row.model ? ` · ${row.model.replace(/^claude-/, "")}` : ""}
              {" · "}
              {row.toolCallCount} tools · {row.messageCount} msgs
            </div>
          </div>
          <div className="mono" style={{ textAlign: "right" }}>
            <div>{formatTokens(totalTokens(row.usage))}</div>
            <div className="muted" style={{ fontSize: "0.72rem" }}>
              peak {formatTokens(row.peakContextTokens)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
