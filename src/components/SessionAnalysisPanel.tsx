import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  LinearProgress,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import {
  ANALYZE_MODEL_ALIASES,
  DEFAULT_ANALYZE_MODEL_ALIAS,
  type AnalysisSeverity,
  type AnalyzeModelAlias,
  type AnalyzeProgressEvent,
  type AnalyzeProgressStage,
  type SessionAnalysis,
} from "@shared/types";
import { formatAnalysisAgentPrompt } from "@shared/formatAnalysisPrompt";
import { EmptyState, SectionPaper } from "./ui";
import { apiAnalyzeStream, apiGetCachedAnalysis } from "../lib/api";
import { layout } from "../theme";

const MODEL_LABELS: Record<AnalyzeModelAlias, string> = {
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
};

/** Above server hard cap (300s) so the API can report timeout first. */
const CLIENT_ANALYZE_TIMEOUT_MS = 310_000;

const STAGE_LABELS: { stage: AnalyzeProgressStage; label: string }[] = [
  { stage: "starting", label: "Prepare profile" },
  { stage: "enriching", label: "SDK session metadata" },
  { stage: "brief_ready", label: "Build brief" },
  { stage: "query_start", label: "Start Claude CLI" },
  { stage: "authenticating", label: "Authenticate" },
  { stage: "sdk_ready", label: "CLI ready" },
  { stage: "model_running", label: "Model running" },
  { stage: "parsing", label: "Parse results" },
  { stage: "complete", label: "Complete" },
];

const STAGE_ORDER = STAGE_LABELS.map((s) => s.stage);

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

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function stageIndex(stage: AnalyzeProgressStage | null): number {
  if (!stage) return -1;
  return STAGE_ORDER.indexOf(stage);
}

export function SessionAnalysisPanel({ sessionId }: Props) {
  const [analysis, setAnalysis] = useState<SessionAnalysis | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hydrating, setHydrating] = useState(true);
  const [progress, setProgress] = useState<AnalyzeProgressEvent | null>(null);
  const [seenStages, setSeenStages] = useState<AnalyzeProgressStage[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [model, setModel] = useState<AnalyzeModelAlias>(
    DEFAULT_ANALYZE_MODEL_ALIAS,
  );
  const abortRef = useRef<AbortController | null>(null);
  const hydrateAbortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const copyResetRef = useRef<number | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    hydrateAbortRef.current?.abort();
    hydrateAbortRef.current = null;
    setAnalysis(null);
    setFromCache(false);
    setError(null);
    setLoading(false);
    setHydrating(true);
    setProgress(null);
    setSeenStages([]);
    setElapsedMs(0);
    setCopyState("idle");
    startedAtRef.current = null;
  }, [sessionId]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      hydrateAbortRef.current?.abort();
      hydrateAbortRef.current = null;
      if (copyResetRef.current != null) {
        window.clearTimeout(copyResetRef.current);
      }
    };
  }, []);

  useEffect(() => {
    hydrateAbortRef.current?.abort();
    const controller = new AbortController();
    hydrateAbortRef.current = controller;
    setHydrating(true);
    setAnalysis(null);
    setFromCache(false);
    void apiGetCachedAnalysis(sessionId, model, { signal: controller.signal })
      .then((cached) => {
        if (controller.signal.aborted) return;
        if (cached) {
          setAnalysis(cached);
          setFromCache(true);
          setError(null);
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        // Cache miss / network blip should not block Analyze.
        if (err instanceof Error && err.name === "AbortError") return;
      })
      .finally(() => {
        if (!controller.signal.aborted) setHydrating(false);
      });
    return () => {
      controller.abort();
      if (hydrateAbortRef.current === controller) {
        hydrateAbortRef.current = null;
      }
    };
  }, [sessionId, model]);

  useEffect(() => {
    if (!loading) return;
    const id = window.setInterval(() => {
      if (startedAtRef.current != null) {
        setElapsedMs(Date.now() - startedAtRef.current);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [loading]);

  const cancelAnalysis = () => {
    abortRef.current?.abort();
  };

  const runAnalysis = async (force: boolean) => {
    hydrateAbortRef.current?.abort();
    hydrateAbortRef.current = null;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, CLIENT_ANALYZE_TIMEOUT_MS);

    startedAtRef.current = Date.now();
    setLoading(true);
    setError(null);
    setProgress(null);
    setSeenStages([]);
    setElapsedMs(0);
    setCopyState("idle");
    try {
      const result = await apiAnalyzeStream(
        sessionId,
        { model, force },
        {
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === "progress") {
              setProgress(event);
              setElapsedMs(event.elapsedMs);
              setSeenStages((prev) =>
                prev.includes(event.stage) ? prev : [...prev, event.stage],
              );
            }
          },
        },
      );
      if (!controller.signal.aborted) {
        setAnalysis(result.analysis);
        setFromCache(result.cached);
      }
    } catch (err) {
      if (controller.signal.aborted) {
        setError(
          "Analysis timed out or was cancelled. Analysis inherits system Claude auth — run the server as the same user as `claude auth login`, or set ANTHROPIC_API_KEY / CLAUDE_SESSIONS_CLAUDE_PATH and retry.",
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
      startedAtRef.current = null;
    }
  };

  const copyAgentPrompt = async () => {
    if (!analysis) return;
    const prompt = formatAnalysisAgentPrompt(analysis);
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    if (copyResetRef.current != null) {
      window.clearTimeout(copyResetRef.current);
    }
    copyResetRef.current = window.setTimeout(() => {
      setCopyState("idle");
      copyResetRef.current = null;
    }, 2000);
  };

  const currentIdx = stageIndex(progress?.stage ?? null);
  const hasRecommendations = (analysis?.recommendations.length ?? 0) > 0;

  return (
    <SectionPaper
      title="Agent SDK analysis"
      description="Use the Claude Agent SDK to read session metadata/messages and produce optimization findings for this run. Inherits system auth from your Claude user settings, CLI login, or server environment. Results are cached until the session file changes."
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
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{
            flexShrink: 0,
            alignSelf: { xs: "stretch", sm: "center" },
            alignItems: { sm: "center" },
          }}
        >
          <Stack
            direction="row"
            spacing={0.25}
            sx={{
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              p: 0.25,
              alignSelf: { xs: "stretch", sm: "center" },
            }}
          >
            <ToggleButtonGroup
              exclusive
              size="small"
              value={model}
              disabled={loading}
              onChange={(_e, value: AnalyzeModelAlias | null) => {
                if (value != null) setModel(value);
              }}
              aria-label="Analyze model"
              sx={{ width: { xs: "100%", sm: "auto" } }}
            >
              {ANALYZE_MODEL_ALIASES.map((alias) => (
                <ToggleButton
                  key={alias}
                  value={alias}
                  aria-label={MODEL_LABELS[alias]}
                  sx={{
                    textTransform: "none",
                    fontSize: "0.72rem",
                    px: 1,
                    py: 0.25,
                    color: "text.secondary",
                    border: "none",
                    flex: { xs: 1, sm: "none" },
                  }}
                >
                  {MODEL_LABELS[alias]}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Stack>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignSelf: { xs: "stretch", sm: "center" } }}
          >
            {loading ? (
              <Button
                variant="outlined"
                size="small"
                color="inherit"
                onClick={cancelAnalysis}
                sx={{ flex: { xs: 1, sm: "none" } }}
              >
                Cancel
              </Button>
            ) : null}
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
                void runAnalysis(Boolean(analysis));
              }}
              disabled={loading}
              sx={{ flex: { xs: 1, sm: "none" } }}
            >
              {loading
                ? "Analyzing…"
                : analysis
                  ? "Re-analyze"
                  : "Analyze session"}
            </Button>
          </Stack>
        </Stack>
      </Stack>

      {error ? (
        <Alert severity="warning" sx={{ mb: analysis ? 2 : 0 }}>
          {error}
        </Alert>
      ) : null}

      {!analysis && !error && !loading && !hydrating ? (
        <EmptyState sx={{ py: 3 }}>
          Run Agent SDK analysis to get context-bloat findings and concrete
          recommendations for this session.
        </EmptyState>
      ) : null}

      {!analysis && !error && !loading && hydrating ? (
        <Box sx={{ py: 3, display: "flex", justifyContent: "center" }}>
          <CircularProgress size={22} />
        </Box>
      ) : null}

      {loading ? (
        <Box sx={{ py: 2 }}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}
          >
            <Typography variant="body2" color="text.secondary">
              {progress?.message ?? "Starting analysis…"}
            </Typography>
            <Chip
              size="small"
              variant="outlined"
              label={formatElapsed(elapsedMs)}
            />
          </Stack>
          <LinearProgress sx={{ mb: 2, borderRadius: 1 }} />
          <Stack spacing={0.75}>
            {STAGE_LABELS.filter((item) => {
              // Hide authenticating unless we've seen it or it's current.
              if (
                item.stage === "authenticating" &&
                !seenStages.includes("authenticating") &&
                progress?.stage !== "authenticating"
              ) {
                return false;
              }
              return true;
            }).map((item) => {
              const idx = STAGE_ORDER.indexOf(item.stage);
              const done =
                seenStages.includes(item.stage) &&
                (currentIdx < 0 || idx < currentIdx || progress?.stage === "complete");
              const active = progress?.stage === item.stage && item.stage !== "complete";
              return (
                <Stack
                  key={item.stage}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center" }}
                >
                  {done ? (
                    <CheckCircleOutlinedIcon
                      fontSize="small"
                      color="success"
                      sx={{ fontSize: 18 }}
                    />
                  ) : active ? (
                    <CircularProgress size={14} sx={{ m: "2px" }} />
                  ) : (
                    <Box
                      sx={{
                        width: 14,
                        height: 14,
                        m: "2px",
                        borderRadius: "50%",
                        border: 1,
                        borderColor: "divider",
                      }}
                    />
                  )}
                  <Typography
                    variant="body2"
                    color={active || done ? "text.primary" : "text.secondary"}
                    sx={{ fontWeight: active ? 600 : 400 }}
                  >
                    {item.label}
                  </Typography>
                </Stack>
              );
            })}
          </Stack>
          <Typography
            color="text.secondary"
            variant="caption"
            sx={{ display: "block", mt: 1.5 }}
          >
            Idle runs stop after ~90s without progress; hard cap is 5 minutes.
            Uses the same auth as your local Claude CLI (user settings + env).
          </Typography>
        </Box>
      ) : null}

      {analysis && !loading ? (
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
            {fromCache ? (
              <Chip size="small" variant="outlined" label="Cached" />
            ) : null}
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
            <Stack
              direction="row"
              spacing={1}
              sx={{
                alignItems: "center",
                justifyContent: "space-between",
                mb: 1,
                flexWrap: "wrap",
                gap: 0.5,
              }}
            >
              <Typography variant="subtitle2">Recommendations</Typography>
              <Tooltip
                title={
                  copyState === "copied"
                    ? "Copied"
                    : copyState === "failed"
                      ? "Copy failed"
                      : "Copy as agent prompt"
                }
              >
                <span>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<ContentCopyOutlinedIcon fontSize="small" />}
                    onClick={() => {
                      void copyAgentPrompt();
                    }}
                    disabled={!hasRecommendations && !analysis.summary}
                    aria-label="Copy suggestions as agent prompt"
                  >
                    {copyState === "copied"
                      ? "Copied"
                      : copyState === "failed"
                        ? "Copy failed"
                        : "Copy as agent prompt"}
                  </Button>
                </span>
              </Tooltip>
            </Stack>
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
