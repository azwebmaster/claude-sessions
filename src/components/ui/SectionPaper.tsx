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
    <Paper
      sx={{
        p: layout.sectionPadding,
        minWidth: 0,
        maxWidth: "100%",
        ...sx,
      }}
      {...paperProps}
    >
      {title ? (
        <Typography
          variant="h2"
          sx={{
            mb: description ? 0 : 1.5,
            fontSize: { xs: "1rem", sm: "1.1rem" },
            wordBreak: "break-word",
          }}
        >
          {title}
        </Typography>
      ) : null}
      {description ? (
        <Typography
          color="text.secondary"
          sx={{
            mt: title ? 0 : 0,
            mb: 1.5,
            fontSize: { xs: "0.82rem", sm: "0.875rem" },
            lineHeight: 1.45,
          }}
        >
          {description}
        </Typography>
      ) : null}
      {children}
    </Paper>
  );
}
