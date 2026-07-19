import { Box, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import type { AgentBreakdownRow } from "@shared/types";
import { formatTokens } from "@shared/types";
import {
  focusHighlight,
  nodeKindStyle,
  schemeAlpha,
  schemePalette,
} from "../theme";
import { EmptyState } from "./ui";

interface Props {
  rows: AgentBreakdownRow[];
  selectedAgentId?: string | null;
  onSelectAgent?: (agentId: string) => void;
}

/** Shorten long agent ids for the skinny map column. */
function shortLabel(row: AgentBreakdownRow): string {
  if (row.kind === "root_agent") return "Root";
  const bare = row.label.replace(/^Subagent\s*·\s*/i, "").trim();
  if (bare.length <= 14) return bare;
  return `${bare.slice(0, 6)}…${bare.slice(-4)}`;
}

export function HierarchyAgentMap({
  rows,
  selectedAgentId = null,
  onSelectAgent,
}: Props) {
  const theme = useTheme();
  const highlight = focusHighlight(theme);
  const selectable = Boolean(onSelectAgent);

  if (rows.length === 0) {
    return <EmptyState>No agents.</EmptyState>;
  }

  return (
    <Box
      component="nav"
      aria-label="Agent map"
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 0.75,
        minWidth: 0,
      }}
    >
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ letterSpacing: "0.06em", lineHeight: 1.2 }}
      >
        Agents
      </Typography>

      <Box
        role="list"
        sx={{
          position: "relative",
          display: "flex",
          flexDirection: { xs: "row", md: "column" },
          gap: { xs: 0.5, md: 0.35 },
          pl: { xs: 0, md: 1.25 },
          overflowX: { xs: "auto", md: "visible" },
          pb: { xs: 0.25, md: 0 },
          WebkitOverflowScrolling: "touch",
          "&::before": {
            content: '""',
            display: { xs: "none", md: "block" },
            position: "absolute",
            left: 5,
            top: 10,
            bottom: 10,
            width: 2,
            borderRadius: 1,
            bgcolor: "divider",
          },
        }}
      >
        {rows.map((row, index) => {
          const selected = selectedAgentId === row.agentId;
          const kindStyle = nodeKindStyle(theme, row.kind);
          const isSub = row.kind === "subagent";
          const isLast = index === rows.length - 1;

          return (
            <Box
              key={row.agentId}
              role="listitem"
              sx={{
                position: "relative",
                pl: { xs: 0, md: isSub ? 0.75 : 0 },
                flex: { xs: "0 0 auto", md: "none" },
                minWidth: { xs: "6.75rem", md: 0 },
                maxWidth: { xs: "8.5rem", md: "none" },
              }}
            >
              <Box
                aria-hidden
                sx={{
                  display: { xs: "none", md: "block" },
                  position: "absolute",
                  left: isSub ? -10 : -12,
                  top: "50%",
                  width: isSub ? 10 : 8,
                  height: 2,
                  bgcolor: "divider",
                  transform: "translateY(-50%)",
                }}
              />
              {isLast ? (
                <Box
                  aria-hidden
                  sx={{
                    display: { xs: "none", md: "block" },
                    position: "absolute",
                    left: -13,
                    top: "50%",
                    bottom: -4,
                    width: 2,
                    bgcolor: "background.paper",
                  }}
                />
              ) : null}
              <Box
                component={selectable ? "button" : "div"}
                type={selectable ? "button" : undefined}
                onClick={
                  selectable
                    ? () => {
                        onSelectAgent?.(row.agentId);
                      }
                    : undefined
                }
                aria-pressed={selectable ? selected : undefined}
                title={`${row.label} · ${row.turnCount} turns · ${row.toolCallCount} tools · peak ${formatTokens(row.peakContextTokens)}`}
                sx={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 0.65,
                  width: "100%",
                  minWidth: 0,
                  px: 0.65,
                  py: 0.55,
                  borderRadius: 1,
                  border: 1,
                  borderColor: selected ? highlight.borderColor : "divider",
                  bgcolor: selected ? highlight.bgcolor : "action.hover",
                  boxShadow: selected ? highlight.boxShadow : "none",
                  textAlign: "left",
                  font: "inherit",
                  color: "inherit",
                  cursor: selectable ? "pointer" : "default",
                  transition:
                    "border-color 150ms ease, background 150ms ease, box-shadow 150ms ease",
                  "&:hover": selectable
                    ? {
                        borderColor: selected
                          ? highlight.borderColor
                          : "text.secondary",
                        bgcolor: selected
                          ? schemeAlpha(
                              theme,
                              schemePalette(theme).warning.main,
                              0.14,
                            )
                          : "action.selected",
                      }
                    : undefined,
                  "&:focus-visible": selectable
                    ? {
                        outline: `2px solid ${schemePalette(theme).warning.main}`,
                        outlineOffset: 2,
                      }
                    : undefined,
                }}
              >
                <Box
                  aria-hidden
                  sx={{
                    width: 8,
                    height: 8,
                    mt: 0.45,
                    flexShrink: 0,
                    borderRadius: "50%",
                    bgcolor: kindStyle.color,
                    boxShadow: `0 0 0 3px ${kindStyle.bg}`,
                  }}
                />
                <Box sx={{ minWidth: 0, flex: "1 1 auto" }}>
                  <Typography
                    variant="subtitle2"
                    sx={{
                      fontSize: "0.75rem",
                      lineHeight: 1.25,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {shortLabel(row)}
                  </Typography>
                  <Typography
                    variant="mono"
                    color="text.secondary"
                    sx={{
                      display: "block",
                      fontSize: "0.65rem",
                      lineHeight: 1.3,
                      mt: 0.15,
                    }}
                  >
                    {row.turnCount} turns · {row.toolCallCount}t ·{" "}
                    {formatTokens(row.peakContextTokens)}
                  </Typography>
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
