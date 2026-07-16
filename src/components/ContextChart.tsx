import { Box, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import type { ContextTimelinePoint } from "@shared/types";
import { formatTokens } from "@shared/types";
import { chartBarColors } from "../theme";
import { EmptyState } from "./ui";

interface Props {
  points: ContextTimelinePoint[];
  selectedNodeId?: string | null;
  onSelect?: (point: ContextTimelinePoint) => void;
}

export function ContextChart({ points, selectedNodeId, onSelect }: Props) {
  const theme = useTheme();
  const bars = chartBarColors(theme);

  if (points.length === 0) {
    return <EmptyState>No assistant usage records in this session.</EmptyState>;
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
          const [top, bottom] = selected
            ? bars.selected
            : grew
              ? bars.grown
              : bars.stable;
          const title = [
            `Turn ${p.turn}: ${formatTokens(p.contextTokens)} context occupancy`,
            i > 0
              ? delta === 0
                ? "no change vs prior turn"
                : `${delta > 0 ? "+" : ""}${formatTokens(delta)} vs prior turn`
              : "first turn baseline (prompt + cache), not tokens added by tools",
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
                background: `linear-gradient(180deg, ${top}, ${bottom})`,
                outline: selected
                  ? `2px solid ${theme.palette.warning.main}`
                  : "2px solid transparent",
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
                  outline: `2px solid ${bars.focusOutline}`,
                  outlineOffset: 2,
                },
                "& span": {
                  position: "absolute",
                  inset: "auto 0 100% 0",
                  transform: "translateY(-4px)",
                  fontSize: "0.62rem",
                  fontFamily: theme.typography.mono?.fontFamily,
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
      <Typography variant="mono" color="text.secondary" sx={{ mt: 1, fontSize: "0.72rem" }}>
        {points.length} turns · peak {formatTokens(max)}
        {selectable ? " · click a turn to focus the hierarchy" : ""}
      </Typography>
    </Box>
  );
}
