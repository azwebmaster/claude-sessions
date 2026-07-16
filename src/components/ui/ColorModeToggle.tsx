import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import SettingsBrightnessOutlinedIcon from "@mui/icons-material/SettingsBrightnessOutlined";
import { IconButton, Tooltip } from "@mui/material";
import { useColorScheme } from "@mui/material/styles";

const modes = ["light", "dark", "system"] as const;
type Mode = (typeof modes)[number];

function nextMode(current: Mode): Mode {
  const index = modes.indexOf(current);
  return modes[(index + 1) % modes.length];
}

function modeLabel(mode: Mode): string {
  switch (mode) {
    case "light":
      return "Light mode";
    case "dark":
      return "Dark mode";
    case "system":
      return "System theme";
  }
}

function ModeIcon({ mode }: { mode: Mode }) {
  switch (mode) {
    case "light":
      return <LightModeOutlinedIcon fontSize="small" />;
    case "dark":
      return <DarkModeOutlinedIcon fontSize="small" />;
    case "system":
      return <SettingsBrightnessOutlinedIcon fontSize="small" />;
  }
}

export function ColorModeToggle() {
  const { mode, setMode } = useColorScheme();

  if (!mode) return null;

  const current = mode as Mode;
  const upcoming = nextMode(current);

  return (
    <Tooltip title={`${modeLabel(current)}. Click for ${modeLabel(upcoming).toLowerCase()}.`}>
      <IconButton
        size="small"
        aria-label={`Color mode: ${modeLabel(current)}`}
        onClick={() => setMode(upcoming)}
        sx={{ bgcolor: "background.paper" }}
      >
        <ModeIcon mode={current} />
      </IconButton>
    </Tooltip>
  );
}
