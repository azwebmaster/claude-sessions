import type {
  AnalyzeModelAlias,
  SessionAnalysis,
} from "../shared/types.js";

export type AnalysisCacheFingerprintSource = {
  mtimeMs: number;
  size: number;
};

export type AnalysisCacheEntry = {
  analysis: SessionAnalysis;
  model: AnalyzeModelAlias;
  fingerprint: string;
  cachedAt: number;
};

const cache = new Map<string, AnalysisCacheEntry>();

export function analysisFingerprint(
  source: AnalysisCacheFingerprintSource,
): string {
  return `${source.mtimeMs}:${source.size}`;
}

function cacheKey(
  sessionId: string,
  model: AnalyzeModelAlias,
  fingerprint: string,
): string {
  return `${sessionId}\0${model}\0${fingerprint}`;
}

/** Return a cached analysis when the session file fingerprint still matches. */
export function getCachedAnalysis(
  sessionId: string,
  model: AnalyzeModelAlias,
  fingerprint: string,
): SessionAnalysis | null {
  const entry = cache.get(cacheKey(sessionId, model, fingerprint));
  if (!entry) return null;
  return structuredClone(entry.analysis);
}

export function setCachedAnalysis(
  sessionId: string,
  model: AnalyzeModelAlias,
  fingerprint: string,
  analysis: SessionAnalysis,
): void {
  // Drop any prior entries for this session+model (stale fingerprints).
  const prefix = `${sessionId}\0${model}\0`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix) && !key.endsWith(`\0${fingerprint}`)) {
      cache.delete(key);
    }
  }
  cache.set(cacheKey(sessionId, model, fingerprint), {
    analysis: structuredClone(analysis),
    model,
    fingerprint,
    cachedAt: Date.now(),
  });
}

/** Test helper — clears the in-memory analysis cache. */
export function clearAnalysisCache(): void {
  cache.clear();
}

/** Test helper — current entry count. */
export function analysisCacheSize(): number {
  return cache.size;
}
