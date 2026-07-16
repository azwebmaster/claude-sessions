import { Box, type BoxProps } from "@mui/material";
import type { ReactNode } from "react";

interface ExpandableRowProps extends Omit<BoxProps, "title" | "content"> {
  expanded?: boolean;
  focused?: boolean;
  onActivate: () => void;
  leading?: ReactNode;
  body: ReactNode;
  trailing?: ReactNode;
}

export function ExpandableRow({
  expanded,
  focused = false,
  onActivate,
  leading,
  body,
  trailing,
  sx,
  ...boxProps
}: ExpandableRowProps) {
  const hasTrailing = trailing != null;
  const hasLeading = leading != null;

  let columnsXs = "minmax(0, 1fr)";
  let columnsSm = "minmax(0, 1fr)";
  let areasXs = `"body"`;
  let areasSm = `"body"`;

  if (hasLeading && hasTrailing) {
    columnsXs = "auto minmax(0, 1fr)";
    columnsSm = "auto minmax(0, 1fr) auto";
    areasXs = `"leading body" "trailing trailing"`;
    areasSm = `"leading body trailing"`;
  } else if (hasLeading) {
    columnsXs = "auto minmax(0, 1fr)";
    columnsSm = "auto minmax(0, 1fr)";
    areasXs = `"leading body"`;
    areasSm = `"leading body"`;
  } else if (hasTrailing) {
    columnsXs = "minmax(0, 1fr)";
    columnsSm = "minmax(0, 1fr) auto";
    areasXs = `"body" "trailing"`;
    areasSm = `"body trailing"`;
  }

  return (
    <Box
      component="button"
      type="button"
      onClick={onActivate}
      aria-expanded={expanded}
      aria-current={focused ? "true" : undefined}
      sx={{
        display: "grid",
        // Phones: metrics drop under the label so long paths stay readable.
        // sm+: classic leading | body | trailing row.
        gridTemplateColumns: { xs: columnsXs, sm: columnsSm },
        gridTemplateAreas: { xs: areasXs, sm: areasSm },
        columnGap: { xs: 0.75, sm: 1 },
        rowGap: { xs: hasTrailing ? 0.5 : 0, sm: 0 },
        alignItems: "start",
        width: "100%",
        minWidth: 0,
        border: 0,
        bgcolor: "transparent",
        textAlign: "left",
        px: { xs: 1, sm: 1.25 },
        py: 1,
        cursor: "pointer",
        color: "inherit",
        font: "inherit",
        borderRadius: 1,
        "&:hover": { bgcolor: "action.hover" },
        ...sx,
      }}
      {...boxProps}
    >
      {hasLeading ? <Box sx={{ gridArea: "leading", minWidth: 0 }}>{leading}</Box> : null}
      <Box sx={{ gridArea: "body", minWidth: 0 }}>{body}</Box>
      {hasTrailing ? (
        <Box
          sx={{
            gridArea: "trailing",
            minWidth: 0,
            justifySelf: { xs: "stretch", sm: "end" },
          }}
        >
          {trailing}
        </Box>
      ) : null}
    </Box>
  );
}
