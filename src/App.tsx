import { Route, Routes } from "react-router-dom";
import { SessionListPage } from "./pages/SessionListPage";
import { SessionDetailPage } from "./pages/SessionDetailPage";

export function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            Claude <span>Sessions</span>
          </div>
          <div className="brand-sub">
            Visualize · profile · optimize local Claude Code runs
          </div>
        </div>
        <div className="topbar-meta">
          reads ~/.claude/projects
          <br />
          + fixtures
        </div>
      </header>
      <Routes>
        <Route path="/" element={<SessionListPage />} />
        <Route path="/sessions/:id" element={<SessionDetailPage />} />
      </Routes>
    </div>
  );
}
