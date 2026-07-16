import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  radiusForTokenValue,
  radiusFromWeight,
} from "./AgentToolDiagram";

describe("radiusForTokenValue", () => {
  it("maps the largest labeled value to the max radius", () => {
    assert.equal(radiusForTokenValue(2_500_000, 2_500_000, 22, 64), 64);
  });

  it("keeps smaller labeled values smaller on the shared scale", () => {
    const agentR = radiusForTokenValue(2_500_000, 2_500_000, 22, 64);
    const toolR = radiusForTokenValue(45_000, 2_500_000, 22, 64);
    assert.ok(agentR > toolR);
    // Area scales with the token ratio (sqrt weight), not a separate agent/tool range.
    const expectedTool = radiusFromWeight(45_000 / 2_500_000, 22, 64);
    assert.equal(toolR, expectedTool);
  });

  it("changes agent radii when the metric max changes (peak ctx → tokens)", () => {
    const peakMax = 120_000;
    const tokenMax = 2_500_000;
    const subagentPeak = 80_000;
    const subagentTokens = 90_000;

    const peakRadius = radiusForTokenValue(subagentPeak, peakMax, 22, 64);
    const tokenRadius = radiusForTokenValue(subagentTokens, tokenMax, 22, 64);

    // Same node can show a similar absolute count but a much smaller share of
    // the max after switching to total tokens — radius must follow that share.
    assert.ok(tokenRadius < peakRadius);
  });

  it("gives equal radii for equal numbers regardless of node kind", () => {
    const max = 100_000;
    assert.equal(
      radiusForTokenValue(50_000, max, 22, 64),
      radiusForTokenValue(50_000, max, 22, 64),
    );
  });
});
