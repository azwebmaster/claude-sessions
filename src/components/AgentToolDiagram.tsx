import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import AddIcon from "@mui/icons-material/Add";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import RemoveIcon from "@mui/icons-material/Remove";
import { Box, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import type { AgentBreakdownRow } from "@shared/types";
import { focusHighlight, motion, nodeKindStyle } from "../theme";
import { EmptyState } from "./ui";

interface Props {
  rows: AgentBreakdownRow[];
  selectedAgentId?: string | null;
  selectedToolName?: string | null;
  onSelectAgent?: (agentId: string) => void;
  onSelectTool?: (toolName: string, agentId?: string) => void;
}

interface DiagramLink {
  agentId: string;
  toolName: string;
  callCount: number;
}

interface Point {
  x: number;
  y: number;
}

interface LaidOutNode {
  id: string;
  label: string;
  sublabel: string;
  kind: "agent" | "tool";
  agentKind?: "root_agent" | "subagent";
  callWeight: number;
}

interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

type DragMode =
  | { type: "pan"; startX: number; startY: number; originTx: number; originTy: number }
  | {
      type: "node";
      nodeId: string;
      pointerId: number;
      offsetX: number;
      offsetY: number;
    };

const MAX_TOOLS = 12;
const WORLD_W = 720;
const WORLD_H = 420;
const NODE_H = 36;
const NODE_W = 128;
const MIN_SCALE = 0.45;
const MAX_SCALE = 2.75;
const ZOOM_STEP = 1.18;

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function shortAgentLabel(label: string): string {
  if (label.startsWith("Subagent · ")) {
    const id = label.slice("Subagent · ".length);
    return id.length > 18 ? `${id.slice(0, 16)}…` : id;
  }
  return label.length > 22 ? `${label.slice(0, 20)}…` : label;
}

/** Stable pseudo-random in [0, 1) from a string seed. */
function hash01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function initialScatterPositions(
  agents: LaidOutNode[],
  tools: LaidOutNode[],
): Record<string, Point> {
  const positions: Record<string, Point> = {};
  const padX = NODE_W / 2 + 24;
  const padY = NODE_H / 2 + 28;
  const agentBand = { x0: padX, x1: WORLD_W * 0.42, y0: padY, y1: WORLD_H - padY };
  const toolBand = {
    x0: WORLD_W * 0.58,
    x1: WORLD_W - padX,
    y0: padY,
    y1: WORLD_H - padY,
  };

  const place = (
    nodes: LaidOutNode[],
    band: { x0: number; x1: number; y0: number; y1: number },
    side: "agent" | "tool",
  ) => {
    const n = Math.max(nodes.length, 1);
    nodes.forEach((node, i) => {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const jitterX = (hash01(`${node.id}:x`) - 0.5) * (band.x1 - band.x0) * 0.55;
      const jitterY = (hash01(`${node.id}:y`) - 0.5) * 36;
      const baseY = band.y0 + t * (band.y1 - band.y0);
      // Mild arc so the scatter reads as flow left → right
      const arc =
        side === "agent"
          ? Math.sin(t * Math.PI) * ((band.x1 - band.x0) * 0.12)
          : -Math.sin(t * Math.PI) * ((band.x1 - band.x0) * 0.12);
      const baseX = (band.x0 + band.x1) / 2 + arc;
      positions[node.id] = {
        x: clamp(baseX + jitterX, band.x0, band.x1),
        y: clamp(baseY + jitterY, band.y0, band.y1),
      };
    });
  };

  place(agents, agentBand, "agent");
  place(tools, toolBand, "tool");
  return positions;
}

function zoomAt(
  view: ViewTransform,
  clientX: number,
  clientY: number,
  rect: DOMRect,
  nextScale: number,
): ViewTransform {
  const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
  if (scale === view.scale) return view;
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  const worldX = (px - view.tx) / view.scale;
  const worldY = (py - view.ty) / view.scale;
  return {
    scale,
    tx: px - worldX * scale,
    ty: py - worldY * scale,
  };
}

function fitView(containerW: number, containerH: number): ViewTransform {
  const scale = clamp(
    Math.min(containerW / WORLD_W, containerH / WORLD_H) * 0.96,
    MIN_SCALE,
    MAX_SCALE,
  );
  return {
    scale,
    tx: (containerW - WORLD_W * scale) / 2,
    ty: (containerH - WORLD_H * scale) / 2,
  };
}

export function AgentToolDiagram({
  rows,
  selectedAgentId = null,
  selectedToolName = null,
  onSelectAgent,
  onSelectTool,
}: Props) {
  const theme = useTheme();
  const gradId = useId().replace(/:/g, "");
  const highlight = focusHighlight(theme);
  const rootStyle = nodeKindStyle(theme, "root_agent");
  const subStyle = nodeKindStyle(theme, "subagent");
  const toolStyle = nodeKindStyle(theme, "tool_call");

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragMode | null>(null);
  const movedRef = useRef(false);

  const { links, agentNodes, toolNodes, hiddenToolCount, totalCalls, layoutKey } =
    useMemo(() => {
      const linkList: DiagramLink[] = [];
      const totals = new Map<string, number>();
      let calls = 0;
      for (const row of rows) {
        for (const tool of row.tools ?? []) {
          linkList.push({
            agentId: row.agentId,
            toolName: tool.toolName,
            callCount: tool.callCount,
          });
          totals.set(
            tool.toolName,
            (totals.get(tool.toolName) ?? 0) + tool.callCount,
          );
          calls += tool.callCount;
        }
      }
      const ranked = [...totals.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([toolName, callCount]) => ({ toolName, callCount }));
      const visible = ranked.slice(0, MAX_TOOLS);
      const visibleNames = new Set(visible.map((t) => t.toolName));
      const maxToolCalls = Math.max(...visible.map((t) => t.callCount), 1);
      const maxAgentCalls = Math.max(...rows.map((r) => r.toolCallCount), 1);

      const agents: LaidOutNode[] = rows.map((row) => ({
        id: row.agentId,
        label: shortAgentLabel(row.label),
        sublabel: pluralize(row.toolCallCount, "call"),
        kind: "agent" as const,
        agentKind: row.kind,
        callWeight: row.toolCallCount / maxAgentCalls,
      }));
      const tools: LaidOutNode[] = visible.map((tool) => ({
        id: tool.toolName,
        label: tool.toolName,
        sublabel: `${tool.callCount}×`,
        kind: "tool" as const,
        callWeight: tool.callCount / maxToolCalls,
      }));

      return {
        links: linkList.filter((l) => visibleNames.has(l.toolName)),
        agentNodes: agents,
        toolNodes: tools,
        hiddenToolCount: Math.max(0, ranked.length - visible.length),
        totalCalls: calls,
        layoutKey: [
          ...agents.map((a) => a.id),
          ...tools.map((t) => t.id),
        ].join("|"),
      };
    }, [rows]);

  const [positions, setPositions] = useState<Record<string, Point>>(() =>
    initialScatterPositions(agentNodes, toolNodes),
  );
  const [view, setView] = useState<ViewTransform>({ scale: 1, tx: 0, ty: 0 });
  const layoutKeyRef = useRef(layoutKey);

  // Re-scatter when the agent/tool set changes (not when call counts alone update).
  useEffect(() => {
    if (layoutKeyRef.current === layoutKey) return;
    layoutKeyRef.current = layoutKey;
    setPositions(initialScatterPositions(agentNodes, toolNodes));
  }, [layoutKey, agentNodes, toolNodes]);

  // Fit the world into the viewport when the graph membership changes.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setView(fitView(rect.width, rect.height));
    }
  }, [layoutKey]);

  // Seed an initial fit once the viewport has a real size.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      setView((current) => {
        if (current.scale !== 1 || current.tx !== 0 || current.ty !== 0) {
          return current;
        }
        return fitView(width, height);
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Non-passive wheel so we can prevent page scroll while zooming.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setView((v) => zoomAt(v, e.clientX, e.clientY, rect, v.scale * factor));
    };
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, []);

  const allNodes = useMemo(
    () => [...agentNodes, ...toolNodes],
    [agentNodes, toolNodes],
  );

  const resetLayout = useCallback(() => {
    setPositions(initialScatterPositions(agentNodes, toolNodes));
    const el = viewportRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setView(fitView(rect.width, rect.height));
    }
  }, [agentNodes, toolNodes]);

  const zoomBy = useCallback((factor: number) => {
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    setView((v) => zoomAt(v, cx, cy, rect, v.scale * factor));
  }, []);

  const viewRef = useRef(view);
  viewRef.current = view;
  const positionsRef = useRef(positions);
  positionsRef.current = positions;

  const clientToWorld = useCallback((clientX: number, clientY: number): Point => {
    const el = viewportRef.current;
    const v = viewRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: (clientX - rect.left - v.tx) / v.scale,
      y: (clientY - rect.top - v.ty) / v.scale,
    };
  }, []);

  const onPointerDownBackground = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (e.button !== 0) return;
      // Only pan when the event target is the svg/background, not a node.
      if ((e.target as Element).closest("[data-diagram-node]")) return;
      movedRef.current = false;
      const v = viewRef.current;
      dragRef.current = {
        type: "pan",
        startX: e.clientX,
        startY: e.clientY,
        originTx: v.tx,
        originTy: v.ty,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [],
  );

  const onPointerDownNode = useCallback(
    (e: ReactPointerEvent<SVGGElement>, nodeId: string) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      movedRef.current = false;
      const pos = positionsRef.current[nodeId] ?? { x: 0, y: 0 };
      const world = clientToWorld(e.clientX, e.clientY);
      dragRef.current = {
        type: "node",
        nodeId,
        pointerId: e.pointerId,
        offsetX: world.x - pos.x,
        offsetY: world.y - pos.y,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [clientToWorld],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.type === "pan") {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (Math.hypot(dx, dy) > 3) movedRef.current = true;
        setView((v) => ({
          ...v,
          tx: drag.originTx + dx,
          ty: drag.originTy + dy,
        }));
        return;
      }
      const world = clientToWorld(e.clientX, e.clientY);
      const next = {
        x: world.x - drag.offsetX,
        y: world.y - drag.offsetY,
      };
      const prev = positionsRef.current[drag.nodeId];
      if (
        prev &&
        Math.hypot(next.x - prev.x, next.y - prev.y) * viewRef.current.scale > 3
      ) {
        movedRef.current = true;
      }
      setPositions((p) => ({ ...p, [drag.nodeId]: next }));
    },
    [clientToWorld],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleNodeActivate = useCallback(
    (node: LaidOutNode) => {
      if (movedRef.current) return;
      if (node.kind === "agent") onSelectAgent?.(node.id);
      else onSelectTool?.(node.id);
    },
    [onSelectAgent, onSelectTool],
  );

  if (rows.length === 0) {
    return <EmptyState>No agents found.</EmptyState>;
  }

  if (totalCalls === 0) {
    return <EmptyState>No tool calls in this session.</EmptyState>;
  }

  const maxLink = Math.max(...links.map((l) => l.callCount), 1);
  const dimInactive = Boolean(selectedAgentId) || Boolean(selectedToolName);

  const linkActive = (link: DiagramLink) => {
    if (selectedAgentId && selectedToolName) {
      return (
        link.agentId === selectedAgentId && link.toolName === selectedToolName
      );
    }
    if (selectedAgentId) return link.agentId === selectedAgentId;
    if (selectedToolName) return link.toolName === selectedToolName;
    return false;
  };

  const renderNode = (node: LaidOutNode) => {
    const pos = positions[node.id];
    if (!pos) return null;
    const selected =
      node.kind === "agent"
        ? selectedAgentId === node.id
        : selectedToolName === node.id;
    const related =
      selected ||
      (node.kind === "agent"
        ? selectedToolName != null &&
          links.some(
            (l) => l.agentId === node.id && l.toolName === selectedToolName,
          )
        : selectedAgentId != null &&
          links.some(
            (l) => l.toolName === node.id && l.agentId === selectedAgentId,
          ));
    const faded = dimInactive && !related;
    const chip =
      node.kind === "tool"
        ? toolStyle
        : node.agentKind === "subagent"
          ? subStyle
          : rootStyle;
    const w = NODE_W;
    const h = NODE_H;
    const selectable =
      node.kind === "agent" ? Boolean(onSelectAgent) : Boolean(onSelectTool);
    const label =
      node.kind === "tool" && node.label.length > 16
        ? `${node.label.slice(0, 14)}…`
        : node.label;

    return (
      <g
        key={node.id}
        data-diagram-node={node.id}
        transform={`translate(${pos.x - w / 2}, ${pos.y - h / 2})`}
        opacity={faded ? 0.28 : 1}
        style={{
          cursor: "grab",
          transition: "opacity 160ms ease",
        }}
        onPointerDown={(e) => onPointerDownNode(e, node.id)}
        onClick={() => handleNodeActivate(node)}
        role={selectable ? "button" : undefined}
        tabIndex={selectable ? 0 : undefined}
        onKeyDown={(e) => {
          if (!selectable) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleNodeActivate(node);
          }
        }}
      >
        <title>{`${node.label} · ${node.sublabel} · drag to rearrange`}</title>
        <rect
          width={w}
          height={h}
          rx={8}
          fill={
            selected
              ? highlight.bgcolor
              : alpha(theme.palette.background.paper, 0.95)
          }
          stroke={
            selected ? highlight.borderColor : alpha(theme.palette.divider, 1)
          }
          strokeWidth={selected ? 2 : 1}
          filter={`drop-shadow(0 1px 2px ${alpha(theme.palette.common.black, 0.12)})`}
        />
        <rect x={0} y={0} width={4} height={h} rx={2} fill={chip.color} />
        {/* Size cue from call volume */}
        <circle
          cx={w - 12}
          cy={10}
          r={3 + node.callWeight * 3}
          fill={chip.color}
          opacity={0.85}
        />
        <text
          x={14}
          y={15}
          fill={theme.palette.text.primary}
          fontSize={12}
          fontWeight={600}
          fontFamily={
            node.kind === "tool"
              ? theme.typography.mono?.fontFamily
              : undefined
          }
        >
          {label}
        </text>
        <text
          x={14}
          y={28}
          fill={theme.palette.text.secondary}
          fontSize={10}
          fontFamily={theme.typography.mono?.fontFamily}
        >
          {node.sublabel}
        </text>
      </g>
    );
  };

  return (
    <Box sx={{ minWidth: 0, animation: motion.riseFast }}>
      <Box
        sx={{
          position: "relative",
          border: 1,
          borderColor: "divider",
          borderRadius: 1.5,
          bgcolor: alpha(theme.palette.text.primary, 0.02),
          overflow: "hidden",
        }}
      >
        <Stack
          direction="row"
          spacing={0.5}
          sx={{
            position: "absolute",
            top: 8,
            right: 8,
            zIndex: 2,
            bgcolor: alpha(theme.palette.background.paper, 0.92),
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            p: 0.25,
          }}
        >
          <Tooltip title="Zoom in">
            <IconButton
              size="small"
              aria-label="Zoom in"
              onClick={() => zoomBy(ZOOM_STEP)}
            >
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Zoom out">
            <IconButton
              size="small"
              aria-label="Zoom out"
              onClick={() => zoomBy(1 / ZOOM_STEP)}
            >
              <RemoveIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Reset layout & zoom">
            <IconButton
              size="small"
              aria-label="Reset layout and zoom"
              onClick={resetLayout}
            >
              <CenterFocusStrongIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>

        <Box
          ref={viewportRef}
          sx={{
            height: { xs: 320, sm: 380, md: 420 },
            width: "100%",
            touchAction: "none",
            cursor: "grab",
            userSelect: "none",
            "&:active": { cursor: "grabbing" },
          }}
        >
          <Box
            component="svg"
            role="img"
            aria-label="Scatter diagram of agents and the tools they called. Drag nodes to rearrange; scroll or use buttons to zoom."
            width="100%"
            height="100%"
            sx={{ display: "block", fontFamily: theme.typography.fontFamily }}
            onPointerDown={onPointerDownBackground}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <defs>
              <linearGradient
                id={`link-grad-${gradId}`}
                x1="0%"
                y1="0%"
                x2="100%"
                y2="0%"
              >
                <stop
                  offset="0%"
                  stopColor={theme.palette.primary.main}
                  stopOpacity={0.85}
                />
                <stop
                  offset="100%"
                  stopColor={theme.palette.info.main}
                  stopOpacity={0.85}
                />
              </linearGradient>
              <marker
                id={`arrow-${gradId}`}
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path
                  d="M 0 1.5 L 8 5 L 0 8.5 z"
                  fill={theme.palette.info.main}
                  opacity={0.75}
                />
              </marker>
            </defs>

            <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
              <text
                x={WORLD_W * 0.22}
                y={18}
                textAnchor="middle"
                fill={theme.palette.text.secondary}
                fontSize={11}
                letterSpacing="0.06em"
              >
                AGENTS
              </text>
              <text
                x={WORLD_W * 0.78}
                y={18}
                textAnchor="middle"
                fill={theme.palette.text.secondary}
                fontSize={11}
                letterSpacing="0.06em"
              >
                TOOLS
              </text>

              {links.map((link) => {
                const from = positions[link.agentId];
                const to = positions[link.toolName];
                if (!from || !to) return null;
                const active = linkActive(link);
                const weight = link.callCount / maxLink;
                const strokeW = 1.25 + weight * 5;
                const opacity = dimInactive
                  ? active
                    ? 0.95
                    : 0.08
                  : 0.22 + weight * 0.55;
                const dx = to.x - from.x;
                const dy = to.y - from.y;
                const dist = Math.hypot(dx, dy) || 1;
                const half = NODE_W / 2 - 2;
                // Shorten endpoints so arrows meet the node edge
                const sx = from.x + (dx / dist) * half;
                const sy = from.y + (dy / dist) * (NODE_H / 2);
                const ex = to.x - (dx / dist) * half;
                const ey = to.y - (dy / dist) * (NODE_H / 2);
                const midX = (sx + ex) / 2;
                const midY = (sy + ey) / 2;
                // Perpendicular bow for readable scatter flow
                const bow = Math.min(48, dist * 0.18);
                const nx = -dy / dist;
                const ny = dx / dist;
                const cx = midX + nx * bow;
                const cy = midY + ny * bow;
                const d = `M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`;
                return (
                  <g key={`${link.agentId}:${link.toolName}`}>
                    <path
                      d={d}
                      fill="none"
                      stroke={`url(#link-grad-${gradId})`}
                      strokeWidth={strokeW}
                      strokeOpacity={opacity}
                      strokeLinecap="round"
                      markerEnd={
                        dimInactive && !active
                          ? undefined
                          : `url(#arrow-${gradId})`
                      }
                      style={{
                        transition:
                          "stroke-opacity 160ms ease, stroke-width 160ms ease",
                        cursor: onSelectTool ? "pointer" : "default",
                        pointerEvents: "stroke",
                      }}
                      onClick={() =>
                        onSelectTool?.(link.toolName, link.agentId)
                      }
                    >
                      <title>{`${agentNodes.find((a) => a.id === link.agentId)?.label ?? link.agentId} → ${link.toolName} · ${link.callCount} call${link.callCount === 1 ? "" : "s"}`}</title>
                    </path>
                  </g>
                );
              })}

              {allNodes.map(renderNode)}
            </g>
          </Box>
        </Box>
      </Box>

      <Typography
        variant="mono"
        color="text.secondary"
        sx={{
          mt: 1,
          fontSize: { xs: "0.68rem", sm: "0.72rem" },
          lineHeight: 1.4,
        }}
      >
        {pluralize(rows.length, "agent")} · {pluralize(totalCalls, "tool call")}
        {hiddenToolCount > 0
          ? ` · top ${MAX_TOOLS} tools (+${hiddenToolCount} more)`
          : ""}
        {" · "}drag nodes to rearrange · scroll or +/− to zoom · click to focus
      </Typography>
    </Box>
  );
}
