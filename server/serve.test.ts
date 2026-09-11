import assert from "node:assert/strict";
import { createServer, type Server } from "node:net";
import { after, describe, it } from "node:test";
import {
  DEFAULT_PORT_SCAN_SPAN,
  findAvailablePort,
  isPortAvailable,
  portScanSpan,
} from "./serve.js";

const HOST = "127.0.0.1";

/** Bind a throwaway server to occupy a port for the duration of a test. */
function occupy(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, HOST, () => resolve(server));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("portScanSpan", () => {
  it("prefers an explicit positive value", () => {
    assert.equal(portScanSpan(7), 7);
    assert.equal(portScanSpan(1), 1);
  });

  it("ignores invalid values and falls back to the default", () => {
    assert.equal(portScanSpan(0), DEFAULT_PORT_SCAN_SPAN);
    assert.equal(portScanSpan(-3), DEFAULT_PORT_SCAN_SPAN);
    assert.equal(portScanSpan(Number.NaN), DEFAULT_PORT_SCAN_SPAN);
    assert.equal(portScanSpan(undefined), DEFAULT_PORT_SCAN_SPAN);
  });
});

describe("isPortAvailable", () => {
  it("reports a free port as available and a bound port as unavailable", async () => {
    const free = await findAvailablePort(41000, HOST, DEFAULT_PORT_SCAN_SPAN);
    assert.equal(await isPortAvailable(free, HOST), true);

    const server = await occupy(free);
    try {
      assert.equal(await isPortAvailable(free, HOST), false);
    } finally {
      await close(server);
    }
  });
});

describe("findAvailablePort", () => {
  it("returns the requested port when it is free", async () => {
    const start = 42000;
    const port = await findAvailablePort(start, HOST, 20);
    assert.equal(port, start);
  });

  it("skips occupied ports and returns the next free one", async () => {
    const start = 43000;
    const s1 = await occupy(start);
    const s2 = await occupy(start + 1);
    try {
      const port = await findAvailablePort(start, HOST, 20);
      assert.equal(port, start + 2);
    } finally {
      await close(s1);
      await close(s2);
    }
  });

  it("throws when every port in the range is taken", async () => {
    const start = 44000;
    const span = 3;
    const servers: Server[] = [];
    for (let i = 0; i < span; i += 1) {
      servers.push(await occupy(start + i));
    }
    try {
      await assert.rejects(
        () => findAvailablePort(start, HOST, span),
        /No available port found in range 44000-44002/,
      );
    } finally {
      await Promise.all(servers.map(close));
    }
  });

  after(() => {
    // Nothing global to clean up; individual tests close their servers.
  });
});
