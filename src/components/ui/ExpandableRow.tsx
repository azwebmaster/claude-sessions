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
  return (
    <Box
      component="button"
      type="button"
      onClick={onActivate}
      aria-expanded={expanded}
      aria-current={focused ? "true" : undefined}
      sx={{
        display: "grid",
        gridTemplateColumns: leading ? "auto 1fr auto" : "1fr auto",
        gap: 1,
        alignItems: "start",
        width: "100%",
        border: 0,
        bgcolor: "transparent",
        textAlign: "left",
        px: 1.25,
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
      {leading}
      {body}
      {trailing}
    </Box>
  );
}
