import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ACTIVE_SESSION_THRESHOLD_MS,
  isSessionActive,
} from "./sessionActivity";

describe("isSessionActive", () => {
  it("returns false when updatedAt is null", () => {
    assert.equal(isSessionActive(null), false);
  });

  it("returns true for a timestamp a few seconds before now", () => {
    const now = Date.parse("2026-07-16T12:00:00.000Z");
    const updatedAt = new Date(now - 5_000).toISOString();
    assert.equal(isSessionActive(updatedAt, now), true);
  });

  it("returns false for a timestamp well beyond the threshold before now", () => {
    const now = Date.parse("2026-07-16T12:00:00.000Z");
    const updatedAt = new Date(
      now - ACTIVE_SESSION_THRESHOLD_MS * 10,
    ).toISOString();
    assert.equal(isSessionActive(updatedAt, now), false);
  });

  it("returns false for an unparsable date string", () => {
    const now = Date.parse("2026-07-16T12:00:00.000Z");
    assert.equal(isSessionActive("not-a-date", now), false);
  });

  it("treats the threshold boundary as exclusive", () => {
    const now = Date.parse("2026-07-16T12:00:00.000Z");
    const updatedAt = new Date(now - ACTIVE_SESSION_THRESHOLD_MS).toISOString();
    assert.equal(isSessionActive(updatedAt, now), false);
  });
});
