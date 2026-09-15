# 003 — Remove wildcard CORS exposure; warn when binding to a non-loopback host

## Status

- **Priority:** P1
- **Effort:** S
- **Risk:** Low
- **Depends on:** none
- **Category:** Security
- **Planned at commit:** `3aac79e`
- **Issue:** (none filed)

## Why this matters

This app runs a local HTTP server that reads and serves the contents of the
user's Claude Code session transcripts — which can include prompts, file
contents, and tool output from any project the user has worked on. Two
independent issues compound the exposure of that data:

**1. Wildcard CORS.** `server/app.ts:41` mounts `hono/cors`'s `cors()`
middleware on `/api/*` with no options:

```ts
app.use("/api/*", cors());
```

Hono's `cors()` with no arguments defaults to `Access-Control-Allow-Origin:
*` (confirmed against `hono/cors`'s documented default). That means **any
website**, running in any browser tab on the user's machine, can issue a
`fetch()` to `http://127.0.0.1:8787/api/sessions` (or whatever port this
server is bound to) and read back the full list of the user's local Claude
Code sessions — a classic "localhost service" data-exfiltration pattern:
the attacker doesn't need to be on the same network, just get the victim to
load a page in a browser that can reach `localhost`.

Critically, **the app itself never needs this.** Confirmed via
`vite.config.ts`:

```ts
server: {
  port: 5173,
  proxy: {
    "/api": { target: "http://127.0.0.1:8787", changeOrigin: true, timeout: 320_000, proxyTimeout: 320_000 },
  },
},
```

In dev, the Vite dev server proxies `/api` requests server-side — the
browser only ever talks to `http://localhost:5173`, same-origin, and Vite's
own process forwards to `:8787`. In production, `createApp({ serveClient:
true })` serves the built client from the same Hono app on the same origin
as the API. In neither case does the browser ever make a genuine
cross-origin request to this API. The wildcard CORS middleware exists for
no functional reason and only makes the API readable by arbitrary third-party
sites.

Confirmed via `grep -rn "cors\|createApp\|Origin" --include="*.test.ts" .`
→ **no matches** — no test in the repo exercises or depends on CORS
behavion, so removing it carries no test-breakage risk.

**2. No guard on non-loopback binds.** `server/serve.ts:22` defaults to the
safe `127.0.0.1`, but `cli/index.ts`'s `-H`/`--host` flag (documented at
line 21: `-H, --host <host>  Hostname to bind (default: 127.0.0.1)`) passes
whatever the user types straight through with no validation and no warning:

```ts
await startServer({
  port,
  host: values.host,
});
```

Binding to `0.0.0.0` or a LAN IP is a legitimate thing to want (e.g. viewing
session data from a phone on the same network), so this plan does not block
it — but today a user who runs `claude-sessions serve -H 0.0.0.0` gets zero
indication that they've just exposed their local session data (unauthenticated,
readable by anyone on that network) to every other device on the LAN. This
plan adds a printed warning, not a hard failure.

## Current state

`server/app.ts:1-42` (imports + the CORS mount):

```ts
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { stream } from "hono/streaming";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import {
  defaultSessionRoots,
  findSessionFile,
  listSessions,
  loadSessionRaw,
} from "./sessions.js";
import { buildSessionDetail } from "./parser.js";
import { AnalyzeSessionError, resolveAnalyzeModel } from "./analyze.js";
import {
  analysisFingerprint,
  getCachedAnalysis,
} from "./analysisCache.js";
import { runAnalyzeWithCache } from "./runAnalyzeWithCache.js";
import type { AnalyzeStreamEvent } from "../shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Package root when running from source; `dist/` when compiled. */
const packageRoot = path.resolve(__dirname, "..");

export type CreateAppOptions = {
  /** Serve built client assets (production). Defaults to NODE_ENV === "production". */
  serveClient?: boolean;
  /** Port shown in the dev landing page. */
  port?: number;
};

export function createApp(options: CreateAppOptions = {}): Hono {
  const serveClient =
    options.serveClient ?? process.env.NODE_ENV === "production";
  const port = options.port ?? Number(process.env.PORT ?? 8787);

  const app = new Hono();

  app.use("/api/*", cors());

  app.get("/api/health", (c) =>
```

`server/serve.ts` (full file, 42 lines):

```ts
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { defaultSessionRoots } from "./sessions.js";

export type ServeOptions = {
  port?: number;
  host?: string;
  /** Serve built client assets. Defaults to NODE_ENV === "production". */
  serveClient?: boolean;
};

export type RunningServer = {
  port: number;
  host: string;
  close: () => Promise<void>;
};

export async function startServer(
  options: ServeOptions = {},
): Promise<RunningServer> {
  const port = options.port ?? Number(process.env.PORT ?? 8787);
  const host = options.host ?? "127.0.0.1";
  const app = createApp({
    port,
    serveClient: options.serveClient,
  });

  console.log(`Claude Sessions API listening on http://${host}:${port}`);
  console.log(`Session roots: ${defaultSessionRoots().join(", ")}`);

  const server = serve({ fetch: app.fetch, port, hostname: host });

  return {
    port,
    host,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
```

`cli/index.ts:118-130` (the `serve` command handler that passes `-H` straight
through, no validation):

```ts
  if (command === "serve") {
    const port = values.port !== undefined ? Number(values.port) : undefined;
    if (port !== undefined && (!Number.isFinite(port) || port <= 0)) {
      console.error(`Invalid port: ${values.port}`);
      process.exit(1);
    }

    await startServer({
      port,
      host: values.host,
    });
    return;
  }
```

`cli/index.ts:19-21` (help text documenting the flag):

```
Options for serve:
  -p, --port <number>   Port to listen on (default: 8787, or $PORT)
  -H, --host <host>     Hostname to bind (default: 127.0.0.1)
```

## Commands you will need

| Purpose | Command |
|---|---|
| Typecheck | `pnpm typecheck` |
| Run full test suite | `pnpm test` |
| Manually confirm the warning fires | `node dist/cli/index.js serve -H 0.0.0.0` (Ctrl+C to stop) after `pnpm build`, or `npx tsx cli/index.ts serve -H 0.0.0.0` without building |
| Manually confirm no warning on default/loopback | `npx tsx cli/index.ts serve` and `npx tsx cli/index.ts serve -H 127.0.0.1` |

## Scope

**In scope:**
- `server/app.ts` — remove the `cors()` middleware mount and its now-unused
  `import { cors } from "hono/cors";`.
- `server/serve.ts` — add a loopback-check helper and a `console.warn` when
  the resolved host is not a loopback address.

**Out of scope — do not touch:**
- Do not add any authentication/authorization to the API. That's a much
  larger change (who authenticates, how, against what) and isn't what this
  finding calls for — this finding is specifically about the *default*
  unauthenticated exposure being needlessly widened by CORS, and about
  making the network-bind trade-off visible, not about adding auth.
- Do not turn the non-loopback warning into a hard error or an interactive
  confirmation prompt — binding to `0.0.0.0`/a LAN IP is a legitimate user
  choice (e.g. viewing from a phone on the same network); this plan only
  makes the trade-off visible via a printed warning, and must not break
  existing non-interactive usage (e.g. someone's shell script or systemd
  unit that runs `claude-sessions serve -H 0.0.0.0` unattended).
- Do not modify `hono/cors`'s package/version, `vite.config.ts`, or any other
  file. This plan touches exactly `server/app.ts` and `server/serve.ts`.
- Do not remove or change the `-H`/`--host` flag itself, its default, or its
  help text in `cli/index.ts` — the flag's behavior (which host it binds to)
  is unchanged by this plan; only `server/serve.ts` gets a new warning
  side-effect.

## Git workflow

1. Create a branch off `main`: `git checkout -b security/restrict-cors-warn-network-bind`.
2. Make the two changes described in Steps below as a single commit (they
   are one finding with two parts).
3. Do not push or open a PR as part of this plan unless the person running
   it tells you to — stop after the commit and report status.

## Steps

### Step 1 — Remove the wildcard CORS middleware

In `server/app.ts`:

1. Delete the import on line 3:
   ```ts
   import { cors } from "hono/cors";
   ```
2. Delete line 41:
   ```ts
   app.use("/api/*", cors());
   ```

Do not replace it with a scoped `cors({ origin: ... })` call — per the
"Why this matters" section above, the app's own client never makes a
cross-origin request (dev proxy + same-origin `serveClient` in prod), so no
CORS configuration is needed at all. Adding a same-origin allowlist would be
unnecessary complexity for a case that never occurs in normal operation.

**Verify:** `pnpm typecheck` — must exit 0 with no unused-import errors and
no missing-symbol errors elsewhere in `server/app.ts` (confirm nothing else
in the file referenced the now-removed `cors` import — it was only used on
the one line above).

### Step 2 — Warn on non-loopback host binds

In `server/serve.ts`, add a small loopback-check helper and call it before
starting the server. Replace the full file with:

```ts
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { defaultSessionRoots } from "./sessions.js";

export type ServeOptions = {
  port?: number;
  host?: string;
  /** Serve built client assets. Defaults to NODE_ENV === "production". */
  serveClient?: boolean;
};

export type RunningServer = {
  port: number;
  host: string;
  close: () => Promise<void>;
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

export async function startServer(
  options: ServeOptions = {},
): Promise<RunningServer> {
  const port = options.port ?? Number(process.env.PORT ?? 8787);
  const host = options.host ?? "127.0.0.1";
  const app = createApp({
    port,
    serveClient: options.serveClient,
  });

  if (!isLoopbackHost(host)) {
    console.warn(
      `Warning: binding to ${host} exposes this server (and local session data) to other devices on the network. The API has no authentication.`,
    );
  }

  console.log(`Claude Sessions API listening on http://${host}:${port}`);
  console.log(`Session roots: ${defaultSessionRoots().join(", ")}`);

  const server = serve({ fetch: app.fetch, port, hostname: host });

  return {
    port,
    host,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
```

The only changes from the original file are: the new `LOOPBACK_HOSTS`
constant, the new `isLoopbackHost` function, and the new `if
(!isLoopbackHost(host)) { console.warn(...) }` block inserted after `host`
is resolved and before the two existing `console.log` lines. Nothing else in
the file changes.

**Verify:**
```
pnpm typecheck
```
must exit 0. Then manually:
```
npx tsx cli/index.ts serve -H 0.0.0.0 &
sleep 1
kill %1
```
must print the new warning line to stderr/stdout before the "listening on"
line. And:
```
npx tsx cli/index.ts serve &
sleep 1
kill %1
```
(default host, no `-H`) must **not** print the warning.

## Test plan

- No existing test covers `server/app.ts`'s middleware setup or
  `server/serve.ts` (confirmed via `grep -rn "cors\|createApp\|startServer" --include="*.test.ts" .`
  before starting — re-run this grep as part of execution and STOP if it now
  finds a match, since that would mean a test exists that this plan's
  author didn't see).
- This plan does not add new automated tests. `isLoopbackHost` is a
  three-line pure function; given the small size of this change and that
  its correctness is fully exercised by the manual verification in Step 2,
  a dedicated unit test is not required. If the person executing this plan
  prefers to add one anyway (e.g. `server/serve.test.ts` exporting and
  testing `isLoopbackHost` — note it is not currently exported, so testing
  it would require adding `export` to the function), that is acceptable but
  not mandatory for this plan's done criteria.
- Manual verification (both commands in Step 2's Verify) is the required
  test evidence for this plan.

## Done criteria

- [ ] `server/app.ts` no longer imports `cors` from `hono/cors` and no
      longer calls `app.use("/api/*", cors())`.
- [ ] `server/serve.ts` contains `isLoopbackHost` and prints a `console.warn`
      when `host` resolves to anything other than `127.0.0.1`, `localhost`,
      or `::1`.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0 with the same pass count as before this change
      (this change touches no test files and no code any existing test
      exercises).
- [ ] Manual check: `npx tsx cli/index.ts serve -H 0.0.0.0` prints the
      warning; `npx tsx cli/index.ts serve` (default) does not.
- [ ] `git diff --stat` shows changes in exactly 2 files: `server/app.ts`
      and `server/serve.ts`.

## STOP conditions

- If `grep -rn "cors\|createApp\|startServer" --include="*.test.ts" .` finds
  a match when you run it (it found none when this plan was written), STOP
  before Step 1 and report — an existing test may depend on CORS headers or
  on `startServer`'s exact console output, which this plan's changes would
  break.
- If any other route or middleware in `server/app.ts` (beyond the one line
  removed in Step 1) references `cors`, STOP — this plan assumed exactly one
  usage site; a second one would mean the import removal in Step 1 is
  incomplete or wrong.

## Maintenance notes

- If a future change genuinely needs cross-origin access to this API (e.g.
  a separate companion app on a different origin), reintroduce `cors()`
  scoped to an explicit, narrow `origin` allowlist — never revert to the
  bare wildcard default this plan removes.
- If someone later wants to make the non-loopback warning stronger (e.g.
  requiring an explicit `--i-know-this-is-insecure` flag, or adding
  authentication), that is a separate, larger follow-up — this plan
  intentionally stops at a printed warning.
