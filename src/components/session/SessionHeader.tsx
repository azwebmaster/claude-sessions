import {
  Box,
  Chip,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import type { SessionListItem } from "@shared/types";
import { formatTokens, totalTokens } from "@shared/types";
import { formatDate } from "../../lib/api";
import { isSessionActive } from "../../lib/sessionActivity";
import { StatCard, TaggedText } from "../ui";
import { layout, motion, schemeAlpha, schemePalette } from "../../theme";

interface Props {
  meta: SessionListItem;
  watching: boolean;
  onWatchingChange: (on: boolean) => void;
}

/** Session identity + headline stats + the watch toggle. Rendered by the
 * `/sessions/:id` layout route, so it stays mounted across turn navigation. */
export function SessionHeader({ meta, watching, onWatchingChange }: Props) {
  const live = isSessionActive(meta.updatedAt);
  const metaLine = [
    meta.projectPath,
    meta.gitBranch,
    `${formatDate(meta.startedAt)} → ${formatDate(meta.updatedAt)}`,
    `LOG ${meta.filePath}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Box sx={{ mb: layout.sectionGap, animation: motion.rise, minWidth: 0 }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "flex-start", justifyContent: "space-between", minWidth: 0 }}
      >
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", minWidth: 0, flex: "1 1 auto" }}
        >
          <Typography
            variant="h1"
            sx={{
              m: 0,
              fontSize: { xs: "1.05rem", sm: "1.25rem", md: "1.55rem" },
              lineHeight: 1.25,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            <TaggedText value={meta.summary} fallback="Untitled session" />
          </Typography>
          {live ? (
            <Chip
              size="small"
              label="Live"
              sx={(theme) => {
                const palette = schemePalette(theme);
                return {
                  flexShrink: 0,
                  height: 20,
                  fontSize: "0.65rem",
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  border: 1,
                  borderColor: schemeAlpha(theme, palette.success.main, 0.3),
                  bgcolor: schemeAlpha(theme, palette.success.main, 0.14),
                  color: palette.success.main,
                  "& .MuiChip-label": { px: 0.75 },
                };
              }}
            />
          ) : null}
        </Stack>
        <FormControlLabel
          sx={{ flexShrink: 0, ml: 1, mr: 0 }}
          control={
            <Switch
              size="small"
              checked={watching}
              onChange={(e) => onWatchingChange(e.target.checked)}
            />
          }
          label="Watch"
        />
      </Stack>
      <Typography
        component="div"
        variant="mono"
        color="text.secondary"
        title={metaLine}
        sx={{
          mt: 0.5,
          fontSize: { xs: "0.7rem", sm: "0.75rem" },
          lineHeight: 1.4,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {metaLine}
      </Typography>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "repeat(2, minmax(0, 1fr))",
            sm: "repeat(4, minmax(6rem, 1fr))",
          },
          gap: 0.6,
          mt: 1,
          minWidth: 0,
        }}
      >
        <StatCard label="Total tokens" value={formatTokens(totalTokens(meta.usage))} />
        <StatCard label="Peak context" value={formatTokens(meta.peakContextTokens)} />
        <StatCard
          label="Cache read"
          value={formatTokens(meta.usage.cacheReadInputTokens)}
        />
        <StatCard label="Tool calls" value={String(meta.toolCallCount)} />
      </Box>
    </Box>
  );
}
