import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import type { AnalysisSeverity, SessionAnalysis } from "@shared/types";
import { EmptyState, SectionPaper } from "./ui";
import { apiPost } from "../lib/api";
import { layout } from "../theme";

/** Slightly above the server default (120s) so the API can report timeout first. */
const CLIENT_ANALYZE_TIMEOUT_MS = 130_000;

interface Props {
  sessionId: string;
}

function severityColor(
  severity: AnalysisSeverity,
): "info" | "warning" | "error" {
  if (severity === "critical") return "error";
  if (severity === "warning") return "warning";
  return "info";
}

export function SessionAnalysisPanel({ sessionId }: Props) {
  const [analysis, setAnalysis] = useState<SessionAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setAnalysis(null);
    setError(null);
    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const runAnalysis = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, CLIENT_ANALYZE_TIMEOUT_MS);

    setLoading(true);
    setError(null);
    try {
      const result = await apiPost<SessionAnalysis>(
        `/api/sessions/${sessionId}/analyze`,
        {},
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) {
        setAnalysis(result);
      }
    } catch (err) {
      if (controller.signal.aborted) {
        setError(
          "Analysis timed out or was cancelled. Check ANTHROPIC_API_KEY / `claude auth login`, then try again.",
        );
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setLoading(false);
    }
  };

  return (
    <SectionPaper
      title="Agent SDK analysis"
      description="Use the Claude Agent SDK to read session metadata/messages and produce optimization findings for this run. Requires ANTHROPIC_API_KEY or an authenticated Claude CLI login."
      sx={{ mb: layout.sectionGap }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{
          alignItems: { sm: "center" },
          justifyContent: "space-between",
          mb: 2,
        }}
      >
        <Typography variant="body2" color="text.secondary" sx={{ minWidth: 0 }}>
          Sends a compact profile brief (plus SDK session APIs when available)
          to a single-turn Agent SDK query.
        </Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={
            loading ? (
              <CircularProgress size={14} color="inherit" />
            ) : (
              <AutoAwesomeOutlinedIcon fontSize="small" />
            )
          }
          onClick={() => {
            void runAnalysis();
          }}
          disabled={loading}
          sx={{ flexShrink: 0, alignSelf: { xs: "stretch", sm: "center" } }}
        >
          {loading ? "Analyzing…" : analysis ? "Re-analyze" : "Analyze session"}
        </Button>
      </Stack>

      {error ? (
        <Alert severity="warning" sx={{ mb: analysis ? 2 : 0 }}>
          {error}
        </Alert>
      ) : null}

      {!analysis && !error && !loading ? (
        <EmptyState sx={{ py: 3 }}>
          Run Agent SDK analysis to get context-bloat findings and concrete
          recommendations for this session.
        </EmptyState>
      ) : null}

      {loading && !analysis ? (
        <Box sx={{ py: 3, textAlign: "center" }}>
          <CircularProgress size={28} />
          <Typography color="text.secondary" sx={{ mt: 1.5 }}>
            Asking the Agent SDK to profile this session…
          </Typography>
          <Typography
            color="text.secondary"
            variant="caption"
            sx={{ display: "block", mt: 0.75 }}
          >
            Usually finishes in under a minute. If this never returns, auth or
            the Claude CLI subprocess may be stuck — the request times out
            automatically.
          </Typography>
        </Box>
      ) : null}

      {analysis ? (
        <Stack spacing={2}>
          <Typography variant="body1">{analysis.summary}</Typography>

          <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap" }}>
            {analysis.model ? (
              <Chip size="small" variant="outlined" label={analysis.model} />
            ) : null}
            <Chip
              size="small"
              variant="outlined"
              label={`${Math.round(analysis.durationMs)} ms`}
            />
            {analysis.costUsd != null ? (
              <Chip
                size="small"
                variant="outlined"
                label={`$${analysis.costUsd.toFixed(4)}`}
              />
            ) : null}
            <Chip
              size="small"
              variant="outlined"
              color={analysis.usedSdkSessionApi ? "success" : "default"}
              label={
                analysis.usedSdkSessionApi
                  ? "SDK session APIs used"
                  : "Profile-only brief"
              }
            />
          </Stack>

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Findings
            </Typography>
            {analysis.findings.length === 0 ? (
              <Typography color="text.secondary" variant="body2">
                No findings reported.
              </Typography>
            ) : (
              <Stack spacing={1}>
                {analysis.findings.map((finding, index) => (
                  <Box
                    key={`${finding.title}-${index}`}
                    sx={{
                      border: 1,
                      borderColor: "divider",
                      borderRadius: 1,
                      bgcolor: "action.hover",
                      px: 1.5,
                      py: 1.25,
                    }}
                  >
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: "center", mb: 0.5, flexWrap: "wrap" }}
                      useFlexGap
                    >
                      <Chip
                        size="small"
                        color={severityColor(finding.severity)}
                        label={finding.severity}
                      />
                      {finding.relatedTool ? (
                        <Chip
                          size="small"
                          variant="outlined"
                          label={finding.relatedTool}
                        />
                      ) : null}
                      <Typography variant="subtitle2">{finding.title}</Typography>
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {finding.detail}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            )}
          </Box>

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Recommendations
            </Typography>
            {analysis.recommendations.length === 0 ? (
              <Typography color="text.secondary" variant="body2">
                No recommendations reported.
              </Typography>
            ) : (
              <Stack spacing={1}>
                {analysis.recommendations.map((rec, index) => (
                  <Box
                    key={`${rec.title}-${index}`}
                    sx={{
                      border: 1,
                      borderColor: "divider",
                      borderRadius: 1,
                      px: 1.5,
                      py: 1.25,
                    }}
                  >
                    <Typography variant="subtitle2">{rec.title}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {rec.detail}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="success.main"
                      sx={{ display: "block", mt: 0.75 }}
                    >
                      Impact: {rec.impact}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            )}
          </Box>
        </Stack>
      ) : null}
    </SectionPaper>
  );
}
