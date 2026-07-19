import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTheme } from "@mui/material/styles";
import {
  chartBarColors,
  focusHighlight,
  nodeKindStyle,
  schemeAlpha,
  schemePalette,
} from "./tokens";

function buildTheme() {
  return createTheme({
    cssVariables: { colorSchemeSelector: "data" },
    colorSchemes: {
      light: {
        palette: {
          primary: { main: "#1976d2", light: "#42a5f5", dark: "#1565c0" },
          warning: { main: "#ef6c00", light: "#fb8c00", dark: "#e65100" },
          info: { main: "#0288d1", light: "#4fc3f7", dark: "#0277bd" },
        },
      },
      dark: {
        palette: {
          primary: { main: "#90caf9", light: "#bbdefb", dark: "#42a5f5" },
          warning: { main: "#ffb74d", light: "#ffcc80", dark: "#ffa726" },
          info: { main: "#4fc3f7", light: "#81d4fa", dark: "#29b6f6" },
        },
      },
    },
  });
}

describe("scheme-aware theme tokens", () => {
  it("reads CSS variable palette entries instead of light-only hex", () => {
    const theme = buildTheme();
    const palette = schemePalette(theme);

    assert.match(palette.primary.main, /var\(--mui-palette-primary-main/);
    assert.match(palette.warning.main, /var\(--mui-palette-warning-main/);
    assert.notEqual(palette.primary.main, theme.palette.primary.main);
  });

  it("builds translucent colors with channel CSS variables", () => {
    const theme = buildTheme();
    const tint = schemeAlpha(theme, schemePalette(theme).primary.main, 0.12);

    assert.match(tint, /rgba\(var\(--mui-palette-primary-mainChannel\)/);
    assert.match(tint, /0\.12/);
  });

  it("keeps chart, chip, and focus helpers on scheme variables", () => {
    const theme = buildTheme();
    const bars = chartBarColors(theme);
    const chip = nodeKindStyle(theme, "root_agent");
    const focus = focusHighlight(theme);

    assert.match(bars.selected[1], /var\(--mui-palette-warning-main/);
    assert.match(bars.focusOutline, /var\(--mui-palette-primary-main/);
    assert.match(chip.color, /var\(--mui-palette-primary-dark/);
    assert.match(chip.bg, /rgba\(var\(--mui-palette-primary-mainChannel\)/);
    assert.match(focus.borderColor, /var\(--mui-palette-warning-main/);
    assert.match(focus.bgcolor, /rgba\(var\(--mui-palette-warning-mainChannel\)/);
  });
});
