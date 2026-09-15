import { Box, Typography } from "@mui/material";

interface StatCardProps {
  label: string;
  value: string;
}

export function StatCard({ label, value }: StatCardProps) {
  return (
    <Box
      sx={{
        bgcolor: "action.hover",
        border: 1,
        borderColor: "divider",
        borderRadius: 1.25,
        px: { xs: 1, sm: 1.15 },
        py: { xs: 0.65, sm: 0.8 },
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: 0.15,
      }}
    >
      <Typography
        component="div"
        variant="overline"
        color="text.secondary"
        sx={{
          display: "block",
          fontSize: { xs: "0.56rem", sm: "0.62rem" },
          lineHeight: 1.2,
          letterSpacing: "0.03em",
        }}
      >
        {label}
      </Typography>
      <Typography
        component="div"
        variant="mono"
        title={value}
        sx={{
          display: "block",
          fontSize: { xs: "0.85rem", sm: "0.92rem" },
          fontWeight: 600,
          lineHeight: 1.15,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}
