import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ACTIVE_WINDOW_MS,
  activeWindowMs,
  isSessionActive,
} from "./activeSession.js";

const NOW = Date.parse("2026-07-15T12:00:00.000Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("activeWindowMs", () => {
  it("prefers a valid explicit value", () => {
    assert.equal(activeWindowMs(1234), 1234);
    assert.equal(activeWindowMs(0), 0);
  });

  it("falls back to the default for invalid values", () => {
    assert.equal(activeWindowMs(-1), DEFAULT_ACTIVE_WINDOW_MS);
    assert.equal(activeWindowMs(Number.NaN), DEFAULT_ACTIVE_WINDOW_MS);
    assert.equal(activeWindowMs(undefined), DEFAULT_ACTIVE_WINDOW_MS);
  });
});

describe("isSessionActive", () => {
  it("is active when local activity is within the window", () => {
    assert.equal(
      isSessionActive({ updatedAt: iso(60_000), source: "local" }, NOW),
      true,
    );
  });

  it("is inactive when the last activity is older than the window", () => {
    assert.equal(
      isSessionActive(
        { updatedAt: iso(20 * 60_000), source: "local" },
        NOW,
      ),
      false,
    );
  });

  it("never marks fixtures active even when recent", () => {
    assert.equal(
      isSessionActive({ updatedAt: iso(1000), source: "fixture" }, NOW),
      false,
    );
  });

  it("falls back to startedAt when updatedAt is missing", () => {
    assert.equal(
      isSessionActive(
        { updatedAt: null, startedAt: iso(30_000), source: "local" },
        NOW,
      ),
      true,
    );
  });

  it("is inactive with no timestamps or invalid dates", () => {
    assert.equal(isSessionActive({ updatedAt: null, source: "local" }, NOW), false);
    assert.equal(
      isSessionActive({ updatedAt: "not-a-date", source: "local" }, NOW),
      false,
    );
  });

  it("ignores future timestamps (clock skew)", () => {
    assert.equal(
      isSessionActive({ updatedAt: iso(-5_000), source: "local" }, NOW),
      false,
    );
  });

  it("honors a custom window", () => {
    const session = { updatedAt: iso(5 * 60_000), source: "local" as const };
    assert.equal(isSessionActive(session, NOW, 60_000), false);
    assert.equal(isSessionActive(session, NOW, 10 * 60_000), true);
  });
});
