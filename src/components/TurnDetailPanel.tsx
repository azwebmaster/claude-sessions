import { Box, Typography } from "@mui/material";
import type { ContextTimelinePoint } from "@shared/types";
import { formatTokens } from "@shared/types";

const mono = '"IBM Plex Mono", ui-monospace, monospace';

interface Props {
  point: ContextTimelinePoint | null;
  previous: ContextTimelinePoint | null;
}

interface UsagePart {
  key: string;
  label: string;
  hint: string;
  value: number;
  color: string;
  inContext: boolean;
}

function exact(n: number): string {
  return n.toLocaleString();
}

export function TurnDetailPanel({ point, previous }: Props) {
  if (!point) {
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
          Click a timeline bar to see exactly what makes up that turn&apos;s
          context occupancy (input, cache write, cache read, output).
        </Typography>
      </Box>
    );
  }

  const parts: UsagePart[] = [
    {
      key: "input",
      label: "Input (uncached)",
      hint: "Fresh prompt tokens not served from cache",
      value: point.inputTokens,
      color: "#1976d2",
      inContext: true,
    },
    {
      key: "cache+",
      label: "Cache write",
      hint: "Tokens written into prompt cache this turn (often the big first-turn number)",
      value: point.cacheCreationTokens,
      color: "#00897b",
      inContext: true,
    },
    {
      key: "cache",
      label: "Cache read",
      hint: "Tokens reused from prompt cache",
      value: point.cacheReadTokens,
      color: "#7b1fa2",
      inContext: true,
    },
    {
      key: "out",
      label: "Output",
      hint: "Model reply tokens (billed, but not part of ctx occupancy)",
      value: point.outputTokens,
      color: "#ef6c00",
      inContext: false,
    },
  ];

  const contextParts = parts.filter((p) => p.inContext && p.value > 0);
  const contextTotal = Math.max(
    point.contextTokens,
    contextParts.reduce((sum, p) => sum + p.value, 0),
    1,
  );
  const delta =
    previous == null ? null : point.contextTokens - previous.contextTokens;
  const isBaseline = previous == null;

  return (
    <Box
      sx={{
        mt: 2,
        p: 1.75,
        borderRadius: 1.5,
        border: 1,
        borderColor: "warning.main",
        bgcolor: "rgba(237, 108, 2, 0.06)",
        animation: "rise 280ms ease both",
      }}
    >
      <Typography sx={{ fontWeight: 650, fontSize: "0.95rem", mb: 0.5 }}>
        Turn {point.turn}: {point.label}
      </Typography>
      <Typography color="text.secondary" sx={{ fontSize: "0.82rem", mb: 1.5 }}>
        {isBaseline ? (
          <>
            <Box component="span" sx={{ fontFamily: mono, fontWeight: 600 }}>
              {formatTokens(point.contextTokens)}
            </Box>{" "}
            ({exact(point.contextTokens)}) is the{" "}
            <Box component="span" sx={{ fontWeight: 650 }}>
              baseline context window
            </Box>{" "}
            for this API call — mostly system prompt, tool schemas, and cached
            conversation — not tokens added by the nested tool calls under this
            Assistant node.
          </>
        ) : (
          <>
            Context occupancy{" "}
            <Box component="span" sx={{ fontFamily: mono, fontWeight: 600 }}>
              {formatTokens(point.contextTokens)}
            </Box>{" "}
            ({exact(point.contextTokens)})
            {delta != null && delta !== 0
              ? `, ${delta > 0 ? "+" : ""}${exact(delta)} vs prior turn`
              : ", unchanged vs prior turn"}
            . Nested tool <Box component="span" sx={{ fontFamily: mono }}>+N est</Box>{" "}
            chips are estimated I/O sizes only.
          </>
        )}
      </Typography>

      <Box
        sx={{
          display: "flex",
          height: 12,
          borderRadius: 1,
          overflow: "hidden",
          bgcolor: "action.selected",
          mb: 1.25,
        }}
        role="img"
        aria-label="Context composition bar"
      >
        {contextParts.map((p) => (
          <Box
            key={p.key}
            title={`${p.label}: ${exact(p.value)}`}
            sx={{
              width: `${(p.value / contextTotal) * 100}%`,
              minWidth: p.value > 0 ? 4 : 0,
              bgcolor: p.color,
            }}
          />
        ))}
      </Box>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, minmax(0, 1fr))",
          },
          gap: 0.75,
        }}
      >
        {parts.map((p) => (
          <Box
            key={p.key}
            sx={{
              display: "grid",
              gridTemplateColumns: "auto 1fr auto",
              gap: 1,
              alignItems: "start",
              px: 1,
              py: 0.85,
              borderRadius: 1,
              bgcolor: "background.paper",
              border: 1,
              borderColor: "divider",
              opacity: p.value === 0 ? 0.55 : 1,
            }}
          >
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: 0.5,
                bgcolor: p.color,
                mt: 0.55,
              }}
            />
            <Box>
              <Typography sx={{ fontSize: "0.8rem", fontWeight: 600 }}>
                {p.label}
                {!p.inContext ? " · billed only" : ""}
              </Typography>
              <Typography color="text.secondary" sx={{ fontSize: "0.72rem" }}>
                {p.hint}
              </Typography>
            </Box>
            <Typography
              sx={{
                fontFamily: mono,
                fontSize: "0.78rem",
                fontWeight: 650,
                textAlign: "right",
                whiteSpace: "nowrap",
              }}
            >
              {formatTokens(p.value)}
              <Box
                component="div"
                sx={{
                  fontWeight: 400,
                  color: "text.secondary",
                  fontSize: "0.68rem",
                }}
              >
                {exact(p.value)}
              </Box>
            </Typography>
          </Box>
        ))}
      </Box>

      <Typography
        color="text.secondary"
        sx={{ mt: 1.25, fontSize: "0.72rem", fontFamily: mono }}
      >
        ctx = input + cache write + cache read = {exact(point.contextTokens)}
        {" · "}
        billed total = ctx + output ={" "}
        {exact(point.contextTokens + point.outputTokens)}
      </Typography>
    </Box>
  );
}
