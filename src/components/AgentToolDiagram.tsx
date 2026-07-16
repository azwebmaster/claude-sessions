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
import type { AgentBreakdownRow, ToolImpactRow } from "@shared/types";
import { formatTokens } from "@shared/types";
import { focusHighlight, motion, nodeKindStyle } from "../theme";
import { EmptyState } from "./ui";

interface Props {
  rows: AgentBreakdownRow[];
  /** Optional tool impact rows; used to size tool circles by attributed context growth. */
  toolImpact?: ToolImpactRow[];
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
  /** Normalized 0–1 weight used for circle radius (context-based). */
  contextWeight: number;
  /** Pixel radius of the node circle. */
  radius: number;
  contextTokens: number;
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
/** Expanded world so the radial layout has room to breathe. */
const WORLD_W = 960;
const WORLD_H = 720;
const MIN_SCALE = 0.35;
const MAX_SCALE = 2.75;
const ZOOM_STEP = 1.18;

const AGENT_R_MIN = 28;
const AGENT_R_MAX = 64;
const TOOL_R_MIN = 22;
const TOOL_R_MAX = 48;
/** Distance from center to subagent ring / tool ring. */
const SUBAGENT_RING = 210;
const TOOL_RING = 340;

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function shortAgentLabel(label: string): string {
  if (label.startsWith("Subagent · ")) {
    const id = label.slice("Subagent · ".length);
    return id.length > 14 ? `${id.slice(0, 12)}…` : id;
  }
  return label.length > 16 ? `${label.slice(0, 14)}…` : label;
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

/** Map a 0–1 weight to a radius; sqrt keeps areas closer to perceptual scale. */
function radiusFromWeight(weight: number, minR: number, maxR: number): number {
  const w = clamp(weight, 0, 1);
  return minR + Math.sqrt(w) * (maxR - minR);
}

/**
 * Default layout: root agent at the world center, subagents on an inner ring,
 * tools on an expanded outer ring.
 */
function initialRadialPositions(
  agents: LaidOutNode[],
  tools: LaidOutNode[],
): Record<string, Point> {
  const positions: Record<string, Point> = {};
  const cx = WORLD_W / 2;
  const cy = WORLD_H / 2;

  // Prefer the root agent at center; fall back to the first agent.
  const centerAgent =
    agents.find((a) => a.agentKind === "root_agent") ?? agents[0];
  const ringAgents = agents.filter((a) => a.id !== centerAgent?.id);

  if (centerAgent) {
    positions[centerAgent.id] = { x: cx, y: cy };
  }

  const placeOnRing = (
    nodes: LaidOutNode[],
    ringRadius: number,
    angleOffset: number,
  ) => {
    const n = nodes.length;
    if (n === 0) return;
    nodes.forEach((node, i) => {
      const baseAngle =
        n === 1
          ? angleOffset
          : angleOffset + (i / n) * Math.PI * 2 - Math.PI / 2;
      const jitter =
        (hash01(`${node.id}:ang`) - 0.5) * (n > 1 ? (Math.PI * 2) / n : 0) * 0.35;
      const rJitter = (hash01(`${node.id}:r`) - 0.5) * ringRadius * 0.12;
      const angle = baseAngle + jitter;
      const r = ringRadius + rJitter;
      positions[node.id] = {
        x: clamp(cx + Math.cos(angle) * r, node.radius + 16, WORLD_W - node.radius - 16),
        y: clamp(cy + Math.sin(angle) * r, node.radius + 16, WORLD_H - node.radius - 16),
      };
    });
  };

  // Subagents (and extra roots) on the inner ring; tools on the expanded outer ring.
  placeOnRing(ringAgents, SUBAGENT_RING, 0);
  placeOnRing(
    tools,
    TOOL_RING,
    tools.length > 0 ? Math.PI / tools.length : 0,
  );

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
    Math.min(containerW / WORLD_W, containerH / WORLD_H) * 0.92,
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
  toolImpact = [],
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

  const toolContextByName = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of toolImpact) {
      map.set(row.toolName, row.contextGrowthAttributed);
    }
    return map;
  }, [toolImpact]);

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

      const maxAgentCtx = Math.max(...rows.map((r) => r.peakContextTokens), 1);
      const toolCtxValues = visible.map(
        (t) => toolContextByName.get(t.toolName) ?? 0,
      );
      const maxToolCtx = Math.max(...toolCtxValues, 1);
      // If no tool impact data, fall back to call volume so sizes still vary.
      const useToolCallsFallback = toolCtxValues.every((v) => v === 0);
      const maxToolCalls = Math.max(...visible.map((t) => t.callCount), 1);

      const agents: LaidOutNode[] = rows.map((row) => {
        const contextWeight = row.peakContextTokens / maxAgentCtx;
        return {
          id: row.agentId,
          label: shortAgentLabel(row.label),
          sublabel: formatTokens(row.peakContextTokens),
          kind: "agent" as const,
          agentKind: row.kind,
          contextWeight,
          radius: radiusFromWeight(contextWeight, AGENT_R_MIN, AGENT_R_MAX),
          contextTokens: row.peakContextTokens,
        };
      });
      const tools: LaidOutNode[] = visible.map((tool) => {
        const ctx = toolContextByName.get(tool.toolName) ?? 0;
        const contextWeight = useToolCallsFallback
          ? tool.callCount / maxToolCalls
          : ctx / maxToolCtx;
        return {
          id: tool.toolName,
          label: tool.toolName,
          sublabel: useToolCallsFallback
            ? `${tool.callCount}×`
            : formatTokens(ctx),
          kind: "tool" as const,
          contextWeight,
          radius: radiusFromWeight(contextWeight, TOOL_R_MIN, TOOL_R_MAX),
          contextTokens: ctx,
        };
      });

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
    }, [rows, toolContextByName]);

  const [positions, setPositions] = useState<Record<string, Point>>(() =>
    initialRadialPositions(agentNodes, toolNodes),
  );
  const [view, setView] = useState<ViewTransform>({ scale: 1, tx: 0, ty: 0 });
  const layoutKeyRef = useRef(layoutKey);

  // Re-layout when the agent/tool set changes (not when counts alone update).
  useEffect(() => {
    if (layoutKeyRef.current === layoutKey) return;
    layoutKeyRef.current = layoutKey;
    setPositions(initialRadialPositions(agentNodes, toolNodes));
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

  const nodeRadiusById = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of allNodes) map.set(n.id, n.radius);
    return map;
  }, [allNodes]);

  const resetLayout = useCallback(() => {
    setPositions(initialRadialPositions(agentNodes, toolNodes));
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
    const r = node.radius;
    const selectable =
      node.kind === "agent" ? Boolean(onSelectAgent) : Boolean(onSelectTool);
    const label =
      node.kind === "tool" && node.label.length > 12
        ? `${node.label.slice(0, 10)}…`
        : node.label;
    const kindHint =
      node.kind === "tool"
        ? "tool"
        : node.agentKind === "subagent"
          ? "subagent"
          : "root agent";

    return (
      <g
        key={node.id}
        data-diagram-node={node.id}
        transform={`translate(${pos.x}, ${pos.y})`}
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
        <title>{`${node.label} (${kindHint}) · ${node.sublabel} context · drag to rearrange`}</title>
        <circle
          r={r}
          fill={
            selected
              ? highlight.bgcolor
              : alpha(theme.palette.background.paper, 0.96)
          }
          stroke={selected ? highlight.borderColor : chip.color}
          strokeWidth={selected ? 2.5 : 2}
          filter={`drop-shadow(0 1px 3px ${alpha(theme.palette.common.black, 0.14)})`}
        />
        <circle
          r={r}
          fill={alpha(chip.color, selected ? 0.22 : 0.12)}
          stroke="none"
          style={{ pointerEvents: "none" }}
        />
        <text
          textAnchor="middle"
          y={-2}
          fill={theme.palette.text.primary}
          fontSize={r >= 40 ? 12 : 10}
          fontWeight={600}
          fontFamily={
            node.kind === "tool"
              ? theme.typography.mono?.fontFamily
              : undefined
          }
          style={{ pointerEvents: "none" }}
        >
          {label}
        </text>
        <text
          textAnchor="middle"
          y={r >= 36 ? 14 : 12}
          fill={theme.palette.text.secondary}
          fontSize={10}
          fontFamily={theme.typography.mono?.fontFamily}
          style={{ pointerEvents: "none" }}
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
            height: { xs: 360, sm: 440, md: 520 },
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
            aria-label="Radial diagram of agents and tools. Circle size reflects context size. Root agent is centered; drag nodes to rearrange; scroll or use buttons to zoom."
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
              {/* Soft guide rings for the radial layout */}
              <circle
                cx={WORLD_W / 2}
                cy={WORLD_H / 2}
                r={SUBAGENT_RING}
                fill="none"
                stroke={alpha(theme.palette.divider, 0.55)}
                strokeWidth={1}
                strokeDasharray="4 6"
              />
              <circle
                cx={WORLD_W / 2}
                cy={WORLD_H / 2}
                r={TOOL_RING}
                fill="none"
                stroke={alpha(theme.palette.divider, 0.4)}
                strokeWidth={1}
                strokeDasharray="2 8"
              />

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
                const fromR = (nodeRadiusById.get(link.agentId) ?? AGENT_R_MIN) - 1;
                const toR = (nodeRadiusById.get(link.toolName) ?? TOOL_R_MIN) - 1;
                // Shorten endpoints so arrows meet the circle edge
                const sx = from.x + (dx / dist) * fromR;
                const sy = from.y + (dy / dist) * fromR;
                const ex = to.x - (dx / dist) * toR;
                const ey = to.y - (dy / dist) * toR;
                const midX = (sx + ex) / 2;
                const midY = (sy + ey) / 2;
                const bow = Math.min(56, dist * 0.16);
                const nx = -dy / dist;
                const ny = dx / dist;
                const cpx = midX + nx * bow;
                const cpy = midY + ny * bow;
                const d = `M ${sx} ${sy} Q ${cpx} ${cpy} ${ex} ${ey}`;
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
        {" · "}circle size = context
        {" · "}root centered · drag to rearrange · scroll or +/− to zoom · click
        to focus
      </Typography>
    </Box>
  );
}
