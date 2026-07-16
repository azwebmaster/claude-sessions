import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Chip,
  Collapse,
  Stack,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import type {
  LoadedContextItem,
  LoadedContextKind,
  TurnLoadedContext,
} from "@shared/types";
import { formatTokens } from "@shared/types";
import {
  alertSurface,
  contextItemKindStyle,
  motion,
} from "../theme";
import { EmptyState, ExpandableRow } from "./ui";

interface Props {
  snapshot: TurnLoadedContext | null;
  onSelectEvidence?: (item: LoadedContextItem) => void;
}

function exact(n: number): string {
  return n.toLocaleString();
}

function provenanceLabel(
  provenance: LoadedContextItem["provenance"],
): string {
  switch (provenance) {
    case "observed":
      return "observed";
    case "baseline":
      return "baseline";
    case "inferred":
      return "inferred";
  }
}

export function LoadedContextPanel({ snapshot, onSelectEvidence }: Props) {
  const theme = useTheme();
  const surface = alertSurface(theme, "info");
  const [openKinds, setOpenKinds] = useState<Set<LoadedContextKind>>(
    () => new Set(),
  );

  const itemsByKind = useMemo(() => {
    if (!snapshot) return new Map<LoadedContextKind, LoadedContextItem[]>();
    const map = new Map<LoadedContextKind, LoadedContextItem[]>();
    for (const item of snapshot.items) {
      const list = map.get(item.kind) ?? [];
      list.push(item);
      map.set(item.kind, list);
    }
    return map;
  }, [snapshot]);

  useEffect(() => {
    if (!snapshot) return;
    // Auto-expand the harness layers first; conversation/tool noise stays collapsed.
    const preferred: LoadedContextKind[] = [
      "system_prompt",
      "instruction",
      "memory",
      "mcp",
      "skill",
      "deferred_tools",
      "tool_schema",
      "file",
    ];
    setOpenKinds(
      new Set(
        snapshot.categories
          .map((c) => c.kind)
          .filter((kind) => preferred.includes(kind)),
      ),
    );
  }, [snapshot?.nodeId]);

  if (!snapshot) {
    return (
      <Box
        sx={{
          mt: 2,
          p: 1.5,
          borderRadius: 1.5,
          border: 1,
          borderColor: "divider",
          bgcolor: "action.hover",
        }}
      >
        <Typography color="text.secondary" sx={{ fontSize: "0.85rem" }}>
          Select a timeline turn to see what was loaded into Claude&apos;s
          context at that moment — system prompt, instructions, MCPs, skills,
          files, and conversation accretion.
        </Typography>
      </Box>
    );
  }

  const toggleKind = (kind: LoadedContextKind) => {
    setOpenKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const attributed = snapshot.categories.reduce(
    (sum, c) => sum + (c.estimatedTokens ?? 0),
    0,
  );

  return (
    <Box
      sx={{
        mt: 2,
        p: 1.75,
        borderRadius: 1.5,
        border: 1,
        ...surface,
        animation: motion.riseFast,
      }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{
          justifyContent: "space-between",
          alignItems: { sm: "baseline" },
          mb: 1,
        }}
      >
        <Box>
          <Typography variant="subtitle2" sx={{ fontSize: "0.95rem" }}>
            Loaded into Claude context · turn {snapshot.turn}
          </Typography>
          <Typography color="text.secondary" sx={{ fontSize: "0.82rem", mt: 0.35 }}>
            Inventory of harness layers and conversation material present when
            this API call ran.
          </Typography>
        </Box>
        <Typography variant="mono" sx={{ fontSize: "0.78rem", fontWeight: 650 }}>
          {formatTokens(snapshot.contextTokens)}
          <Box
            component="span"
            sx={{ color: "text.secondary", fontWeight: 400, ml: 0.75 }}
          >
            measured ctx
          </Box>
        </Typography>
      </Stack>

      {snapshot.categories.length === 0 ? (
        <EmptyState sx={{ py: 1.5 }}>
          No context inventory could be reconstructed for this turn.
        </EmptyState>
      ) : (
        <>
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              gap: 0.75,
              mb: 1.25,
            }}
          >
            {snapshot.categories.map((category) => {
              const style = contextItemKindStyle(theme, category.kind);
              return (
                <Chip
                  key={category.kind}
                  size="small"
                  label={`${category.label} · ${category.itemCount}${
                    category.estimatedTokens != null
                      ? ` · ${formatTokens(category.estimatedTokens)}`
                      : ""
                  }`}
                  onClick={() => toggleKind(category.kind)}
                  sx={{
                    bgcolor: style.bg,
                    color: style.color,
                    fontWeight: 600,
                    borderRadius: 1,
                    "& .MuiChip-label": { px: 1 },
                  }}
                />
              );
            })}
          </Box>

          <Stack spacing={0.5}>
            {snapshot.categories.map((category) => {
              const open = openKinds.has(category.kind);
              const items = itemsByKind.get(category.kind) ?? [];
              const style = contextItemKindStyle(theme, category.kind);
              return (
                <Box
                  key={category.kind}
                  sx={{
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1,
                    bgcolor: "background.paper",
                    overflow: "hidden",
                  }}
                >
                  <ExpandableRow
                    expanded={open}
                    onActivate={() => toggleKind(category.kind)}
                    leading={
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: 0.5,
                          bgcolor: style.color,
                          mt: 0.7,
                        }}
                      />
                    }
                    body={
                      <Box>
                        <Typography sx={{ fontSize: "0.84rem", fontWeight: 650 }}>
                          {category.label}
                        </Typography>
                        <Typography color="text.secondary" sx={{ fontSize: "0.72rem" }}>
                          {category.itemCount} item
                          {category.itemCount === 1 ? "" : "s"}
                          {category.estimatedTokens != null
                            ? ` · ~${formatTokens(category.estimatedTokens)} est`
                            : ""}
                        </Typography>
                      </Box>
                    }
                    trailing={
                      <Typography variant="mono" color="text.secondary" sx={{ fontSize: "0.72rem" }}>
                        {open ? "▾" : "▸"}
                      </Typography>
                    }
                  />
                  <Collapse in={open}>
                    <Stack
                      spacing={0.5}
                      sx={{ px: 1.25, pb: 1.1, pt: 0.25 }}
                    >
                      {items.map((item) => (
                        <Box
                          key={item.id}
                          component="button"
                          type="button"
                          onClick={() => onSelectEvidence?.(item)}
                          sx={{
                            display: "grid",
                            gridTemplateColumns: "1fr auto",
                            gap: 1,
                            width: "100%",
                            textAlign: "left",
                            border: 1,
                            borderColor: "divider",
                            borderRadius: 1,
                            bgcolor: "action.hover",
                            px: 1,
                            py: 0.85,
                            cursor: item.evidence ? "pointer" : "default",
                            color: "inherit",
                            font: "inherit",
                            "&:hover": {
                              bgcolor: item.evidence
                                ? "action.selected"
                                : "action.hover",
                            },
                          }}
                        >
                          <Box sx={{ minWidth: 0 }}>
                            <Typography sx={{ fontSize: "0.8rem", fontWeight: 600 }}>
                              {item.label}
                            </Typography>
                            {item.sourcePath ? (
                              <Typography
                                variant="mono"
                                color="text.secondary"
                                sx={{
                                  display: "block",
                                  fontSize: "0.68rem",
                                  mt: 0.2,
                                  wordBreak: "break-all",
                                }}
                              >
                                {item.sourcePath}
                              </Typography>
                            ) : null}
                            {item.detail ? (
                              <Typography
                                color="text.secondary"
                                sx={{ fontSize: "0.72rem", mt: 0.25 }}
                              >
                                {item.detail}
                              </Typography>
                            ) : null}
                            <Stack
                              direction="row"
                              spacing={0.5}
                              useFlexGap
                              sx={{ mt: 0.5, flexWrap: "wrap" }}
                            >
                              <Chip
                                size="small"
                                variant="outlined"
                                label={provenanceLabel(item.provenance)}
                                sx={{ height: 20, borderRadius: 0.75, fontSize: "0.65rem" }}
                              />
                              {item.mcpServer ? (
                                <Chip
                                  size="small"
                                  variant="outlined"
                                  label={`mcp:${item.mcpServer}`}
                                  sx={{ height: 20, borderRadius: 0.75, fontSize: "0.65rem" }}
                                />
                              ) : null}
                              {item.skillName ? (
                                <Chip
                                  size="small"
                                  variant="outlined"
                                  label={`skill:${item.skillName}`}
                                  sx={{ height: 20, borderRadius: 0.75, fontSize: "0.65rem" }}
                                />
                              ) : null}
                            </Stack>
                          </Box>
                          <Typography
                            variant="mono"
                            sx={{
                              fontSize: "0.74rem",
                              fontWeight: 650,
                              whiteSpace: "nowrap",
                              textAlign: "right",
                            }}
                          >
                            {item.estimatedTokens != null
                              ? formatTokens(item.estimatedTokens)
                              : "—"}
                            {item.estimatedTokens != null ? (
                              <Box
                                component="div"
                                sx={{
                                  fontWeight: 400,
                                  color: "text.secondary",
                                  fontSize: "0.66rem",
                                }}
                              >
                                {exact(item.estimatedTokens)}
                              </Box>
                            ) : null}
                          </Typography>
                        </Box>
                      ))}
                    </Stack>
                  </Collapse>
                </Box>
              );
            })}
          </Stack>
        </>
      )}

      <Typography variant="mono" color="text.secondary" sx={{ mt: 1.25, fontSize: "0.72rem" }}>
        attributed ~{formatTokens(attributed)} of {exact(snapshot.contextTokens)} measured
        {snapshot.inferred ? " · includes inferred / baseline layers" : ""}
      </Typography>
      {snapshot.notes.map((note) => (
        <Typography
          key={note}
          color="text.secondary"
          sx={{ mt: 0.5, fontSize: "0.72rem" }}
        >
          {note}
        </Typography>
      ))}
    </Box>
  );
}
