import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import type { LogLineRef } from "@shared/types";

interface Props {
  log: LogLineRef | null | undefined;
  open: boolean;
  onClose: () => void;
}

function prettyRaw(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function LogLinePanel({ log, open, onClose }: Props) {
  const pretty = log ? prettyRaw(log.raw) : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      scroll="paper"
      aria-labelledby="log-line-dialog-title"
    >
      <DialogTitle
        id="log-line-dialog-title"
        sx={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 1,
          pr: 1,
          py: 1.5,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography component="span" variant="subtitle2" sx={{ fontSize: "0.95rem" }}>
            Transcript log line
          </Typography>
          {log ? (
            <Typography
              variant="mono"
              color="text.secondary"
              sx={{
                display: "block",
                mt: 0.5,
                fontSize: "0.72rem",
                wordBreak: "break-all",
                lineHeight: 1.35,
              }}
              title={`${log.filePath}:${log.line}`}
            >
              {log.filePath}:{log.line}
            </Typography>
          ) : null}
        </Box>
        <IconButton
          aria-label="Close log detail"
          onClick={onClose}
          size="small"
          sx={{ mt: -0.25 }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {log && pretty ? (
          <Typography
            component="pre"
            variant="mono"
            sx={{
              m: 0,
              px: 2,
              py: 1.5,
              maxHeight: { xs: "60vh", sm: "70vh" },
              overflow: "auto",
              fontSize: "0.72rem",
              lineHeight: 1.45,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {pretty}
          </Typography>
        ) : (
          <Box sx={{ px: 2, py: 2 }}>
            <Typography color="text.secondary" sx={{ fontSize: "0.85rem" }}>
              No JSONL source line for this selection.
            </Typography>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
