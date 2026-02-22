import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REMOTE_DEBUGGING_PORT = 9333;
const DEFAULT_CONTEXT_COUNT = 2;
const DEFAULT_TTL_OVERRIDE_MS = 2_000;
const POLL_INTERVAL_MS = 100;
const STARTUP_TIMEOUT_MS = 20_000;
const CACHE_ASSERTION_SETTLE_MS = 700;
const MILESTONE = "5.5";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const artifactDirectory = path.join(repositoryRoot, "docs", "artifacts", "phase5", "phase5-5.5");
const artifactPath = path.join(artifactDirectory, "http-cache-partitioning-result.json");

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseIntegerEnv(name, defaultValue) {
  const rawValue = process.env[name];
  if (!rawValue || !rawValue.trim()) {
    return defaultValue;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer. Received: ${rawValue}`);
  }

  return parsed;
}

function parseRemoteDebuggingPort() {
  return parseIntegerEnv("GHOST_REMOTE_DEBUGGING_PORT", DEFAULT_REMOTE_DEBUGGING_PORT);
}

async function waitForWebSocketEndpoint(versionEndpoint, timeoutMs) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(versionEndpoint);
      if (response.ok) {
        const payload = await response.json();
        if (typeof payload.webSocketDebuggerUrl === "string") {
          return payload.webSocketDebuggerUrl;
        }
      }
    } catch {}

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for Electron CDP host at ${versionEndpoint}`);
}

function startElectronCdpHost(remoteDebuggingPort, contextCount) {
  const runHeadfulGhostTab = process.env.GHOST_HEADFUL === "true";
  const scriptName = runHeadfulGhostTab ? "cdp:host:headful" : "cdp:host";

  return spawn("npm", ["run", scriptName, "-w", "@ghost-browser/electron"], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      GHOST_REMOTE_DEBUGGING_PORT: String(remoteDebuggingPort),
      GHOST_CONTEXT_COUNT: String(contextCount),
      GHOST_CONTEXT_AUTO_REPLENISH: "false"
    },
    stdio: "inherit"
  });
}

function waitForExit(processHandle) {
  return new Promise((resolve, reject) => {
    processHandle.once("exit", (code, signal) => {
      if (code === 0 || signal === "SIGTERM") {
        resolve();
        return;
      }

      reject(new Error(`Process exited unexpectedly with code=${String(code)} signal=${String(signal)}`));
    });
  });
}

async function stopElectronCdpHost(processHandle) {
  if (processHandle.exitCode !== null) {
    return;
  }

  processHandle.kill("SIGTERM");

  try {
    await Promise.race([waitForExit(processHandle), sleep(5_000)]);
  } finally {
    if (processHandle.exitCode === null) {
      processHandle.kill("SIGKILL");
    }
  }
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createHarnessState() {
  return {
    scriptHitsByResourceKey: new Map(),
    scriptRequests: [],
    documentRequests: []
  };
}

async function startHarnessServer() {
  const state = createHarnessState();

  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = requestUrl.pathname;
    const resourceKey = requestUrl.searchParams.get("resourceKey") ?? "default";

    if (pathname === "/cache-page") {
      state.documentRequests.push({
        path: pathname,
        method: request.method ?? "GET",
        resourceKey,
        timestamp: new Date().toISOString()
      });

      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive"
      });
      response.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Phase 5.5 Cache Harness</title>
    <script defer src="/assets/cacheable.js?resourceKey=${encodeURIComponent(resourceKey)}"></script>
  </head>
  <body>
    <main id="resource-key" data-resource-key="${resourceKey}">
      Phase 5.5 cache harness ${resourceKey}
    </main>
  </body>
</html>`);
      return;
    }

    if (pathname === "/assets/cacheable.js") {
      const currentHits = state.scriptHitsByResourceKey.get(resourceKey) ?? 0;
      const nextHit = currentHits + 1;
      state.scriptHitsByResourceKey.set(resourceKey, nextHit);
      state.scriptRequests.push({
        path: pathname,
        method: request.method ?? "GET",
        resourceKey,
        hit: nextHit,
        timestamp: new Date().toISOString()
      });

      response.writeHead(200, {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": "public, max-age=600, immutable",
        etag: `"phase5-5-5-${resourceKey}-${nextHit}"`,
        connection: "keep-alive"
      });
      response.end(`window.__PHASE55_SCRIPT_HIT__ = ${nextHit};`);
      return;
    }

    if (pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }

    response.writeHead(404, {
      "content-type": "text/plain; charset=utf-8"
    });
    response.end("not-found");
  });

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to resolve harness server address.");
  }

  return {
    server,
    state,
    origin: `http://127.0.0.1:${address.port}`
  };
}

async function stopHarnessServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function getScriptHitCount(state, resourceKey) {
  return state.scriptHitsByResourceKey.get(resourceKey) ?? 0;
}

async function waitForScriptHitCount(state, resourceKey, expectedHitCount, timeoutMs = 5_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (getScriptHitCount(state, resourceKey) >= expectedHitCount) {
      return;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for resourceKey=${resourceKey} script hits >= ${expectedHitCount}. actual=${getScriptHitCount(
      state,
      resourceKey
    )}`
  );
}

async function assertScriptHitCountStable(state, resourceKey, expectedHitCount, settleMs) {
  await sleep(settleMs);
  const observed = getScriptHitCount(state, resourceKey);
  assertCondition(
    observed === expectedHitCount,
    `Expected stable script hits for ${resourceKey}. expected=${expectedHitCount} observed=${observed}`
  );
}

function buildCachePageUrl(origin, resourceKey) {
  return `${origin}/cache-page?resourceKey=${encodeURIComponent(resourceKey)}`;
}

async function main() {
  const contextCount = parseIntegerEnv("PHASE5_CONTEXT_COUNT", DEFAULT_CONTEXT_COUNT);
  if (contextCount < 2) {
    throw new Error(`PHASE5_CONTEXT_COUNT must be >= 2. Received: ${contextCount}`);
  }

  const ttlOverrideMs = parseIntegerEnv("PHASE5_HTTP_CACHE_TTL_MS", DEFAULT_TTL_OVERRIDE_MS);
  const remoteDebuggingPort = parseRemoteDebuggingPort();
  const versionEndpoint = `http://127.0.0.1:${remoteDebuggingPort}/json/version`;

  const electronHost = startElectronCdpHost(remoteDebuggingPort, contextCount);
  const harness = await startHarnessServer();

  let contextOneClient = null;
  let contextTwoClient = null;

  try {
    const wsEndpoint = await waitForWebSocketEndpoint(versionEndpoint, STARTUP_TIMEOUT_MS);
    const { connectToGhostTabCdp } = await import("../dist/index.js");

    contextOneClient = await connectToGhostTabCdp({
      endpointURL: wsEndpoint,
      targetUrlIncludes: "#ghost-context=ctx-1",
      connectTimeoutMs: STARTUP_TIMEOUT_MS
    });
    contextTwoClient = await connectToGhostTabCdp({
      endpointURL: wsEndpoint,
      targetUrlIncludes: "#ghost-context=ctx-2",
      connectTimeoutMs: STARTUP_TIMEOUT_MS
    });

    await contextOneClient.setHttpCachePolicy({ mode: "RESPECT_HEADERS" });
    await contextTwoClient.setHttpCachePolicy({ mode: "RESPECT_HEADERS" });

    const baselineResourceKey = "ctx1-repeat-cache";
    const baselinePageUrl = buildCachePageUrl(harness.origin, baselineResourceKey);
    await contextOneClient.navigate(baselinePageUrl);
    await waitForScriptHitCount(harness.state, baselineResourceKey, 1);
    const baselineHitsAfterFirstNav = getScriptHitCount(harness.state, baselineResourceKey);

    await contextOneClient.navigate(baselinePageUrl);
    await assertScriptHitCountStable(
      harness.state,
      baselineResourceKey,
      baselineHitsAfterFirstNav,
      CACHE_ASSERTION_SETTLE_MS
    );
    const baselineHitsAfterSecondNav = getScriptHitCount(harness.state, baselineResourceKey);
    assertCondition(
      baselineHitsAfterSecondNav === baselineHitsAfterFirstNav,
      `Expected repeat visit to reuse cache for ${baselineResourceKey}. first=${baselineHitsAfterFirstNav} second=${baselineHitsAfterSecondNav}`
    );

    await contextOneClient.setHttpCachePolicy({ mode: "FORCE_REFRESH" });
    const forceRefreshPolicy = contextOneClient.getHttpCachePolicy();
    assertCondition(
      forceRefreshPolicy.mode === "FORCE_REFRESH",
      `Expected context one cache mode FORCE_REFRESH, received ${forceRefreshPolicy.mode}`
    );

    const forceRefreshHitsBefore = getScriptHitCount(harness.state, baselineResourceKey);
    await contextOneClient.navigate(baselinePageUrl);
    await waitForScriptHitCount(harness.state, baselineResourceKey, forceRefreshHitsBefore + 1);
    const forceRefreshHitsAfterFirstNav = getScriptHitCount(harness.state, baselineResourceKey);

    await contextOneClient.navigate(baselinePageUrl);
    await waitForScriptHitCount(
      harness.state,
      baselineResourceKey,
      forceRefreshHitsAfterFirstNav + 1
    );
    const forceRefreshHitsAfterSecondNav = getScriptHitCount(harness.state, baselineResourceKey);
    assertCondition(
      forceRefreshHitsAfterSecondNav === forceRefreshHitsBefore + 2,
      `Expected FORCE_REFRESH to fetch on every navigation for ${baselineResourceKey}. before=${forceRefreshHitsBefore} after=${forceRefreshHitsAfterSecondNav}`
    );

    const ttlResourceKey = "ctx2-ttl-override";
    const ttlPageUrl = buildCachePageUrl(harness.origin, ttlResourceKey);
    await contextTwoClient.setHttpCachePolicy({
      mode: "OVERRIDE_TTL",
      ttlMs: ttlOverrideMs
    });
    const ttlPolicy = contextTwoClient.getHttpCachePolicy();
    assertCondition(ttlPolicy.mode === "OVERRIDE_TTL", `Expected OVERRIDE_TTL mode, received ${ttlPolicy.mode}`);
    assertCondition(
      ttlPolicy.ttlMs === ttlOverrideMs,
      `Expected OVERRIDE_TTL ttlMs=${ttlOverrideMs}, received ${String(ttlPolicy.ttlMs)}`
    );

    await contextTwoClient.navigate(ttlPageUrl);
    await waitForScriptHitCount(harness.state, ttlResourceKey, 1);
    const ttlHitsAfterFirstNav = getScriptHitCount(harness.state, ttlResourceKey);

    await contextTwoClient.navigate(ttlPageUrl);
    await assertScriptHitCountStable(
      harness.state,
      ttlResourceKey,
      ttlHitsAfterFirstNav,
      CACHE_ASSERTION_SETTLE_MS
    );
    const ttlHitsWithinWindow = getScriptHitCount(harness.state, ttlResourceKey);

    await sleep(ttlOverrideMs + 250);
    await contextTwoClient.navigate(ttlPageUrl);
    await waitForScriptHitCount(harness.state, ttlResourceKey, ttlHitsWithinWindow + 1);
    const ttlHitsAfterExpiry = getScriptHitCount(harness.state, ttlResourceKey);
    assertCondition(
      ttlHitsAfterExpiry === ttlHitsWithinWindow + 1,
      `Expected OVERRIDE_TTL to force refresh after expiry for ${ttlResourceKey}. within=${ttlHitsWithinWindow} afterExpiry=${ttlHitsAfterExpiry}`
    );

    const partitionResourceKey = "shared-partition-resource";
    const partitionPageUrl = buildCachePageUrl(harness.origin, partitionResourceKey);

    await contextOneClient.setHttpCachePolicy({ mode: "RESPECT_HEADERS" });
    await contextTwoClient.setHttpCachePolicy({ mode: "RESPECT_HEADERS" });

    await contextOneClient.navigate(partitionPageUrl);
    await waitForScriptHitCount(harness.state, partitionResourceKey, 1);
    const partitionHitsAfterContextOneFirstNav = getScriptHitCount(harness.state, partitionResourceKey);

    await contextOneClient.navigate(partitionPageUrl);
    await assertScriptHitCountStable(
      harness.state,
      partitionResourceKey,
      partitionHitsAfterContextOneFirstNav,
      CACHE_ASSERTION_SETTLE_MS
    );
    const partitionHitsAfterContextOneSecondNav = getScriptHitCount(
      harness.state,
      partitionResourceKey
    );

    await contextTwoClient.navigate(partitionPageUrl);
    await waitForScriptHitCount(
      harness.state,
      partitionResourceKey,
      partitionHitsAfterContextOneSecondNav + 1
    );
    const partitionHitsAfterContextTwoFirstNav = getScriptHitCount(harness.state, partitionResourceKey);

    await contextTwoClient.navigate(partitionPageUrl);
    await assertScriptHitCountStable(
      harness.state,
      partitionResourceKey,
      partitionHitsAfterContextTwoFirstNav,
      CACHE_ASSERTION_SETTLE_MS
    );
    const partitionHitsAfterContextTwoSecondNav = getScriptHitCount(
      harness.state,
      partitionResourceKey
    );

    assertCondition(
      partitionHitsAfterContextTwoFirstNav === partitionHitsAfterContextOneSecondNav + 1,
      `Expected second BrowserContext to miss first-context cache for ${partitionResourceKey}. ctx1=${partitionHitsAfterContextOneSecondNav} ctx2First=${partitionHitsAfterContextTwoFirstNav}`
    );
    assertCondition(
      partitionHitsAfterContextTwoSecondNav === partitionHitsAfterContextTwoFirstNav,
      `Expected context two repeat visit to use its own cache for ${partitionResourceKey}. first=${partitionHitsAfterContextTwoFirstNav} second=${partitionHitsAfterContextTwoSecondNav}`
    );

    const resultPayload = {
      ok: true,
      phase: MILESTONE,
      runConfig: {
        contextCount,
        ttlOverrideMs
      },
      policies: {
        contextOne: contextOneClient.getHttpCachePolicy(),
        contextTwo: contextTwoClient.getHttpCachePolicy()
      },
      scenarios: {
        repeatVisitUsesCache: {
          resourceKey: baselineResourceKey,
          firstNavigationHits: baselineHitsAfterFirstNav,
          secondNavigationHits: baselineHitsAfterSecondNav
        },
        forceRefreshAlwaysFetches: {
          resourceKey: baselineResourceKey,
          hitsBefore: forceRefreshHitsBefore,
          hitsAfterFirstForcedNavigation: forceRefreshHitsAfterFirstNav,
          hitsAfterSecondForcedNavigation: forceRefreshHitsAfterSecondNav
        },
        ttlOverrideFreshThenRefresh: {
          resourceKey: ttlResourceKey,
          ttlMs: ttlOverrideMs,
          hitsAfterFirstNavigation: ttlHitsAfterFirstNav,
          hitsWithinTtl: ttlHitsWithinWindow,
          hitsAfterTtlExpiry: ttlHitsAfterExpiry
        },
        crossContextPartitionIsolation: {
          resourceKey: partitionResourceKey,
          hitsAfterContextOneFirstNavigation: partitionHitsAfterContextOneFirstNav,
          hitsAfterContextOneSecondNavigation: partitionHitsAfterContextOneSecondNav,
          hitsAfterContextTwoFirstNavigation: partitionHitsAfterContextTwoFirstNav,
          hitsAfterContextTwoSecondNavigation: partitionHitsAfterContextTwoSecondNav
        }
      },
      harness: {
        origin: harness.origin,
        documentRequestCount: harness.state.documentRequests.length,
        scriptRequestCount: harness.state.scriptRequests.length,
        scriptRequests: harness.state.scriptRequests
      }
    };

    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(artifactPath, `${JSON.stringify(resultPayload, null, 2)}\n`);

    console.log(
      JSON.stringify(
        {
          ok: true,
          phase: MILESTONE,
          artifact: artifactPath,
          repeatVisitUsesCache: true,
          forceRefreshVerified: true,
          ttlOverrideVerified: true,
          partitionIsolationVerified: true
        },
        null,
        2
      )
    );
  } finally {
    const closers = [contextOneClient, contextTwoClient]
      .filter(Boolean)
      .map((client) =>
        client.close().catch(() => {
          // best-effort shutdown
        })
      );
    await Promise.allSettled(closers);
    await stopElectronCdpHost(electronHost);
    await stopHarnessServer(harness.server);
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        phase: MILESTONE,
        error: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    )
  );
  process.exit(1);
});
