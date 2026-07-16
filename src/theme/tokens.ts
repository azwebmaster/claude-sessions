import { alpha, type Theme } from "@mui/material/styles";
import type { LoadedContextKind, TreeNodeKind } from "@shared/types";

/** IBM Plex Mono stack loaded in index.html. */
export const monoFontFamily =
  '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

export const layout = {
  maxWidth: 1280,
  pagePaddingX: 2,
  pagePaddingY: 3,
  sectionPadding: 2.5,
  sectionGap: 2,
} as const;

export const motion = {
  rise: "rise 500ms ease both",
  riseFast: "rise 280ms ease both",
  riseMedium: "rise 420ms ease both",
  riseSlow: "rise 600ms ease both",
} as const;

export const keyframes = {
  "@keyframes rise": {
    from: { opacity: 0, transform: "translateY(10px)" },
    to: { opacity: 1, transform: "translateY(0)" },
  },
} as const;

export interface ChartBarColors {
  selected: [string, string];
  grown: [string, string];
  stable: [string, string];
  focusOutline: string;
}

export function chartBarColors(theme: Theme): ChartBarColors {
  return {
    selected: [theme.palette.warning.light, theme.palette.warning.main],
    grown: [theme.palette.info.light, theme.palette.primary.main],
    stable: [theme.palette.info.light, theme.palette.primary.light],
    focusOutline: theme.palette.primary.main,
  };
}

export interface UsagePartColors {
  input: string;
  cacheWrite: string;
  cacheRead: string;
  output: string;
}

export function usagePartColors(theme: Theme): UsagePartColors {
  return {
    input: theme.palette.primary.main,
    cacheWrite: theme.palette.success.main,
    cacheRead: theme.palette.secondary.main,
    output: theme.palette.warning.main,
  };
}

export interface KindChipStyle {
  bg: string;
  color: string;
}

export function contextItemKindStyle(
  theme: Theme,
  kind: LoadedContextKind,
): KindChipStyle {
  const styles: Record<LoadedContextKind, KindChipStyle> = {
    system_prompt: {
      bg: alpha(theme.palette.text.primary, 0.08),
      color: theme.palette.text.primary,
    },
    instruction: {
      bg: alpha(theme.palette.primary.main, 0.12),
      color: theme.palette.primary.dark,
    },
    memory: {
      bg: alpha(theme.palette.info.main, 0.12),
      color: theme.palette.info.dark,
    },
    mcp: {
      bg: alpha(theme.palette.secondary.main, 0.14),
      color: theme.palette.secondary.dark,
    },
    skill: {
      bg: alpha(theme.palette.success.main, 0.14),
      color: theme.palette.success.dark,
    },
    deferred_tools: {
      bg: alpha(theme.palette.warning.main, 0.12),
      color: theme.palette.warning.dark,
    },
    tool_schema: {
      bg: alpha(theme.palette.warning.main, 0.1),
      color: theme.palette.warning.main,
    },
    user_message: {
      bg: alpha(theme.palette.primary.main, 0.08),
      color: theme.palette.primary.main,
    },
    assistant_message: {
      bg: alpha(theme.palette.info.main, 0.1),
      color: theme.palette.info.main,
    },
    file: {
      bg: alpha(theme.palette.success.main, 0.1),
      color: theme.palette.success.main,
    },
    tool_result: {
      bg: alpha(theme.palette.error.main, 0.08),
      color: theme.palette.error.dark,
    },
    attachment: {
      bg: alpha(theme.palette.text.primary, 0.06),
      color: theme.palette.text.secondary,
    },
    other: {
      bg: alpha(theme.palette.text.primary, 0.06),
      color: theme.palette.text.secondary,
    },
  };

  return styles[kind] ?? styles.other;
}

export function nodeKindStyle(
  theme: Theme,
  kind: TreeNodeKind,
): KindChipStyle {
  const neutral = {
    bg: alpha(theme.palette.text.primary, 0.06),
    color: theme.palette.text.secondary,
  };

  const styles: Record<TreeNodeKind, KindChipStyle> = {
    root_agent: {
      bg: alpha(theme.palette.primary.main, 0.12),
      color: theme.palette.primary.dark,
    },
    subagent: {
      bg: alpha(theme.palette.secondary.main, 0.12),
      color: theme.palette.secondary.dark,
    },
    tool_call: {
      bg: alpha(theme.palette.info.main, 0.12),
      color: theme.palette.info.dark,
    },
    tool_result: {
      bg: alpha(theme.palette.warning.main, 0.12),
      color: theme.palette.warning.dark,
    },
    assistant_message: {
      bg: alpha(theme.palette.primary.main, 0.12),
      color: theme.palette.primary.main,
    },
    user_message: neutral,
    thinking: neutral,
    system: neutral,
  };

  return styles[kind] ?? neutral;
}

export function focusHighlight(theme: Theme) {
  return {
    borderColor: theme.palette.warning.main,
    bgcolor: alpha(theme.palette.warning.main, 0.12),
    boxShadow: `inset 3px 0 0 ${theme.palette.warning.main}`,
  };
}

export function alertSurface(theme: Theme, color: "error" | "warning" | "info") {
  const main = theme.palette[color].main;
  return {
    bgcolor: alpha(main, 0.06),
    borderColor: alpha(main, 0.18),
  };
}
