import { readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import type { SessionListItem } from "../shared/types.js";
import {
  parseSessionFile,
  type RawSessionParse,
} from "./parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function defaultSessionRoots(): string[] {
  const home = os.homedir();
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  const roots = [
    configDir ? path.join(configDir, "projects") : null,
    path.join(home, ".claude", "projects"),
    path.join(home, ".config", "claude", "projects"),
  ].filter((p): p is string => Boolean(p));

  // Deduplicate
  return [...new Set(roots.map((p) => path.resolve(p)))];
}

function fixtureCandidates(): string[] {
  return [
    path.resolve(__dirname, "../fixtures/projects"),
    path.resolve(__dirname, "../../fixtures/projects"),
    path.resolve(process.cwd(), "fixtures/projects"),
  ];
}

export function fixtureRoot(): string {
  for (const candidate of fixtureCandidates()) {
    if (existsSync(candidate)) return candidate;
  }
  return fixtureCandidates()[0]!;
}

async function resolveFixtureRoot(): Promise<string | null> {
  for (const candidate of fixtureCandidates()) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

/** Decode Claude's project folder encoding back toward a filesystem path. */
export function decodeProjectPath(encoded: string): string {
  if (!encoded.startsWith("-")) return encoded;
  // Claude replaces non-alphanumeric with `-`. We restore leading `/` and
  // leave the rest as a best-effort path (ambiguous dashes remain).
  return `/${encoded.slice(1).replace(/-/g, "/")}`;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export interface DiscoveredSessionFile {
  id: string;
  projectEncoded: string;
  projectPath: string;
  filePath: string;
  source: "local" | "fixture";
  mtimeMs: number;
  size: number;
}

export async function discoverSessionFiles(
  roots: string[] = defaultSessionRoots(),
  options: { includeFixtures?: boolean } = {},
): Promise<DiscoveredSessionFile[]> {
  const found: DiscoveredSessionFile[] = [];
  const seen = new Set<string>();

  const searchRoots = [...roots];
  if (options.includeFixtures !== false) {
    const fixtures = await resolveFixtureRoot();
    if (fixtures) searchRoots.push(fixtures);
  }

  for (const root of searchRoots) {
    if (!(await exists(root))) continue;
    const source: "local" | "fixture" = root.includes(`${path.sep}fixtures${path.sep}`)
      ? "fixture"
      : "local";

    let projects: string[] = [];
    try {
      projects = await readdir(root);
    } catch {
      continue;
    }

    for (const projectEncoded of projects) {
      const projectDir = path.join(root, projectEncoded);
      let projectStat;
      try {
        projectStat = await stat(projectDir);
      } catch {
        continue;
      }
      if (!projectStat.isDirectory()) continue;

      let entries: string[] = [];
      try {
        entries = await readdir(projectDir);
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.endsWith(".jsonl")) continue;
        // Skip subagent files that might be misplaced at project root
        if (entry.startsWith("agent-")) continue;

        const filePath = path.join(projectDir, entry);
        const id = entry.replace(/\.jsonl$/, "");
        const key = `${projectEncoded}::${id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        let st;
        try {
          st = await stat(filePath);
        } catch {
          continue;
        }
        if (!st.isFile() || st.size === 0) continue;

        found.push({
          id,
          projectEncoded,
          projectPath: decodeProjectPath(projectEncoded),
          filePath,
          source,
          mtimeMs: st.mtimeMs,
          size: st.size,
        });
      }
    }
  }

  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found;
}

function summarizeFromParse(
  file: DiscoveredSessionFile,
  parsed: RawSessionParse,
): SessionListItem {
  return {
    id: file.id,
    projectPath: parsed.cwd ?? file.projectPath,
    projectEncoded: file.projectEncoded,
    filePath: file.filePath,
    summary: parsed.summary,
    startedAt: parsed.startedAt,
    updatedAt: parsed.updatedAt,
    messageCount: parsed.messageCount,
    turnCount: parsed.turnCount,
    subagentTurnCount: parsed.subagentTurnCount,
    toolCallCount: parsed.toolCallCount,
    subagentCount: parsed.subagentCount,
    model: parsed.model,
    gitBranch: parsed.gitBranch,
    usage: parsed.usage,
    peakContextTokens: parsed.peakContextTokens,
    source: file.source,
  };
}

export async function listSessions(
  roots?: string[],
): Promise<SessionListItem[]> {
  const files = await discoverSessionFiles(roots);
  const items: SessionListItem[] = [];

  for (const file of files) {
    try {
      const parsed = await parseSessionFile(file.filePath, {
        lightweight: true,
        sessionId: file.id,
      });
      items.push(summarizeFromParse(file, parsed));
    } catch (err) {
      console.warn(`Failed to parse ${file.filePath}:`, err);
    }
  }

  items.sort((a, b) => {
    const at = a.updatedAt ?? "";
    const bt = b.updatedAt ?? "";
    return bt.localeCompare(at);
  });

  return items;
}

export async function findSessionFile(
  sessionId: string,
  roots?: string[],
): Promise<DiscoveredSessionFile | null> {
  const files = await discoverSessionFiles(roots);
  return files.find((f) => f.id === sessionId) ?? null;
}

export async function loadSessionRaw(
  sessionId: string,
  roots?: string[],
): Promise<{ file: DiscoveredSessionFile; parsed: RawSessionParse } | null> {
  const file = await findSessionFile(sessionId, roots);
  if (!file) return null;
  const parsed = await parseSessionFile(file.filePath, {
    lightweight: false,
    sessionId: file.id,
  });
  return { file, parsed };
}
