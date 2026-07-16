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
        px: 1.5,
        py: 1.25,
      }}
    >
      <Typography variant="overline" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="mono" sx={{ mt: 0.25, fontSize: "1.05rem", fontWeight: 600 }}>
        {value}
      </Typography>
    </Box>
  );
}
