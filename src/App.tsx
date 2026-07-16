import { Box, Stack, Typography } from "@mui/material";
import { Route, Routes } from "react-router-dom";
import { SessionListPage } from "./pages/SessionListPage";
import { SessionDetailPage } from "./pages/SessionDetailPage";

export function App() {
  return (
    <Box
      sx={{
        width: "min(1280px, calc(100% - 2rem))",
        mx: "auto",
        py: 3,
        pb: 6,
        "@keyframes rise": {
          from: { opacity: 0, transform: "translateY(10px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
      }}
    >
      <Stack
        direction="row"
        spacing={2}
        sx={{
          alignItems: "center",
          justifyContent: "space-between",
          mb: 3,
          animation: "rise 500ms ease both",
        }}
      >
        <Stack spacing={0.25}>
          <Typography
            component="div"
            sx={{
              fontWeight: 700,
              fontSize: { xs: "1.4rem", md: "1.85rem" },
              letterSpacing: "-0.03em",
              color: "text.primary",
              "& span": { color: "primary.main" },
            }}
          >
            Claude <span>Sessions</span>
          </Typography>
          <Typography color="text.secondary" sx={{ fontSize: "0.9rem" }}>
            Visualize · profile · optimize local Claude Code runs
          </Typography>
        </Stack>
        <Typography
          color="text.secondary"
          sx={{
            fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
            fontSize: "0.75rem",
            textAlign: "right",
            display: { xs: "none", sm: "block" },
          }}
        >
          reads ~/.claude/projects
          <br />
          + fixtures
        </Typography>
      </Stack>
      <Routes>
        <Route path="/" element={<SessionListPage />} />
        <Route path="/sessions/:id" element={<SessionDetailPage />} />
      </Routes>
    </Box>
  );
}
