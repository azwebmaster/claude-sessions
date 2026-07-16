import type { SessionAnalysis } from "./types.js";

/**
 * Format analysis findings/recommendations into a paste-ready agent prompt.
 */
export function formatAnalysisAgentPrompt(analysis: SessionAnalysis): string {
  const lines: string[] = [
    "Apply these Claude Code session optimization suggestions. Prefer concrete edits to prompts, tools, and workflows that reduce peak context and token cost.",
    "",
    `Session: ${analysis.sessionId}`,
    "",
    "## Summary",
    analysis.summary.trim() || "(none)",
  ];

  if (analysis.recommendations.length > 0) {
    lines.push("", "## Recommendations");
    for (const [index, rec] of analysis.recommendations.entries()) {
      lines.push(
        "",
        `${index + 1}. ${rec.title}`,
        rec.detail.trim(),
        `Impact: ${rec.impact.trim()}`,
      );
    }
  } else {
    lines.push("", "## Recommendations", "", "(none reported)");
  }

  if (analysis.findings.length > 0) {
    lines.push("", "## Findings (context)");
    for (const [index, finding] of analysis.findings.entries()) {
      const tool = finding.relatedTool
        ? ` [${finding.relatedTool}]`
        : "";
      lines.push(
        "",
        `${index + 1}. (${finding.severity})${tool} ${finding.title}`,
        finding.detail.trim(),
      );
    }
  }

  lines.push(
    "",
    "Implement the recommendations that fit this project. Explain what you changed and why.",
  );
  return lines.join("\n");
}
