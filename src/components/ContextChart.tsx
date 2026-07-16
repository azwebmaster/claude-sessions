import type { ContextTimelinePoint } from "@shared/types";
import { formatTokens } from "@shared/types";

interface Props {
  points: ContextTimelinePoint[];
}

export function ContextChart({ points }: Props) {
  if (points.length === 0) {
    return <div className="empty">No assistant usage records in this session.</div>;
  }

  const max = Math.max(...points.map((p) => p.contextTokens), 1);

  return (
    <div>
      <div className="chart" role="img" aria-label="Context size by turn">
        {points.map((p) => (
          <div
            key={p.turn}
            className="chart-bar"
            style={{ height: `${Math.max(8, (p.contextTokens / max) * 120)}px` }}
            title={`Turn ${p.turn}: ${formatTokens(p.contextTokens)} context\n${p.label}`}
          >
            <span>{formatTokens(p.contextTokens)}</span>
          </div>
        ))}
      </div>
      <div className="muted mono" style={{ marginTop: "0.55rem", fontSize: "0.72rem" }}>
        {points.length} turns · peak {formatTokens(max)}
      </div>
    </div>
  );
}
