import { createTheme } from "@mui/material/styles";
import type {} from "@mui/material/themeCssVarsAugmentation";
import type { CSSProperties } from "react";
import { keyframes, monoFontFamily } from "./tokens";

const sharedTypography = {
  fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
  h1: {
    fontWeight: 700,
    letterSpacing: "-0.02em",
    fontSize: "1.9rem",
  },
  h2: {
    fontWeight: 650,
    letterSpacing: "-0.01em",
    fontSize: "1.1rem",
  },
  subtitle2: {
    fontWeight: 600,
    letterSpacing: "-0.01em",
  },
  overline: {
    fontSize: "0.68rem",
    fontWeight: 600,
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
  },
  caption: {
    fontSize: "0.72rem",
    lineHeight: 1.35,
  },
};

const sharedShape = {
  borderRadius: 8,
};

const sharedComponents = {
  MuiCssBaseline: {
    styleOverrides: {
      html: {
        // Avoid sideways page scroll from nested wide content.
        overflowX: "clip",
      },
      body: {
        ...keyframes,
        overflowX: "clip",
        // Touch-friendly default; dense tables/trees still use smaller targets.
        WebkitTextSizeAdjust: "100%",
      },
      "#root": {
        minWidth: 0,
        maxWidth: "100%",
      },
    },
  },
  MuiPaper: {
    defaultProps: {
      elevation: 0,
      variant: "outlined" as const,
    },
    styleOverrides: {
      root: {
        backgroundImage: "none",
      },
    },
  },
  MuiButton: {
    defaultProps: {
      disableElevation: true,
    },
    styleOverrides: {
      root: {
        textTransform: "none" as const,
        fontWeight: 600,
      },
    },
  },
  MuiChip: {
    styleOverrides: {
      root: {
        fontWeight: 600,
      },
    },
  },
  MuiTableRow: {
    styleOverrides: {
      root: {
        "&:last-child td, &:last-child th": {
          borderBottom: 0,
        },
      },
    },
  },
  MuiLinearProgress: {
    styleOverrides: {
      root: {
        borderRadius: 4,
      },
    },
  },
  MuiIconButton: {
    styleOverrides: {
      root: {
        border: "1px solid",
        borderColor: "divider",
      },
    },
  },
};

export const theme = createTheme({
  cssVariables: {
    colorSchemeSelector: "data",
  },
  colorSchemes: {
    light: {
      palette: {
        primary: {
          main: "#1976d2",
          light: "#42a5f5",
          dark: "#1565c0",
        },
        secondary: {
          main: "#7b1fa2",
          light: "#ab47bc",
          dark: "#6a1b9a",
        },
        info: {
          main: "#0288d1",
          light: "#4fc3f7",
          dark: "#0277bd",
        },
        warning: {
          main: "#ef6c00",
          light: "#fb8c00",
          dark: "#e65100",
        },
        error: {
          main: "#d32f2f",
          light: "#ef5350",
          dark: "#c62828",
        },
        success: {
          main: "#00897b",
          light: "#26a69a",
          dark: "#00695c",
        },
        background: {
          default: "#f4f6f8",
          paper: "#ffffff",
        },
        divider: "rgba(0, 0, 0, 0.08)",
      },
    },
    dark: {
      palette: {
        primary: {
          main: "#90caf9",
          light: "#bbdefb",
          dark: "#42a5f5",
        },
        secondary: {
          main: "#ce93d8",
          light: "#e1bee7",
          dark: "#ab47bc",
        },
        info: {
          main: "#4fc3f7",
          light: "#81d4fa",
          dark: "#29b6f6",
        },
        warning: {
          main: "#ffb74d",
          light: "#ffcc80",
          dark: "#ffa726",
        },
        error: {
          main: "#f44336",
          light: "#e57373",
          dark: "#d32f2f",
        },
        success: {
          main: "#4db6ac",
          light: "#80cbc4",
          dark: "#26a69a",
        },
        background: {
          default: "#0f1419",
          paper: "#1a2027",
        },
        divider: "rgba(255, 255, 255, 0.1)",
      },
    },
  },
  typography: {
    ...sharedTypography,
    fontFamily: sharedTypography.fontFamily,
    mono: {
      fontFamily: monoFontFamily,
      fontSize: "0.78rem",
      lineHeight: 1.4,
    },
  },
  shape: sharedShape,
  components: sharedComponents,
});

declare module "@mui/material/styles" {
  interface TypographyVariants {
    mono: CSSProperties;
  }

  interface TypographyVariantsOptions {
    mono?: CSSProperties;
  }
}

declare module "@mui/material/Typography" {
  interface TypographyPropsVariantOverrides {
    mono: true;
  }
}
