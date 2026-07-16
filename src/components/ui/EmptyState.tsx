import { Typography, type TypographyProps } from "@mui/material";

export function EmptyState({ children, ...props }: TypographyProps) {
  return (
    <Typography color="text.secondary" align="center" sx={{ py: 2 }} {...props}>
      {children}
    </Typography>
  );
}
