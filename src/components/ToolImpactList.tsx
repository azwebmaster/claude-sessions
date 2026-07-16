import type { ToolImpactRow } from "@shared/types";
import { formatTokens } from "@shared/types";

interface Props {
  rows: ToolImpactRow[];
}

export function ToolImpactList({ rows }: Props) {
  if (rows.length === 0) {
    return <div className="empty">No tool calls recorded.</div>;
  }

  const max = Math.max(...rows.map((r) => r.totalResultTokens), 1);

  return (
    <div className="impact-list">
      {rows.map((row) => (
        <div key={row.toolName} className="impact-row">
          <div>
            <div style={{ fontWeight: 600 }}>{row.toolName}</div>
            <div className="muted mono" style={{ fontSize: "0.75rem" }}>
              {row.callCount} calls · avg result {formatTokens(row.avgResultTokens)} ·
              max {formatTokens(row.maxResultTokens)}
            </div>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ width: `${(row.totalResultTokens / max) * 100}%` }}
              />
            </div>
          </div>
          <div className="mono" style={{ textAlign: "right" }}>
            <div>{formatTokens(row.totalResultTokens)}</div>
            <div className="muted" style={{ fontSize: "0.72rem" }}>
              ≈ result size
            </div>
            {row.contextGrowthAttributed > 0 ? (
              <div className="delta-up" style={{ fontSize: "0.72rem", marginTop: 4 }}>
                +{formatTokens(row.contextGrowthAttributed)} ctx
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
