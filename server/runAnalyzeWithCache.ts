import {
  analysisFingerprint,
  getCachedAnalysis,
  setCachedAnalysis,
} from "./analysisCache.js";
import {
  analyzeSession,
  resolveAnalyzeModel,
  type AnalyzeSessionOptions,
} from "./analyze.js";
import type { DiscoveredSessionFile } from "./sessions.js";
import type {
  AnalyzeProgressEvent,
  SessionAnalysis,
  SessionDetail,
} from "../shared/types.js";

export type RunAnalyzeWithCacheOptions = Omit<
  AnalyzeSessionOptions,
  "model"
> & {
  model?: string;
  /** Bypass cache and store a fresh result. */
  force?: boolean;
};

export type RunAnalyzeWithCacheResult = {
  analysis: SessionAnalysis;
  cached: boolean;
  model: ReturnType<typeof resolveAnalyzeModel>;
  fingerprint: string;
};

/**
 * Return a fingerprint-matched cached analysis, or run Agent SDK analysis and cache it.
 */
export async function runAnalyzeWithCache(
  detail: SessionDetail,
  file: DiscoveredSessionFile,
  options: RunAnalyzeWithCacheOptions = {},
): Promise<RunAnalyzeWithCacheResult> {
  const model = resolveAnalyzeModel(options.model);
  const fingerprint = analysisFingerprint(file);
  const force = options.force === true;

  if (!force) {
    const cached = getCachedAnalysis(detail.meta.id, model, fingerprint);
    if (cached) {
      const startedAt = Date.now();
      const emit = async (event: AnalyzeProgressEvent) => {
        try {
          await options.onProgress?.(event);
        } catch {
          // Progress listeners must not break cache hits.
        }
      };
      await emit({
        type: "progress",
        stage: "complete",
        message: "Loaded cached analysis",
        elapsedMs: Date.now() - startedAt,
      });
      return { analysis: cached, cached: true, model, fingerprint };
    }
  }

  const analysis = await analyzeSession(detail, {
    model,
    timeoutMs: options.timeoutMs,
    idleTimeoutMs: options.idleTimeoutMs,
    extrasTimeoutMs: options.extrasTimeoutMs,
    abortController: options.abortController,
    onProgress: options.onProgress,
    runner: options.runner,
    loadExtras: options.loadExtras,
    resolveExecutable: options.resolveExecutable,
    buildEnv: options.buildEnv,
  });
  setCachedAnalysis(detail.meta.id, model, fingerprint, analysis);
  return { analysis, cached: false, model, fingerprint };
}
