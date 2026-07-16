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
        borderRadius: 1.5,
        px: { xs: 1.25, sm: 1.5 },
        py: { xs: 1, sm: 1.25 },
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: 0.35,
      }}
    >
      <Typography
        component="div"
        variant="overline"
        color="text.secondary"
        sx={{
          display: "block",
          fontSize: { xs: "0.6rem", sm: "0.68rem" },
          lineHeight: 1.25,
          letterSpacing: "0.04em",
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
          fontSize: { xs: "0.95rem", sm: "1.05rem" },
          fontWeight: 600,
          lineHeight: 1.2,
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
