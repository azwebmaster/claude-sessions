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
        px: { xs: 1, sm: 1.5 },
        py: { xs: 1, sm: 1.25 },
        minWidth: 0,
      }}
    >
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ fontSize: { xs: "0.6rem", sm: "0.68rem" }, lineHeight: 1.2 }}
      >
        {label}
      </Typography>
      <Typography
        variant="mono"
        sx={{
          mt: 0.25,
          fontSize: { xs: "0.95rem", sm: "1.05rem" },
          fontWeight: 600,
          wordBreak: "break-word",
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}
