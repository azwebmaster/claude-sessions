import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  cssVariables: true,
  typography: {
    fontFamily: '"Sora", sans-serif',
    h1: {
      fontWeight: 700,
      letterSpacing: "-0.03em",
    },
    h2: {
      fontWeight: 600,
      letterSpacing: "-0.01em",
      fontSize: "0.95rem",
    },
  },
  shape: {
    borderRadius: 14,
  },
  palette: {
    mode: "light",
    primary: {
      main: "#c45c26",
      contrastText: "#fff",
    },
    secondary: {
      main: "#1f7a5c",
      contrastText: "#fff",
    },
    warning: {
      main: "#b7791f",
    },
    background: {
      default: "#0f1c17",
      paper: "rgba(236, 245, 238, 0.92)",
    },
    text: {
      primary: "#102018",
      secondary: "#3d5a4c",
    },
    divider: "rgba(16, 32, 24, 0.12)",
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundAttachment: "fixed",
          backgroundImage: [
            "radial-gradient(1200px 600px at 10% -10%, rgba(196, 92, 38, 0.28), transparent 55%)",
            "radial-gradient(900px 500px at 90% 0%, rgba(31, 122, 92, 0.35), transparent 50%)",
            "linear-gradient(160deg, #0f1c17, #152820 45%, #0c1813)",
          ].join(", "),
          minHeight: "100%",
        },
        "#root": {
          minHeight: "100%",
        },
        a: {
          color: "inherit",
          textDecoration: "none",
        },
      },
    },
    MuiPaper: {
      defaultProps: {
        elevation: 0,
      },
      styleOverrides: {
        root: {
          border: "1px solid rgba(255, 255, 255, 0.35)",
          boxShadow: "0 18px 50px rgba(8, 20, 14, 0.28)",
          backdropFilter: "blur(10px)",
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          "&:hover": {
            backgroundColor: "rgba(196, 92, 38, 0.08)",
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontSize: "0.72rem",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          fontWeight: 600,
          color: "#3d5a4c",
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
          fontSize: "0.72rem",
        },
      },
    },
  },
});
