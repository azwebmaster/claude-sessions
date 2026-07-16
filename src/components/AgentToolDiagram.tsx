import { useId, useMemo } from "react";
import { Box, Typography } from "@mui/material";
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

interface LaidOutNode {
  id: string;
  label: string;
  sublabel: string;
  x: number;
  y: number;
  kind: "agent" | "tool";
  agentKind?: "root_agent" | "subagent";
}

const MAX_TOOLS = 12;
const SVG_WIDTH = 720;
const LEFT_X = 118;
const RIGHT_X = 602;
const NODE_H = 36;
const TOP_PAD = 28;
const BOTTOM_PAD = 20;

function shortAgentLabel(label: string): string {
  if (label.startsWith("Subagent · ")) {
    const id = label.slice("Subagent · ".length);
    return id.length > 18 ? `${id.slice(0, 16)}…` : id;
  }
  return label.length > 22 ? `${label.slice(0, 20)}…` : label;
}

function layoutNodes(
  agents: AgentBreakdownRow[],
  tools: { toolName: string; callCount: number }[],
): { agentNodes: LaidOutNode[]; toolNodes: LaidOutNode[]; height: number } {
  const rows = Math.max(agents.length, tools.length, 1);
  const height = TOP_PAD + rows * (NODE_H + 14) + BOTTOM_PAD;

  const agentNodes = agents.map((row, i) => {
    const y =
      agents.length === 1
        ? height / 2
        : TOP_PAD +
          NODE_H / 2 +
          (i * (height - TOP_PAD - BOTTOM_PAD - NODE_H)) /
            Math.max(agents.length - 1, 1);
    return {
      id: row.agentId,
      label: shortAgentLabel(row.label),
      sublabel: `${row.toolCallCount} calls`,
      x: LEFT_X,
      y,
      kind: "agent" as const,
      agentKind: row.kind,
    };
  });

  const toolNodes = tools.map((tool, i) => {
    const y =
      tools.length === 1
        ? height / 2
        : TOP_PAD +
          NODE_H / 2 +
          (i * (height - TOP_PAD - BOTTOM_PAD - NODE_H)) /
            Math.max(tools.length - 1, 1);
    return {
      id: tool.toolName,
      label: tool.toolName,
      sublabel: `${tool.callCount}×`,
      x: RIGHT_X,
      y,
      kind: "tool" as const,
    };
  });

  return { agentNodes, toolNodes, height };
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

  const { links, tools, hiddenToolCount, totalCalls } = useMemo(() => {
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
    return {
      links: linkList.filter((l) => visibleNames.has(l.toolName)),
      tools: visible,
      hiddenToolCount: Math.max(0, ranked.length - visible.length),
      totalCalls: calls,
    };
  }, [rows]);

  const { agentNodes, toolNodes, height } = useMemo(
    () => layoutNodes(rows, tools),
    [rows, tools],
  );

  if (rows.length === 0) {
    return <EmptyState>No agents found.</EmptyState>;
  }

  if (totalCalls === 0) {
    return <EmptyState>No tool calls in this session.</EmptyState>;
  }

  const agentById = new Map(agentNodes.map((n) => [n.id, n]));
  const toolByName = new Map(toolNodes.map((n) => [n.id, n]));
  const maxLink = Math.max(...links.map((l) => l.callCount), 1);

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

  const dimInactive =
    Boolean(selectedAgentId) || Boolean(selectedToolName);

  return (
    <Box sx={{ minWidth: 0, animation: motion.riseFast }}>
      <Box
        sx={{
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          overscrollBehaviorX: "contain",
          mx: { xs: -0.5, sm: 0 },
          px: { xs: 0.5, sm: 0 },
        }}
      >
        <Box
          component="svg"
          role="img"
          aria-label="Diagram of agents and the tools they called"
          viewBox={`0 0 ${SVG_WIDTH} ${height}`}
          sx={{
            display: "block",
            width: "100%",
            minWidth: { xs: 520, sm: 640 },
            height: "auto",
            maxHeight: { xs: 360, md: 420 },
            fontFamily: theme.typography.fontFamily,
          }}
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
          </defs>

          <text
            x={LEFT_X}
            y={16}
            textAnchor="middle"
            fill={theme.palette.text.secondary}
            fontSize={11}
            letterSpacing="0.06em"
          >
            AGENTS
          </text>
          <text
            x={RIGHT_X}
            y={16}
            textAnchor="middle"
            fill={theme.palette.text.secondary}
            fontSize={11}
            letterSpacing="0.06em"
          >
            TOOLS
          </text>

          {links.map((link) => {
            const from = agentById.get(link.agentId);
            const to = toolByName.get(link.toolName);
            if (!from || !to) return null;
            const active = linkActive(link);
            const weight = link.callCount / maxLink;
            const strokeW = 1.25 + weight * 5;
            const opacity = dimInactive
              ? active
                ? 0.95
                : 0.08
              : 0.25 + weight * 0.55;
            const midX = (from.x + to.x) / 2;
            const d = `M ${from.x + 72} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x - 72} ${to.y}`;
            return (
              <g key={`${link.agentId}:${link.toolName}`}>
                <path
                  d={d}
                  fill="none"
                  stroke={`url(#link-grad-${gradId})`}
                  strokeWidth={strokeW}
                  strokeOpacity={opacity}
                  strokeLinecap="round"
                  style={{
                    transition: "stroke-opacity 160ms ease, stroke-width 160ms ease",
                    cursor: onSelectTool ? "pointer" : "default",
                  }}
                  onClick={() => onSelectTool?.(link.toolName, link.agentId)}
                >
                  <title>{`${from.label} → ${link.toolName} · ${link.callCount} call${link.callCount === 1 ? "" : "s"}`}</title>
                </path>
              </g>
            );
          })}

          {agentNodes.map((node) => {
            const selected = selectedAgentId === node.id;
            const related =
              selected ||
              (selectedToolName != null &&
                links.some(
                  (l) =>
                    l.agentId === node.id && l.toolName === selectedToolName,
                ));
            const faded = dimInactive && !related;
            const chip =
              node.agentKind === "subagent" ? subStyle : rootStyle;
            const w = 144;
            const h = NODE_H;
            return (
              <g
                key={node.id}
                transform={`translate(${node.x - w / 2}, ${node.y - h / 2})`}
                opacity={faded ? 0.28 : 1}
                style={{
                  cursor: onSelectAgent ? "pointer" : "default",
                  transition: "opacity 160ms ease",
                }}
                onClick={() => onSelectAgent?.(node.id)}
                role={onSelectAgent ? "button" : undefined}
                tabIndex={onSelectAgent ? 0 : undefined}
                onKeyDown={(e) => {
                  if (!onSelectAgent) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectAgent(node.id);
                  }
                }}
              >
                <title>{`${node.label} · ${node.sublabel}`}</title>
                <rect
                  width={w}
                  height={h}
                  rx={8}
                  fill={
                    selected
                      ? highlight.bgcolor
                      : alpha(theme.palette.background.paper, 0.92)
                  }
                  stroke={
                    selected
                      ? highlight.borderColor
                      : alpha(theme.palette.divider, 1)
                  }
                  strokeWidth={selected ? 2 : 1}
                />
                <rect
                  x={0}
                  y={0}
                  width={4}
                  height={h}
                  rx={2}
                  fill={chip.color}
                />
                <text
                  x={14}
                  y={15}
                  fill={theme.palette.text.primary}
                  fontSize={12}
                  fontWeight={600}
                >
                  {node.label}
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
          })}

          {toolNodes.map((node) => {
            const selected = selectedToolName === node.id;
            const related =
              selected ||
              (selectedAgentId != null &&
                links.some(
                  (l) =>
                    l.toolName === node.id && l.agentId === selectedAgentId,
                ));
            const faded = dimInactive && !related;
            const w = 144;
            const h = NODE_H;
            return (
              <g
                key={node.id}
                transform={`translate(${node.x - w / 2}, ${node.y - h / 2})`}
                opacity={faded ? 0.28 : 1}
                style={{
                  cursor: onSelectTool ? "pointer" : "default",
                  transition: "opacity 160ms ease",
                }}
                onClick={() => onSelectTool?.(node.id)}
                role={onSelectTool ? "button" : undefined}
                tabIndex={onSelectTool ? 0 : undefined}
                onKeyDown={(e) => {
                  if (!onSelectTool) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectTool(node.id);
                  }
                }}
              >
                <title>{`${node.label} · ${node.sublabel}`}</title>
                <rect
                  width={w}
                  height={h}
                  rx={8}
                  fill={
                    selected
                      ? highlight.bgcolor
                      : alpha(theme.palette.background.paper, 0.92)
                  }
                  stroke={
                    selected
                      ? highlight.borderColor
                      : alpha(theme.palette.divider, 1)
                  }
                  strokeWidth={selected ? 2 : 1}
                />
                <rect
                  x={0}
                  y={0}
                  width={4}
                  height={h}
                  rx={2}
                  fill={toolStyle.color}
                />
                <text
                  x={14}
                  y={15}
                  fill={theme.palette.text.primary}
                  fontSize={12}
                  fontWeight={600}
                  fontFamily={theme.typography.mono?.fontFamily}
                >
                  {node.label.length > 16
                    ? `${node.label.slice(0, 14)}…`
                    : node.label}
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
          })}
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
        {rows.length} agent{rows.length === 1 ? "" : "s"} · {totalCalls} tool
        call{totalCalls === 1 ? "" : "s"}
        {hiddenToolCount > 0 ? ` · top ${MAX_TOOLS} tools (+${hiddenToolCount} more)` : ""}
        {" · "}click an agent, tool, or link to focus the hierarchy
      </Typography>
    </Box>
  );
}
