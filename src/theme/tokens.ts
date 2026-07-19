import { type Theme } from "@mui/material/styles";
import type { LoadedContextKind, TreeNodeKind } from "@shared/types";

/** IBM Plex Mono stack loaded in index.html. */
export const monoFontFamily =
  '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

export const layout = {
  maxWidth: 1280,
  /** Horizontal page inset (spacing units). Tighter on phones. */
  pagePaddingX: { xs: 1.25, sm: 2, md: 2.5 } as const,
  pagePaddingY: { xs: 2, sm: 2.5, md: 3 } as const,
  sectionPadding: { xs: 1.5, sm: 2, md: 2.5 } as const,
  sectionGap: { xs: 1.5, sm: 2 } as const,
  /** Breakpoint at which tabular session list replaces stacked cards. */
  tableMinBreakpoint: "md" as const,
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

/**
 * Palette that tracks the active color scheme.
 * With `cssVariables`, `theme.palette` stays on the default (light) hex values
 * across mode toggles — use this (or `theme.vars.palette`) for paints that must
 * follow light/dark.
 */
export function schemePalette(theme: Theme) {
  return theme.vars?.palette ?? theme.palette;
}

/** Scheme-aware translucent color (`theme.alpha` understands CSS variables). */
export function schemeAlpha(theme: Theme, color: string, opacity: number) {
  return theme.alpha(color, opacity);
}

export interface ChartBarColors {
  selected: [string, string];
  grown: [string, string];
  stable: [string, string];
  focusOutline: string;
}

export function chartBarColors(theme: Theme): ChartBarColors {
  const palette = schemePalette(theme);
  return {
    selected: [palette.warning.light, palette.warning.main],
    grown: [palette.info.light, palette.primary.main],
    stable: [palette.info.light, palette.primary.light],
    focusOutline: palette.primary.main,
  };
}

export interface UsagePartColors {
  input: string;
  cacheWrite: string;
  cacheRead: string;
  output: string;
}

export function usagePartColors(theme: Theme): UsagePartColors {
  const palette = schemePalette(theme);
  return {
    input: palette.primary.main,
    cacheWrite: palette.success.main,
    cacheRead: palette.secondary.main,
    output: palette.warning.main,
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
  const palette = schemePalette(theme);
  const styles: Record<LoadedContextKind, KindChipStyle> = {
    system_prompt: {
      bg: schemeAlpha(theme, palette.text.primary, 0.08),
      color: palette.text.primary,
    },
    instruction: {
      bg: schemeAlpha(theme, palette.primary.main, 0.12),
      color: palette.primary.dark,
    },
    memory: {
      bg: schemeAlpha(theme, palette.info.main, 0.12),
      color: palette.info.dark,
    },
    mcp: {
      bg: schemeAlpha(theme, palette.secondary.main, 0.14),
      color: palette.secondary.dark,
    },
    skill: {
      bg: schemeAlpha(theme, palette.success.main, 0.14),
      color: palette.success.dark,
    },
    deferred_tools: {
      bg: schemeAlpha(theme, palette.warning.main, 0.12),
      color: palette.warning.dark,
    },
    tool_schema: {
      bg: schemeAlpha(theme, palette.warning.main, 0.1),
      color: palette.warning.main,
    },
    user_message: {
      bg: schemeAlpha(theme, palette.primary.main, 0.08),
      color: palette.primary.main,
    },
    assistant_message: {
      bg: schemeAlpha(theme, palette.info.main, 0.1),
      color: palette.info.main,
    },
    file: {
      bg: schemeAlpha(theme, palette.success.main, 0.1),
      color: palette.success.main,
    },
    tool_result: {
      bg: schemeAlpha(theme, palette.error.main, 0.08),
      color: palette.error.dark,
    },
    attachment: {
      bg: schemeAlpha(theme, palette.text.primary, 0.06),
      color: palette.text.secondary,
    },
    other: {
      bg: schemeAlpha(theme, palette.text.primary, 0.06),
      color: palette.text.secondary,
    },
  };

  return styles[kind] ?? styles.other;
}

export function nodeKindStyle(
  theme: Theme,
  kind: TreeNodeKind,
): KindChipStyle {
  const palette = schemePalette(theme);
  const neutral = {
    bg: schemeAlpha(theme, palette.text.primary, 0.06),
    color: palette.text.secondary,
  };

  const styles: Record<TreeNodeKind, KindChipStyle> = {
    root_agent: {
      bg: schemeAlpha(theme, palette.primary.main, 0.12),
      color: palette.primary.dark,
    },
    subagent: {
      bg: schemeAlpha(theme, palette.secondary.main, 0.12),
      color: palette.secondary.dark,
    },
    tool_call: {
      bg: schemeAlpha(theme, palette.info.main, 0.12),
      color: palette.info.dark,
    },
    tool_result: {
      bg: schemeAlpha(theme, palette.warning.main, 0.12),
      color: palette.warning.dark,
    },
    assistant_message: {
      bg: schemeAlpha(theme, palette.primary.main, 0.12),
      color: palette.primary.main,
    },
    user_message: neutral,
    thinking: neutral,
    system: neutral,
  };

  return styles[kind] ?? neutral;
}

export function focusHighlight(theme: Theme) {
  const palette = schemePalette(theme);
  return {
    borderColor: palette.warning.main,
    bgcolor: schemeAlpha(theme, palette.warning.main, 0.12),
    boxShadow: `inset 3px 0 0 ${palette.warning.main}`,
  };
}

export function alertSurface(theme: Theme, color: "error" | "warning" | "info") {
  const main = schemePalette(theme)[color].main;
  return {
    bgcolor: schemeAlpha(theme, main, 0.06),
    borderColor: schemeAlpha(theme, main, 0.18),
  };
}
