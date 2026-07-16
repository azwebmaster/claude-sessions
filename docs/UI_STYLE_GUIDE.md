# Claude Sessions — UI Style Guide

This document defines the visual language for the Claude Sessions profiler. All UI is built with [MUI v9](https://mui.com/material-ui/) and should follow these conventions.

## Design principles

1. **Data-first** — Typography and color emphasize metrics, paths, and hierarchy over decoration.
2. **Theme-aware** — Never hard-code hex colors in components. Use palette tokens or helpers from `src/theme/tokens.ts`.
3. **Monospace for machine data** — Paths, token counts, timestamps, and IDs use the `mono` typography variant.
4. **Consistent surfaces** — Sections use outlined `Paper`; nested rows use `action.hover` backgrounds and `divider` borders.
5. **Accessible focus** — Interactive chart bars and tree nodes expose keyboard focus and ARIA attributes.

## Theme & color modes

The app supports **light**, **dark**, and **system** color modes via MUI's `colorSchemes` API.

| Token | Light | Dark | Usage |
| --- | --- | --- | --- |
| `primary` | Blue `#1976d2` | Light blue `#90caf9` | Links, growth bars, agent chips |
| `secondary` | Purple `#7b1fa2` | Light purple `#ce93d8` | Cache-read segments, subagent chips |
| `warning` | Orange `#ef6c00` | Amber `#ffb74d` | Selected timeline bars, focus highlights |
| `error` | Red `#d32f2f` | Red `#f44336` | Context growth, error chips |
| `success` | Teal `#00897b` | Teal `#4db6ac` | Positive deltas, fixture chips |
| `info` | Cyan `#0288d1` | Cyan `#4fc3f7` | Fixture source chips |
| `background.default` | `#f4f6f8` | `#0f1419` | Page canvas |
| `background.paper` | `#ffffff` | `#1a2027` | Cards, tables |

Toggle with the header **ColorModeToggle** (cycles light → dark → system). Preference is persisted by MUI in `localStorage`.

### Implementation

```tsx
// src/main.tsx
<ThemeProvider theme={theme} defaultMode="system">
  <CssBaseline enableColorScheme />
  ...
</ThemeProvider>
```

Use `useTheme()` and token helpers — not inline hex — for chart and chip colors:

```tsx
import { useTheme } from "@mui/material/styles";
import { chartBarColors, nodeKindStyle } from "../theme";

const theme = useTheme();
const bars = chartBarColors(theme);
const chip = nodeKindStyle(theme, node.kind);
```

## Typography

| Variant | Use |
| --- | --- |
| `h1` | Page and session titles |
| `h2` | Section headings inside `SectionPaper` |
| `subtitle2` | Row titles, emphasized labels |
| `body1` / `body2` | Prose descriptions |
| `overline` | Stat card labels, section micro-labels |
| `caption` | Secondary metadata |
| `mono` | Paths, token counts, timestamps, IDs |

Font stacks (loaded in `index.html`):

- **Sans:** Roboto
- **Mono:** IBM Plex Mono

## Layout

| Constant | Value | Usage |
| --- | --- | --- |
| `layout.maxWidth` | 1280px | App shell max width |
| `layout.pagePaddingX` | `{ xs: 1.25, sm: 2, md: 2.5 }` | Horizontal page inset (spacing units) |
| `layout.pagePaddingY` | `{ xs: 2, sm: 2.5, md: 3 }` | Top page inset |
| `layout.sectionPadding` | `{ xs: 1.5, sm: 2, md: 2.5 }` | `SectionPaper` internal padding |
| `layout.sectionGap` | `{ xs: 1.5, sm: 2 }` | Gap between major sections |
| `layout.tableMinBreakpoint` | `md` | Session list switches from cards → table |

Responsive grids use MUI breakpoint objects: `{ xs: "...", md: "..." }`. Prefer `minmax(0, 1fr)` and `minWidth: 0` on flex/grid children so long paths and mono metrics wrap instead of overflowing the viewport.

### Breakpoint patterns

- **Session list:** stacked metric cards below `md`; full table from `md` up (with horizontal scroll if needed).
- **Session detail:** major panels live in top-level tabs (Analysis, Context, Diagram, Hierarchy). Within Context, Turn detail and Loaded context are nested tabs under the chart. Hierarchy keeps a two-column layout with side panels from `lg`.
- **Expandable rows:** trailing metrics wrap under the label on `xs`; side-by-side from `sm`.
- **Context chart:** horizontal scroll when many turns; bars keep a tappable min width.

## Components

### Shared primitives (`src/components/ui/`)

| Component | Purpose |
| --- | --- |
| `SectionPaper` | Outlined section with optional `title` and `description` |
| `StatCard` | Metric tile (label + mono value) |
| `EmptyState` | Centered secondary text for empty lists |
| `ExpandableRow` | Accessible button row for tree/tool lists |
| `ColorModeToggle` | Light / dark / system cycle control |

Always prefer these over ad-hoc `Paper` + `Typography` combinations.

### MUI components in use

| MUI component | Where |
| --- | --- |
| `Paper` | Section containers (via `SectionPaper`) |
| `Table` / `TableSortLabel` | Session list; clickable column sort |
| `TextField` | Session text filter; token / peak ctx / turns min–max |
| `Select` | Session age filter presets; mobile session sort field |
| `Chip` | Source, branch, model, kind badges |
| `Link` | Back navigation |
| `Tabs` / `Tab` | Session detail panels; Context turn / loaded-context sub-panels |
| `Collapse` | Hierarchy tree, tool impact expansion |
| `LinearProgress` | Tool impact bars, agent usage context/tool bars |
| Inline SVG | Agent ↔ tool call diagram (bipartite links) |
| `Alert` | Error states |
| `CircularProgress` | Loading states |
| `IconButton` + icons | Color mode toggle |

### Semantic color helpers (`src/theme/tokens.ts`)

| Helper | Purpose |
| --- | --- |
| `chartBarColors(theme)` | Timeline bar gradients and focus ring |
| `usagePartColors(theme)` | Turn detail composition segments |
| `contextItemKindStyle(theme, kind)` | Loaded-context category chips (MCP, skill, instruction, …) |
| `nodeKindStyle(theme, kind)` | Hierarchy node chip colors |
| `focusHighlight(theme)` | Selected tree node border/background |
| `alertSurface(theme, color)` | Highlight boxes (e.g. top tool impact) |

## Motion

Entry animations use the shared `rise` keyframe (defined in theme `MuiCssBaseline`):

| Token | Duration | Usage |
| --- | --- | --- |
| `motion.rise` | 500ms | App header |
| `motion.riseFast` | 280ms | Turn detail panel |
| `motion.riseMedium` | 420ms | Context chart section |
| `motion.riseSlow` | 600ms | Session list |

Apply via `sx={{ animation: motion.rise }}`.

## Patterns

### Loading & errors

```tsx
<SectionPaper>
  <CircularProgress size={28} sx={{ display: "block", mx: "auto" }} />
</SectionPaper>

<Alert severity="error">Failed to load sessions: {error}</Alert>
```

### Session list chips

- `fixture` source → `color="info"`
- `live` source → `color="success"`
- Branch/model → `variant="outlined"`

### Hierarchy focus

Selected nodes use `focusHighlight(theme)` — warning-colored left accent, not raw orange hex.

### Charts

Timeline bars use `chartBarColors(theme)` gradients. Selected bar uses `warning`; growth uses `primary`/`info`.

### Agent ↔ tool diagram

`AgentToolDiagram` is an interactive radial SVG: the root agent sits at the center, subagents on an inner ring, and tools on one or more expanded outer rings near the agents that call them. Each tool node is scoped to a single agent (same tool name can appear once per caller); links never fan into a shared global tool node. Agent circles can be sized by **peak context** or **total tokens** via a toolbar toggle (default: peak context); tool circles use attributed context growth (session-level impact split by that agent's share of calls). Curved arrows show call flow (stroke weight = call volume). Support pan, wheel/+/− zoom, and drag-to-rearrange; include an **Arrange** control that re-runs the link-aware radial auto-layout (with overlap separation) and fit-to-view, plus a separate fit-view control. Use `nodeKindStyle` for node accents and `focusHighlight` when an agent or tool is selected. Default to the top N agent↔tool pairs by volume so dense sessions stay readable; offer an **All tools / Expand diagram** control that reveals every tool, grows the viewport, and adds concentric tool rings as needed. Note hidden tool count in the caption when collapsed.

## Adding new UI

1. Check if a primitive in `src/components/ui/` already fits.
2. Use `SectionPaper` for new sections.
3. Add any new semantic colors to `src/theme/tokens.ts`, not inline.
4. Use `Typography variant="mono"` for machine-readable values.
5. Test in both light and dark modes before shipping.
