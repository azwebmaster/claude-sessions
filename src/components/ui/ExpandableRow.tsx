import { Box, type BoxProps } from "@mui/material";
import type { MouseEvent, ReactNode } from "react";

interface ExpandableRowProps extends Omit<BoxProps, "title" | "content"> {
  expanded?: boolean;
  focused?: boolean;
  onActivate: () => void;
  /**
   * When provided with `expanded`, expand/collapse uses a dedicated control
   * instead of sharing the row's activate click.
   */
  onToggleExpand?: () => void;
  leading?: ReactNode;
  body: ReactNode;
  trailing?: ReactNode;
}

function contentGrid(hasLeading: boolean, hasTrailing: boolean) {
  if (hasLeading && hasTrailing) {
    return {
      columnsXs: "auto minmax(0, 1fr)",
      columnsSm: "auto minmax(0, 1fr) auto",
      areasXs: `"leading body" "trailing trailing"`,
      areasSm: `"leading body trailing"`,
    };
  }
  if (hasLeading) {
    return {
      columnsXs: "auto minmax(0, 1fr)",
      columnsSm: "auto minmax(0, 1fr)",
      areasXs: `"leading body"`,
      areasSm: `"leading body"`,
    };
  }
  if (hasTrailing) {
    return {
      columnsXs: "minmax(0, 1fr)",
      columnsSm: "minmax(0, 1fr) auto",
      areasXs: `"body" "trailing"`,
      areasSm: `"body trailing"`,
    };
  }
  return {
    columnsXs: "minmax(0, 1fr)",
    columnsSm: "minmax(0, 1fr)",
    areasXs: `"body"`,
    areasSm: `"body"`,
  };
}

export function ExpandableRow({
  expanded,
  focused = false,
  onActivate,
  onToggleExpand,
  leading,
  body,
  trailing,
  sx,
  ...boxProps
}: ExpandableRowProps) {
  const hasTrailing = trailing != null;
  const hasLeading = leading != null;
  const splitExpand =
    typeof expanded === "boolean" && typeof onToggleExpand === "function";
  const grid = contentGrid(hasLeading, hasTrailing);

  const leadingNode = hasLeading ? (
    <Box sx={{ gridArea: "leading", minWidth: 0 }}>{leading}</Box>
  ) : null;
  const bodyNode = <Box sx={{ gridArea: "body", minWidth: 0 }}>{body}</Box>;
  const trailingNode = hasTrailing ? (
    <Box
      sx={{
        gridArea: "trailing",
        minWidth: 0,
        justifySelf: { xs: "stretch", sm: "end" },
      }}
    >
      {trailing}
    </Box>
  ) : null;

  const contentSx = {
    display: "grid",
    // Phones: metrics drop under the label so long paths stay readable.
    // sm+: classic leading | body | trailing row.
    gridTemplateColumns: { xs: grid.columnsXs, sm: grid.columnsSm },
    gridTemplateAreas: { xs: grid.areasXs, sm: grid.areasSm },
    columnGap: { xs: 0.75, sm: 1 },
    rowGap: { xs: hasTrailing ? 0.5 : 0, sm: 0 },
    alignItems: "start",
    width: "100%",
    minWidth: 0,
    border: 0,
    bgcolor: "transparent",
    textAlign: "left" as const,
    color: "inherit",
    font: "inherit",
    borderRadius: 1,
  };

  if (splitExpand) {
    return (
      <Box
        role="group"
        aria-expanded={expanded}
        aria-current={focused ? "true" : undefined}
        sx={{
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr)",
          columnGap: { xs: 0.25, sm: 0.5 },
          alignItems: "start",
          width: "100%",
          minWidth: 0,
          px: { xs: 0.5, sm: 0.75 },
          py: 0.5,
          borderRadius: 1,
          bgcolor: "transparent",
          "&:hover": { bgcolor: "action.hover" },
          ...sx,
        }}
        {...boxProps}
      >
        <Box
          component="button"
          type="button"
          aria-label={expanded ? "Collapse" : "Expand"}
          aria-expanded={expanded}
          onClick={(event: MouseEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            onToggleExpand();
          }}
          sx={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            mt: 0.25,
            border: 0,
            borderRadius: 0.75,
            bgcolor: "transparent",
            color: "text.secondary",
            cursor: "pointer",
            font: "inherit",
            fontSize: "0.85rem",
            lineHeight: 1,
            flexShrink: 0,
            "&:hover": { bgcolor: "action.selected", color: "text.primary" },
          }}
        >
          {expanded ? "▾" : "▸"}
        </Box>
        <Box
          component="button"
          type="button"
          onClick={onActivate}
          aria-current={focused ? "true" : undefined}
          sx={{
            ...contentSx,
            cursor: "pointer",
            px: { xs: 0.5, sm: 0.5 },
            py: 0.5,
            "&:hover": { bgcolor: "transparent" },
          }}
        >
          {leadingNode}
          {bodyNode}
          {trailingNode}
        </Box>
      </Box>
    );
  }

  return (
    <Box
      component="button"
      type="button"
      onClick={onActivate}
      aria-expanded={expanded}
      aria-current={focused ? "true" : undefined}
      sx={{
        ...contentSx,
        px: { xs: 1, sm: 1.25 },
        py: 1,
        cursor: "pointer",
        "&:hover": { bgcolor: "action.hover" },
        ...sx,
      }}
      {...boxProps}
    >
      {leadingNode}
      {bodyNode}
      {trailingNode}
    </Box>
  );
}
