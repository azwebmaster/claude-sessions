import assert from "node:assert/strict";
import { createServer } from "node:net";
import { describe, it } from "node:test";
import { startServer } from "./serve.js";

const HOST = "127.0.0.1";

function occupyPort(port: number): Promise<import("node:net").Server> {
  const blocker = createServer();
  return new Promise((resolve) => blocker.listen(port, HOST, () => resolve(blocker)));
}

function closeBlocker(blocker: import("node:net").Server): Promise<void> {
  return new Promise((resolve) => blocker.close(() => resolve()));
}

describe("startServer", () => {
  it("binds the requested port when it is free", async () => {
    const running = await startServer({ port: 21801, host: HOST });
    assert.equal(running.port, 21801);
    await running.close();
  });

  it("falls back to the next free port when the requested one is busy", async () => {
    const blocker = await occupyPort(21802);
    try {
      const running = await startServer({ port: 21802, host: HOST });
      assert.equal(running.port, 21803);
      await running.close();
    } finally {
      await closeBlocker(blocker);
    }
  });

  it("fails instead of falling back when strictPort is set", async () => {
    const blocker = await occupyPort(21804);
    try {
      await assert.rejects(
        startServer({ port: 21804, host: HOST, strictPort: true }),
        /Port 21804 is already in use/,
      );
    } finally {
      await closeBlocker(blocker);
    }
  });

  it("close() resolves without throwing right after start", async () => {
    const running = await startServer({ port: 21805, host: HOST });
    await assert.doesNotReject(running.close());
  });
});
