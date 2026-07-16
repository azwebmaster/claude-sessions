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
        width: "100%",
        maxWidth: layout.maxWidth,
        mx: "auto",
        px: layout.pagePaddingX,
        pt: layout.pagePaddingY,
        pb: { xs: 4, sm: 5, md: 6 },
        boxSizing: "border-box",
        minWidth: 0,
        ...keyframes,
      }}
    >
      <Stack
        direction="row"
        spacing={{ xs: 1, sm: 2 }}
        sx={{
          alignItems: "flex-start",
          justifyContent: "space-between",
          mb: { xs: 2, sm: 3 },
          animation: motion.rise,
          minWidth: 0,
        }}
      >
        <Stack spacing={0.25} sx={{ minWidth: 0, flex: "1 1 auto" }}>
          <Typography
            component="div"
            sx={{
              fontWeight: 700,
              fontSize: { xs: "1.25rem", sm: "1.5rem", md: "1.85rem" },
              letterSpacing: "-0.03em",
              color: "text.primary",
              lineHeight: 1.2,
              "& span": { color: "primary.main" },
            }}
          >
            Claude <span>Sessions</span>
          </Typography>
          <Typography
            color="text.secondary"
            sx={{ fontSize: { xs: "0.8rem", sm: "0.9rem" }, pr: 1 }}
          >
            Visualize · profile · optimize local Claude Code runs
          </Typography>
        </Stack>
        <Stack
          direction="row"
          spacing={1.5}
          sx={{ alignItems: "center", flexShrink: 0 }}
        >
          <Typography
            variant="mono"
            color="text.secondary"
            sx={{
              fontSize: "0.75rem",
              textAlign: "right",
              display: { xs: "none", md: "block" },
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
