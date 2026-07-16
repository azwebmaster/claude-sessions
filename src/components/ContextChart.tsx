import { Box, Typography } from "@mui/material";
import type { ContextTimelinePoint } from "@shared/types";
import { formatTokens } from "@shared/types";

interface Props {
  points: ContextTimelinePoint[];
  selectedNodeId?: string | null;
  onSelect?: (point: ContextTimelinePoint) => void;
}

export function ContextChart({ points, selectedNodeId, onSelect }: Props) {
  if (points.length === 0) {
    return (
      <Typography color="text.secondary" align="center" sx={{ py: 2 }}>
        No assistant usage records in this session.
      </Typography>
    );
  }

  const max = Math.max(...points.map((p) => p.contextTokens), 1);
  const selectable = Boolean(onSelect);

  return (
    <Box>
      <Box
        role="listbox"
        aria-label="Context size by turn"
        sx={{
          display: "flex",
          alignItems: "flex-end",
          gap: 0.5,
          minHeight: 140,
          pt: 1,
          px: 0.5,
        }}
      >
        {points.map((p, i) => {
          const prev = i > 0 ? points[i - 1].contextTokens : p.contextTokens;
          const grew = p.contextTokens > prev;
          const selected = selectedNodeId === p.nodeId;
          const delta = p.contextTokens - prev;
          const title = [
            `Turn ${p.turn}: ${formatTokens(p.contextTokens)} context`,
            i > 0
              ? delta === 0
                ? "no change"
                : `${delta > 0 ? "+" : ""}${formatTokens(delta)} vs prior`
              : "first turn",
            p.label,
            selectable ? "Click to focus hierarchy" : "",
          ]
            .filter(Boolean)
            .join("\n");

          return (
            <Box
              key={p.nodeId}
              role="option"
              aria-selected={selected}
              title={title}
              onClick={() => onSelect?.(p)}
              onKeyDown={(e) => {
                if (!onSelect) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(p);
                }
              }}
              tabIndex={selectable ? 0 : undefined}
              sx={{
                flex: 1,
                minWidth: 10,
                height: Math.max(8, (p.contextTokens / max) * 120),
                borderRadius: "6px 6px 2px 2px",
                background: selected
                  ? "linear-gradient(180deg, #fb8c00, #ef6c00)"
                  : grew
                    ? "linear-gradient(180deg, #42a5f5, #1976d2)"
                    : "linear-gradient(180deg, #90caf9, #64b5f6)",
                outline: selected ? "2px solid #ef6c00" : "2px solid transparent",
                outlineOffset: 2,
                position: "relative",
                transition:
                  "transform 160ms ease, filter 160ms ease, outline-color 160ms ease",
                cursor: selectable ? "pointer" : "default",
                "&:hover": {
                  transform: "translateY(-3px)",
                  filter: "brightness(1.05)",
                  "& span": { opacity: 1 },
                },
                "&:focus-visible": {
                  outline: "2px solid #1976d2",
                  outlineOffset: 2,
                },
                "& span": {
                  position: "absolute",
                  inset: "auto 0 100% 0",
                  transform: "translateY(-4px)",
                  fontSize: "0.62rem",
                  fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
                  color: "text.secondary",
                  textAlign: "center",
                  opacity: selected ? 1 : 0,
                  transition: "opacity 120ms ease",
                  pointerEvents: "none",
                },
              }}
            >
              <span>{formatTokens(p.contextTokens)}</span>
            </Box>
          );
        })}
      </Box>
      <Typography
        sx={{
          mt: 1,
          fontSize: "0.72rem",
          color: "text.secondary",
          fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
        }}
      >
        {points.length} turns · peak {formatTokens(max)}
        {selectable ? " · click a turn to focus the hierarchy" : ""}
      </Typography>
    </Box>
  );
}
