import { useEffect, useRef } from "react";
import { Box, Typography } from "@mui/material";
import type { ContextTimelinePoint } from "@shared/types";
import { ContextChart } from "../ContextChart";
import { SectionPaper } from "../ui";
import { TurnRailRow } from "./TurnRailRow";

interface Props {
  points: ContextTimelinePoint[];
  /** Tool calls per turn, from `stepCountsByTurn` — the count of the same rows
   *  the detail pane lists for that turn. */
  stepCountByTurn: ReadonlyMap<number, number>;
  activeTurn: number;
  onSelectTurn: (turn: number) => void;
}

/**
 * The session's single "you are here" anchor: a mini `ContextChart` in a fixed
 * block on top, then the turn list in the one scroll region of this view. On
 * `xs` the same list lays out as a horizontal strip above the detail pane.
 */
export function TurnRail({
  points,
  stepCountByTurn,
  activeTurn,
  onSelectTurn,
}: Props) {
  const listRef = useRef<HTMLDivElement | null>(null);

  // `buildTimeline` numbers turns 1..N in order, so the active point is at
  // `activeTurn - 1`.
  const activeNodeId = points[activeTurn - 1]?.nodeId ?? null;
  // `reduce`, not `Math.max(...points.map(…))`: a long session would spread
  // thousands of arguments onto the stack on every render.
  const maxContextTokens = points.reduce(
    (max, p) => (p.contextTokens > max ? p.contextTokens : max),
    1,
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      listRef.current
        ?.querySelector<HTMLElement>(`[data-rail-turn="${activeTurn}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTurn]);

  return (
    <SectionPaper
      sx={{
        p: { xs: 1, md: 1.25 },
        position: { md: "sticky" },
        top: { md: 8 },
        maxHeight: { md: "calc(100vh - 2rem)" },
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
      }}
    >
      <Box sx={{ flexShrink: 0, display: { xs: "none", md: "block" } }}>
        <ContextChart
          points={points}
          selectedNodeId={activeNodeId}
          onSelect={(point) => onSelectTurn(point.turn)}
        />
      </Box>

      <Typography
        color="text.secondary"
        sx={{ fontSize: "0.7rem", px: 0.5, pb: 0.5, flexShrink: 0 }}
      >
        {points.length} turn{points.length === 1 ? "" : "s"}
      </Typography>

      <Box
        ref={listRef}
        role="group"
        aria-label="Session turns"
        sx={{
          flex: { md: "1 1 auto" },
          minHeight: 0,
          minWidth: 0,
          display: "flex",
          flexDirection: { xs: "row", md: "column" },
          gap: 0.5,
          overflowX: { xs: "auto", md: "hidden" },
          overflowY: { xs: "hidden", md: "auto" },
          WebkitOverflowScrolling: "touch",
          overscrollBehavior: "contain",
        }}
      >
        {points.map((point) => (
          <TurnRailRow
            key={point.nodeId}
            point={point}
            stepCount={stepCountByTurn.get(point.turn) ?? 0}
            active={point.turn === activeTurn}
            maxContextTokens={maxContextTokens}
            onActivate={() => onSelectTurn(point.turn)}
          />
        ))}
      </Box>
    </SectionPaper>
  );
}
