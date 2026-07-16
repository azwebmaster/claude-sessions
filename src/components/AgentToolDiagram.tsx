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
import UnfoldLessIcon from "@mui/icons-material/UnfoldLess";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import {
  Box,
  Button,
  IconButton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import type { AgentBreakdownRow, ToolImpactRow } from "@shared/types";
import { formatTokens, totalTokens } from "@shared/types";
import { focusHighlight, motion, nodeKindStyle } from "../theme";
import { EmptyState } from "./ui";

/** How agent circle radii are derived. Tools stay on attributed growth. */
export type AgentSizeMetric = "peakContext" | "totalTokens";

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
  /** Normalized 0–1 weight used for circle radius. */
  sizeWeight: number;
  /** Pixel radius of the node circle. */
  radius: number;
  /** Token count shown in the sublabel (metric-dependent for agents). */
  sizeTokens: number;
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

/** Collapsed view keeps the densest sessions readable. */
const COLLAPSED_MAX_TOOLS = 12;
/** Prefer two tool rings once the outer ring would feel crowded. */
const TOOLS_PER_RING = 14;
const MIN_SCALE = 0.28;
const MAX_SCALE = 2.75;
const ZOOM_STEP = 1.18;

const AGENT_R_MIN = 28;
const AGENT_R_MAX = 64;
const TOOL_R_MIN = 20;
const TOOL_R_MAX = 48;

interface WorldMetrics {
  width: number;
  height: number;
  subagentRing: number;
  toolRings: number[];
}

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

/** Scale the canvas and ring radii with how many nodes we need to place. */
function worldMetrics(agentCount: number, toolCount: number): WorldMetrics {
  const ringAgents = Math.max(0, agentCount - 1);
  const toolRingCount = Math.max(1, Math.ceil(Math.max(toolCount, 1) / TOOLS_PER_RING));
  const subagentRing = clamp(190 + ringAgents * 8, 190, 280);
  const firstToolRing = subagentRing + clamp(110 + toolCount * 2, 120, 200);
  const toolRings: number[] = [];
  for (let i = 0; i < toolRingCount; i++) {
    toolRings.push(firstToolRing + i * 110);
  }
  const outer = toolRings[toolRings.length - 1] ?? firstToolRing;
  const pad = 96;
  const side = Math.ceil((outer + pad) * 2);
  return {
    width: clamp(side, 960, 1600),
    height: clamp(side, 720, 1400),
    subagentRing,
    toolRings,
  };
}

/** Map a 0–1 weight to a radius; sqrt keeps areas closer to perceptual scale. */
function radiusFromWeight(weight: number, minR: number, maxR: number): number {
  const w = clamp(weight, 0, 1);
  return minR + Math.sqrt(w) * (maxR - minR);
}

/**
 * Default layout: root agent at the world center, subagents on an inner ring,
 * tools on one or more expanded outer rings (extra rings when the set is large).
 */
function initialRadialPositions(
  agents: LaidOutNode[],
  tools: LaidOutNode[],
  world: WorldMetrics,
): Record<string, Point> {
  const positions: Record<string, Point> = {};
  const cx = world.width / 2;
  const cy = world.height / 2;

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
      const rJitter = (hash01(`${node.id}:r`) - 0.5) * ringRadius * 0.1;
      const angle = baseAngle + jitter;
      const r = ringRadius + rJitter;
      positions[node.id] = {
        x: clamp(cx + Math.cos(angle) * r, node.radius + 16, world.width - node.radius - 16),
        y: clamp(cy + Math.sin(angle) * r, node.radius + 16, world.height - node.radius - 16),
      };
    });
  };

  placeOnRing(ringAgents, world.subagentRing, 0);

  // Distribute tools across concentric outer rings so expanded views stay readable.
  const ringCount = Math.max(1, world.toolRings.length);
  const perRing = Math.ceil(tools.length / ringCount) || 1;
  world.toolRings.forEach((ringRadius, ringIndex) => {
    const slice = tools.slice(ringIndex * perRing, (ringIndex + 1) * perRing);
    placeOnRing(
      slice,
      ringRadius,
      slice.length > 0
        ? Math.PI / slice.length + ringIndex * (Math.PI / Math.max(slice.length, 2))
        : 0,
    );
  });

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

function fitView(
  containerW: number,
  containerH: number,
  world: WorldMetrics,
): ViewTransform {
  const scale = clamp(
    Math.min(containerW / world.width, containerH / world.height) * 0.92,
    MIN_SCALE,
    MAX_SCALE,
  );
  return {
    scale,
    tx: (containerW - world.width * scale) / 2,
    ty: (containerH - world.height * scale) / 2,
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

  const [showAllTools, setShowAllTools] = useState(false);
  const [agentSizeMetric, setAgentSizeMetric] =
    useState<AgentSizeMetric>("peakContext");

  const toolContextByName = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of toolImpact) {
      map.set(row.toolName, row.contextGrowthAttributed);
    }
    return map;
  }, [toolImpact]);

  const agentSizeCaption =
    agentSizeMetric === "peakContext" ? "peak context" : "total tokens";

  const {
    links,
    agentNodes,
    toolNodes,
    hiddenToolCount,
    totalToolKinds,
    totalCalls,
    world,
    layoutKey,
  } = useMemo(() => {
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
    const canExpand = ranked.length > COLLAPSED_MAX_TOOLS;
    const visible =
      showAllTools || !canExpand
        ? ranked
        : ranked.slice(0, COLLAPSED_MAX_TOOLS);
    const visibleNames = new Set(visible.map((t) => t.toolName));

    const agentSizeValues = rows.map((r) =>
      agentSizeMetric === "peakContext"
        ? r.peakContextTokens
        : totalTokens(r.usage),
    );
    const maxAgentSize = Math.max(...agentSizeValues, 1);
    const toolCtxValues = visible.map(
      (t) => toolContextByName.get(t.toolName) ?? 0,
    );
    const maxToolCtx = Math.max(...toolCtxValues, 1);
    // If no tool impact data, fall back to call volume so sizes still vary.
    const useToolCallsFallback = toolCtxValues.every((v) => v === 0);
    const maxToolCalls = Math.max(...visible.map((t) => t.callCount), 1);

    const agents: LaidOutNode[] = rows.map((row, i) => {
      const sizeTokens = agentSizeValues[i] ?? 0;
      const sizeWeight = sizeTokens / maxAgentSize;
      return {
        id: row.agentId,
        label: shortAgentLabel(row.label),
        sublabel: formatTokens(sizeTokens),
        kind: "agent" as const,
        agentKind: row.kind,
        sizeWeight,
        radius: radiusFromWeight(sizeWeight, AGENT_R_MIN, AGENT_R_MAX),
        sizeTokens,
      };
    });
    const tools: LaidOutNode[] = visible.map((tool) => {
      const ctx = toolContextByName.get(tool.toolName) ?? 0;
      const sizeWeight = useToolCallsFallback
        ? tool.callCount / maxToolCalls
        : ctx / maxToolCtx;
      // Slightly smaller circles when many tools share the canvas.
      const toolRMax =
        visible.length > COLLAPSED_MAX_TOOLS ? TOOL_R_MAX - 6 : TOOL_R_MAX;
      return {
        id: tool.toolName,
        label: tool.toolName,
        sublabel: useToolCallsFallback
          ? `${tool.callCount}×`
          : formatTokens(ctx),
        kind: "tool" as const,
        sizeWeight,
        radius: radiusFromWeight(sizeWeight, TOOL_R_MIN, toolRMax),
        sizeTokens: ctx,
      };
    });

    const metrics = worldMetrics(agents.length, tools.length);

    return {
      links: linkList.filter((l) => visibleNames.has(l.toolName)),
      agentNodes: agents,
      toolNodes: tools,
      hiddenToolCount: Math.max(0, ranked.length - visible.length),
      totalToolKinds: ranked.length,
      totalCalls: calls,
      world: metrics,
      layoutKey: [
        showAllTools ? "all" : "top",
        ...agents.map((a) => a.id),
        ...tools.map((t) => t.id),
      ].join("|"),
    };
  }, [rows, toolContextByName, showAllTools, agentSizeMetric]);

  const [positions, setPositions] = useState<Record<string, Point>>(() =>
    initialRadialPositions(agentNodes, toolNodes, world),
  );
  const [view, setView] = useState<ViewTransform>({ scale: 1, tx: 0, ty: 0 });
  const layoutKeyRef = useRef(layoutKey);
  const worldRef = useRef(world);
  worldRef.current = world;

  // Re-layout when the agent/tool set or expand mode changes.
  useEffect(() => {
    if (layoutKeyRef.current === layoutKey) return;
    layoutKeyRef.current = layoutKey;
    setPositions(initialRadialPositions(agentNodes, toolNodes, world));
  }, [layoutKey, agentNodes, toolNodes, world]);

  // Fit the world into the viewport when the graph membership changes.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setView(fitView(rect.width, rect.height, world));
    }
  }, [layoutKey, world]);

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
        return fitView(width, height, worldRef.current);
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
    setPositions(initialRadialPositions(agentNodes, toolNodes, world));
    const el = viewportRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setView(fitView(rect.width, rect.height, world));
    }
  }, [agentNodes, toolNodes, world]);

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
      const worldPt = clientToWorld(e.clientX, e.clientY);
      dragRef.current = {
        type: "node",
        nodeId,
        pointerId: e.pointerId,
        offsetX: worldPt.x - pos.x,
        offsetY: worldPt.y - pos.y,
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
      const worldPt = clientToWorld(e.clientX, e.clientY);
      const next = {
        x: worldPt.x - drag.offsetX,
        y: worldPt.y - drag.offsetY,
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
  const canExpandTools = totalToolKinds > COLLAPSED_MAX_TOOLS;

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
    const metricHint =
      node.kind === "tool" ? "attributed growth" : agentSizeCaption;

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
        <title>{`${node.label} (${kindHint}) · ${node.sublabel} ${metricHint} · drag to rearrange`}</title>
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
            left: 8,
            zIndex: 2,
            alignItems: "center",
            bgcolor: alpha(theme.palette.background.paper, 0.92),
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            p: 0.25,
          }}
        >
          <ToggleButtonGroup
            exclusive
            size="small"
            value={agentSizeMetric}
            onChange={(_e, value: AgentSizeMetric | null) => {
              if (value != null) setAgentSizeMetric(value);
            }}
            aria-label="Agent circle size metric"
          >
            <ToggleButton
              value="peakContext"
              aria-label="Size agents by peak context"
              sx={{
                textTransform: "none",
                fontSize: "0.72rem",
                px: 1,
                py: 0.25,
                color: "text.secondary",
                border: "none",
              }}
            >
              Peak ctx
            </ToggleButton>
            <ToggleButton
              value="totalTokens"
              aria-label="Size agents by total tokens"
              sx={{
                textTransform: "none",
                fontSize: "0.72rem",
                px: 1,
                py: 0.25,
                color: "text.secondary",
                border: "none",
              }}
            >
              Tokens
            </ToggleButton>
          </ToggleButtonGroup>
        </Stack>

        <Stack
          direction="row"
          spacing={0.5}
          sx={{
            position: "absolute",
            top: 8,
            right: 8,
            zIndex: 2,
            alignItems: "center",
            bgcolor: alpha(theme.palette.background.paper, 0.92),
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            p: 0.25,
          }}
        >
          {canExpandTools ? (
            <Tooltip
              title={
                showAllTools
                  ? `Show top ${COLLAPSED_MAX_TOOLS} tools`
                  : `Show all ${totalToolKinds} tools`
              }
            >
              <Button
                size="small"
                color="inherit"
                aria-pressed={showAllTools}
                aria-label={
                  showAllTools
                    ? `Collapse to top ${COLLAPSED_MAX_TOOLS} tools`
                    : `Expand to all ${totalToolKinds} tools`
                }
                onClick={() => setShowAllTools((v) => !v)}
                startIcon={
                  showAllTools ? (
                    <UnfoldLessIcon fontSize="small" />
                  ) : (
                    <UnfoldMoreIcon fontSize="small" />
                  )
                }
                sx={{
                  textTransform: "none",
                  fontSize: "0.72rem",
                  px: 1,
                  minWidth: 0,
                  color: "text.secondary",
                }}
              >
                {showAllTools ? "Top tools" : "All tools"}
              </Button>
            </Tooltip>
          ) : null}
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
            height: {
              xs: showAllTools ? 440 : 400,
              sm: showAllTools ? 560 : 480,
              md: showAllTools ? 640 : 560,
            },
            width: "100%",
            touchAction: "none",
            cursor: "grab",
            userSelect: "none",
            transition: "height 220ms ease",
            "&:active": { cursor: "grabbing" },
          }}
        >
          <Box
            component="svg"
            role="img"
            aria-label={`Radial diagram of agents and tools. Agent circle size reflects ${agentSizeCaption}; tool circles reflect attributed context growth. Root agent is centered; drag nodes to rearrange; scroll or use buttons to zoom.`}
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
                cx={world.width / 2}
                cy={world.height / 2}
                r={world.subagentRing}
                fill="none"
                stroke={alpha(theme.palette.divider, 0.55)}
                strokeWidth={1}
                strokeDasharray="4 6"
              />
              {world.toolRings.map((ring) => (
                <circle
                  key={ring}
                  cx={world.width / 2}
                  cy={world.height / 2}
                  r={ring}
                  fill="none"
                  stroke={alpha(theme.palette.divider, 0.4)}
                  strokeWidth={1}
                  strokeDasharray="2 8"
                />
              ))}

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

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={{ xs: 0.75, sm: 1.5 }}
        sx={{
          mt: 1,
          alignItems: { xs: "stretch", sm: "center" },
          justifyContent: "space-between",
        }}
      >
        <Typography
          variant="mono"
          color="text.secondary"
          sx={{
            fontSize: { xs: "0.68rem", sm: "0.72rem" },
            lineHeight: 1.4,
          }}
        >
          {pluralize(rows.length, "agent")} · {pluralize(totalCalls, "tool call")}
          {showAllTools
            ? ` · all ${totalToolKinds} tools`
            : hiddenToolCount > 0
              ? ` · top ${COLLAPSED_MAX_TOOLS} tools (+${hiddenToolCount} more)`
              : totalToolKinds > 0
                ? ` · ${pluralize(totalToolKinds, "tool")}`
                : ""}
          {" · "}agent size = {agentSizeCaption}
          {" · "}tool size = attributed growth
          {" · "}root centered · drag to rearrange · scroll or +/− to zoom · click
          to focus
        </Typography>
        {canExpandTools && !showAllTools ? (
          <Button
            size="small"
            variant="text"
            color="primary"
            onClick={() => setShowAllTools(true)}
            startIcon={<UnfoldMoreIcon fontSize="small" />}
            sx={{
              alignSelf: { xs: "flex-start", sm: "center" },
              textTransform: "none",
              fontSize: "0.75rem",
              px: 0.5,
              minWidth: 0,
            }}
          >
            Expand diagram (+{hiddenToolCount} tools)
          </Button>
        ) : null}
      </Stack>
    </Box>
  );
}
