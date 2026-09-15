import { useMemo } from "react";
import { Breadcrumbs, Link, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { sessionTurnPath } from "../../lib/sessionSelection";
import type { SessionWorkspaceIndex } from "../../lib/turnSteps";
import { layout, monoFontFamily } from "../../theme";

interface Crumb {
  agentId: string;
  label: string;
  /** Null for the scope in view — the current position is not a link. */
  to: string | null;
}

/**
 * Walks `parentAgentId` from the scope in view up to the root agent: O(depth)
 * map lookups, never a scan of `detail.agents`. A subagent whose sidecar
 * recorded no parent was launched by the root agent, so a null `parentAgentId`
 * on a `subagent` scope resolves to `index.rootAgentId`.
 *
 * Each ancestor links to the turn that launched the scope below it. A launching
 * `tool_use` id is also that `tool_call` node's id whenever the transcript
 * supplied one (see `StepEntry.toolUseId`), so `stepByNodeId` resolves it to a
 * turn and the same id doubles as the `?step=` to open.
 */
function buildChain(
  index: SessionWorkspaceIndex,
  sessionId: string,
  scopeId: string,
  watch: boolean | null,
): Crumb[] {
  const chain: Crumb[] = [];
  let childLaunchToolUseId: string | null = null;
  let current = index.scopes.get(scopeId);

  // Bounded by the scope count, so a malformed parent cycle cannot spin.
  for (let hops = index.scopes.size; current && hops > 0; hops -= 1) {
    const launch = childLaunchToolUseId
      ? index.stepByNodeId.get(childLaunchToolUseId)
      : undefined;

    chain.push({
      agentId: current.agentId,
      label: current.label,
      to:
        chain.length === 0
          ? null
          : sessionTurnPath(sessionId, {
              agentId: current.kind === "subagent" ? current.agentId : null,
              turn: launch?.turn ?? 1,
              step: launch ? childLaunchToolUseId : null,
              watch,
            }),
    });

    childLaunchToolUseId = current.launchToolUseId;
    const parentId =
      current.parentAgentId ??
      (current.kind === "subagent" ? index.rootAgentId : null);
    current = parentId ? index.scopes.get(parentId) : undefined;
  }

  return chain.reverse();
}

interface Props {
  sessionId: string;
  index: SessionWorkspaceIndex;
  /** `agentId` from the URL; the scope currently in view. */
  scopeId: string;
  /** Explicit `?watch=` choice, carried into every crumb's link. */
  watch: boolean | null;
}

/**
 * Scope trail under the session header, rendered only while the URL names a
 * subagent. Pure derivation from the route param plus the memoized workspace
 * index — the component holds no state of its own.
 */
export function SubagentBreadcrumb({
  sessionId,
  index,
  scopeId,
  watch,
}: Props) {
  const chain = useMemo(
    () => buildChain(index, sessionId, scopeId, watch),
    [index, sessionId, scopeId, watch],
  );

  // One crumb means the root scope; none means the URL named an unknown agent,
  // which `TurnsView` reports as an error.
  if (chain.length < 2) return null;

  return (
    <Breadcrumbs
      aria-label="Agent scope"
      sx={{ mb: layout.sectionGap, minWidth: 0, fontSize: "0.78rem" }}
    >
      {chain.map((crumb) =>
        crumb.to ? (
          <Link
            key={crumb.agentId}
            component={RouterLink}
            to={crumb.to}
            underline="hover"
            sx={{ fontFamily: monoFontFamily, fontSize: "0.78rem" }}
          >
            {crumb.label}
          </Link>
        ) : (
          <Typography
            key={crumb.agentId}
            variant="mono"
            aria-current="page"
            sx={{ fontSize: "0.78rem", fontWeight: 650 }}
          >
            {crumb.label}
          </Typography>
        ),
      )}
    </Breadcrumbs>
  );
}
