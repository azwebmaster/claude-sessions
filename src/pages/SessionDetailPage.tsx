import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { SessionDetail } from "@shared/types";
import {
  formatTokens,
  totalTokens,
  contextSize,
} from "@shared/types";
import { api, formatDate } from "../lib/api";
import { HierarchyTree } from "../components/HierarchyTree";
import { ContextChart } from "../components/ContextChart";
import { ToolImpactList } from "../components/ToolImpactList";
import { AgentBreakdown } from "../components/AgentBreakdown";

export function SessionDetailPage() {
  const { id } = useParams();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setDetail(null);
    setError(null);
    api<SessionDetail>(`/api/sessions/${id}`)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return (
      <div>
        <Link className="back-link" to="/">
          ← All sessions
        </Link>
        <div className="panel panel-pad error">Failed to load session: {error}</div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div>
        <Link className="back-link" to="/">
          ← All sessions
        </Link>
        <div className="panel panel-pad loading">Building session profile…</div>
      </div>
    );
  }

  const { meta } = detail;

  return (
    <div>
      <Link className="back-link" to="/">
        ← All sessions
      </Link>

      <div className="detail-header">
        <div>
          <h1 className="detail-title">
            {meta.summary ?? "Untitled session"}
          </h1>
          <p className="detail-sub">
            {meta.projectPath}
            {meta.gitBranch ? ` · ${meta.gitBranch}` : ""}
            {" · "}
            {formatDate(meta.startedAt)} → {formatDate(meta.updatedAt)}
          </p>
        </div>
        <div className="stat-grid">
          <div className="stat">
            <div className="stat-label">Total tokens</div>
            <div className="stat-value">
              {formatTokens(totalTokens(meta.usage))}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Peak context</div>
            <div className="stat-value">
              {formatTokens(meta.peakContextTokens)}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Cache read</div>
            <div className="stat-value">
              {formatTokens(meta.usage.cacheReadInputTokens)}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Tool calls</div>
            <div className="stat-value">{meta.toolCallCount}</div>
          </div>
        </div>
      </div>

      <div className="detail-layout">
        <div className="panel panel-pad">
          <h2 className="section-title">Agent & tool hierarchy</h2>
          <p className="muted" style={{ marginTop: 0, marginBottom: "0.9rem" }}>
            Root agent → tool calls → results / subagents. Token chips show
            usage; result nodes estimate how much each tool added to context.
          </p>
          <div className="tree">
            <HierarchyTree node={detail.tree} defaultOpen />
          </div>
        </div>

        <div style={{ display: "grid", gap: "1rem" }}>
          <div className="panel panel-pad">
            <h2 className="section-title">Context size over turns</h2>
            <p className="muted" style={{ marginTop: 0, marginBottom: "0.75rem" }}>
              Each bar is an assistant turn&apos;s context occupancy (
              {formatTokens(contextSize(meta.usage))} cumulative input+cache).
            </p>
            <ContextChart points={detail.timeline} />
          </div>

          <div className="panel panel-pad">
            <h2 className="section-title">Agents</h2>
            <AgentBreakdown rows={detail.agentBreakdown} />
          </div>

          <div className="panel panel-pad">
            <h2 className="section-title">Tool impact on context</h2>
            <ToolImpactList rows={detail.toolImpact} />
          </div>
        </div>
      </div>
    </div>
  );
}
