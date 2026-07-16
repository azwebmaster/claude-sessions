import { Paper, type PaperProps, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { layout } from "../../theme";

interface SectionPaperProps extends Omit<PaperProps, "title"> {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}

export function SectionPaper({
  title,
  description,
  children,
  sx,
  ...paperProps
}: SectionPaperProps) {
  return (
    <Paper sx={{ p: layout.sectionPadding, ...sx }} {...paperProps}>
      {title ? (
        <Typography variant="h2" sx={{ mb: description ? 0 : 1.5 }}>
          {title}
        </Typography>
      ) : null}
      {description ? (
        <Typography color="text.secondary" sx={{ mt: title ? 0 : 0, mb: 1.5 }}>
          {description}
        </Typography>
      ) : null}
      {children}
    </Paper>
  );
}
