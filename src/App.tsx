import { Box, Stack, Typography } from "@mui/material";
import { Route, Routes } from "react-router-dom";
import { ColorModeToggle } from "./components/ui";
import { SessionListPage } from "./pages/SessionListPage";
import { SessionDetailPage } from "./pages/SessionDetailPage";
import { keyframes, layout, motion } from "./theme";

export function App() {
  return (
    <Box
      sx={{
        width: `min(${layout.maxWidth}px, calc(100% - ${layout.pagePaddingX}rem))`,
        mx: "auto",
        py: layout.pagePaddingY,
        pb: 6,
        ...keyframes,
      }}
    >
      <Stack
        direction="row"
        spacing={2}
        sx={{
          alignItems: "center",
          justifyContent: "space-between",
          mb: 3,
          animation: motion.rise,
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
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <Typography
            variant="mono"
            color="text.secondary"
            sx={{
              fontSize: "0.75rem",
              textAlign: "right",
              display: { xs: "none", sm: "block" },
            }}
          >
            reads ~/.claude/projects
            <br />
            + fixtures
          </Typography>
          <ColorModeToggle />
        </Stack>
      </Stack>
      <Routes>
        <Route path="/" element={<SessionListPage />} />
        <Route path="/sessions/:id" element={<SessionDetailPage />} />
      </Routes>
    </Box>
  );
}
