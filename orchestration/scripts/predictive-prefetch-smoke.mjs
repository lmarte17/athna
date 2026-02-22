import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REMOTE_DEBUGGING_PORT = 9333;
const DEFAULT_RUN_COUNT = 4;
const DEFAULT_TRACE_SETTLE_MS = 80;
const TARGET_FIRST_REQUEST_DELAY_MS = 220;
const POLL_INTERVAL_MS = 100;
const STARTUP_TIMEOUT_MS = 20_000;
const MILESTONE = "5.3";
const MIN_EXPECTED_TTFB_REDUCTION_MS = 150;
const MAX_EXPECTED_TTFB_REDUCTION_MS = 300;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const artifactDirectory = path.join(repositoryRoot, "docs", "artifacts", "phase5", "phase5-5.3");
const artifactPath = path.join(artifactDirectory, "predictive-prefetch-result.json");

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

function startElectronCdpHost(remoteDebuggingPort) {
  const runHeadfulGhostTab = process.env.GHOST_HEADFUL === "true";
  const scriptName = runHeadfulGhostTab ? "cdp:host:headful" : "cdp:host";

  return spawn("npm", ["run", scriptName, "-w", "@ghost-browser/electron"], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      GHOST_REMOTE_DEBUGGING_PORT: String(remoteDebuggingPort)
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

function median(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

function createHarnessState() {
  return {
    nextSocketId: 0,
    socketInfoBySocket: new WeakMap(),
    delayedTargetRunIds: new Set(),
    requestLog: []
  };
}

function getDelayMsForTargetRequest({ state, runId }) {
  if (state.delayedTargetRunIds.has(runId)) {
    return 0;
  }

  state.delayedTargetRunIds.add(runId);
  return TARGET_FIRST_REQUEST_DELAY_MS;
}

async function startHarnessServer() {
  const state = createHarnessState();

  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = requestUrl.pathname;
    const runId = requestUrl.searchParams.get("run") ?? "unknown";
    const socket = request.socket;
    const socketInfo = state.socketInfoBySocket.get(socket);
    const socketId = socketInfo?.socketId ?? "untracked";

    if (socketInfo) {
      socketInfo.requestCount += 1;
    }

    state.requestLog.push({
      path: pathname,
      method: request.method ?? "GET",
      runId,
      socketId,
      timestamp: new Date().toISOString()
    });

    const respond = (delayMs, payload) => {
      setTimeout(() => {
        response.writeHead(payload.statusCode, payload.headers);
        response.end(payload.body);
      }, delayMs);
    };

    if (pathname === "/source") {
      respond(0, {
        statusCode: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive"
        },
        body: `<!doctype html>
<html>
  <head><title>Prefetch Source</title></head>
  <body>
    <a id="target-link" href="/target?run=${encodeURIComponent(runId)}">Open target</a>
  </body>
</html>`
      });
      return;
    }

    if (pathname === "/target") {
      const delayMs = getDelayMsForTargetRequest({ state, runId });
      respond(delayMs, {
        statusCode: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive"
        },
        body: `<!doctype html><html><body><h1>Target ${runId}</h1></body></html>`
      });
      return;
    }

    if (pathname === "/loop-source") {
      respond(0, {
        statusCode: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive"
        },
        body: `<!doctype html>
<html>
  <head><title>Loop Source</title></head>
  <body>
    <a id="loop-target-link" href="/loop-target?run=${encodeURIComponent(runId)}">Go Loop Target</a>
  </body>
</html>`
      });
      return;
    }

    if (pathname === "/loop-target") {
      respond(0, {
        statusCode: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive"
        },
        body: `<!doctype html><html><body><h1>Loop Target ${runId}</h1></body></html>`
      });
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

  server.on("connection", (socket) => {
    state.nextSocketId += 1;
    const socketId = `socket-${state.nextSocketId}`;
    const info = {
      socketId,
      requestCount: 0
    };
    state.socketInfoBySocket.set(socket, info);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve harness server address.");
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

function extractDocumentEntry(trace, targetUrl) {
  const normalizedTarget = new URL(targetUrl).toString();
  const exact = trace.entries.find((entry) => entry.resourceType === "Document" && entry.url === normalizedTarget);
  if (exact) {
    return exact;
  }

  const fallback = trace.entries.find((entry) => {
    if (entry.resourceType !== "Document") {
      return false;
    }

    return entry.url.startsWith(normalizedTarget);
  });

  return fallback ?? null;
}

async function measureNavigationTTFB({ cdpClient, url, traceSettleMs }) {
  const startedAtMs = Date.now();
  const traced = await cdpClient.traceNetworkConnections(async () => {
    await cdpClient.navigate(url);
  }, traceSettleMs);
  const finishedAtMs = Date.now();

  const documentEntry = extractDocumentEntry(traced.trace, url);
  assertCondition(Boolean(documentEntry), `Missing document trace entry for ${url}`);

  const documentTimestampMs = Date.parse(documentEntry.timestamp);
  const ttfbMs = Math.max(0, documentTimestampMs - startedAtMs);

  return {
    ttfbMs,
    navigationDurationMs: Math.max(0, finishedAtMs - startedAtMs),
    trace: traced.trace,
    documentEntry
  };
}

async function runBenchmarkScenario({ cdpClient, origin, runId, traceSettleMs, usePrefetch }) {
  const sourceUrl = `${origin}/source?run=${encodeURIComponent(runId)}`;
  const targetUrl = `${origin}/target?run=${encodeURIComponent(runId)}`;

  await cdpClient.navigate(sourceUrl);
  const urlBeforePrefetch = await cdpClient.getCurrentUrl();

  let prefetchResult = null;
  let urlAfterPrefetch = urlBeforePrefetch;
  if (usePrefetch) {
    prefetchResult = await cdpClient.prefetch(targetUrl);
    urlAfterPrefetch = await cdpClient.getCurrentUrl();
  }

  const navigation = await measureNavigationTTFB({
    cdpClient,
    url: targetUrl,
    traceSettleMs
  });

  return {
    runId,
    sourceUrl,
    targetUrl,
    usePrefetch,
    urlBeforePrefetch,
    urlAfterPrefetch,
    prefetchResult,
    ttfbMs: navigation.ttfbMs,
    navigationDurationMs: navigation.navigationDurationMs,
    trace: navigation.trace
  };
}

function pickLinkTarget(observation) {
  const candidates = Array.isArray(observation?.interactiveElementIndex)
    ? observation.interactiveElementIndex
    : [];

  const link = candidates.find((entry) => {
    return entry && entry.role === "link" && entry.boundingBox;
  });

  if (!link || !link.boundingBox) {
    return null;
  }

  return {
    x: Math.round(link.boundingBox.x + link.boundingBox.width / 2),
    y: Math.round(link.boundingBox.y + link.boundingBox.height / 2)
  };
}

async function runLoopPrefetchIntegrationCheck({ origin, cdpClient, createPerceptionActionLoop }) {
  const runId = `loop-${Date.now()}`;
  const startUrl = `${origin}/loop-source?run=${encodeURIComponent(runId)}`;
  const expectedTargetUrl = `${origin}/loop-target?run=${encodeURIComponent(runId)}`;

  const navigatorEngine = {
    async decideNextAction(input) {
      if (typeof input?.observation?.currentUrl === "string" && input.observation.currentUrl.includes("/loop-target")) {
        return {
          action: "DONE",
          target: null,
          text: "Reached loop target page.",
          confidence: 0.99,
          reasoning: "Target page reached."
        };
      }

      const target = pickLinkTarget(input?.observation);
      assertCondition(Boolean(target), "Unable to find loop link target for stub navigator.");
      return {
        action: "CLICK",
        target,
        text: "Click the loop target link",
        confidence: 0.93,
        reasoning: "Single visible loop target link"
      };
    }
  };

  const loop = createPerceptionActionLoop({
    cdpClient,
    navigatorEngine,
    maxSteps: 4,
    confidenceThreshold: 0.5,
    maxNoProgressSteps: 2
  });

  const result = await loop.runTask({
    intent: "open the loop target link",
    startUrl
  });

  assertCondition(result.status === "DONE", `Expected loop status DONE, got ${result.status}`);
  assertCondition(result.finalUrl.includes("/loop-target"), `Expected finalUrl to include /loop-target, got ${result.finalUrl}`);
  assertCondition(Array.isArray(result.prefetches) && result.prefetches.length > 0, "Expected prefetch events in loop result.");

  const clickPrefetch = result.prefetches.find((event) => event.action === "CLICK");
  assertCondition(Boolean(clickPrefetch), "Expected at least one CLICK prefetch event.");
  assertCondition(Boolean(clickPrefetch.prefetch), "Expected CLICK prefetch event to include prefetch result.");
  assertCondition(
    clickPrefetch.prefetch.status === "PREFETCHED" || clickPrefetch.prefetch.status === "FAILED",
    `Unexpected click prefetch status: ${String(clickPrefetch.prefetch.status)}`
  );
  if (clickPrefetch.prefetch.normalizedUrl) {
    assertCondition(
      clickPrefetch.prefetch.normalizedUrl.startsWith(expectedTargetUrl),
      `Expected prefetch target ${expectedTargetUrl}, got ${clickPrefetch.prefetch.normalizedUrl}`
    );
  }

  return {
    runId,
    startUrl,
    expectedTargetUrl,
    result
  };
}

async function main() {
  const runCount = parseIntegerEnv("PHASE5_PREFETCH_RUN_COUNT", DEFAULT_RUN_COUNT);
  const traceSettleMs = parseIntegerEnv("PHASE5_PREFETCH_TRACE_SETTLE_MS", DEFAULT_TRACE_SETTLE_MS);
  const remoteDebuggingPort = parseRemoteDebuggingPort();
  const versionEndpoint = `http://127.0.0.1:${remoteDebuggingPort}/json/version`;

  const electronHost = startElectronCdpHost(remoteDebuggingPort);
  const harness = await startHarnessServer();

  let cdpClient = null;

  try {
    const wsEndpoint = await waitForWebSocketEndpoint(versionEndpoint, STARTUP_TIMEOUT_MS);
    const { connectToGhostTabCdp, createPerceptionActionLoop } = await import("../dist/index.js");

    cdpClient = await connectToGhostTabCdp({ endpointURL: wsEndpoint });

    const baselineRuns = [];
    const prefetchedRuns = [];

    for (let index = 0; index < runCount; index += 1) {
      const baselineRun = await runBenchmarkScenario({
        cdpClient,
        origin: harness.origin,
        runId: `baseline-${index + 1}-${Date.now()}`,
        traceSettleMs,
        usePrefetch: false
      });
      baselineRuns.push(baselineRun);

      const prefetchedRun = await runBenchmarkScenario({
        cdpClient,
        origin: harness.origin,
        runId: `prefetch-${index + 1}-${Date.now()}`,
        traceSettleMs,
        usePrefetch: true
      });
      prefetchedRuns.push(prefetchedRun);
    }

    const baselineTtfbValues = baselineRuns.map((run) => run.ttfbMs);
    const prefetchedTtfbValues = prefetchedRuns.map((run) => run.ttfbMs);
    const baselineMedianTtfbMs = median(baselineTtfbValues);
    const prefetchedMedianTtfbMs = median(prefetchedTtfbValues);
    const observedMedianReductionMs = baselineMedianTtfbMs - prefetchedMedianTtfbMs;

    assertCondition(
      observedMedianReductionMs >= MIN_EXPECTED_TTFB_REDUCTION_MS,
      `Expected median TTFB reduction >= ${MIN_EXPECTED_TTFB_REDUCTION_MS}ms, got ${observedMedianReductionMs.toFixed(1)}ms`
    );
    assertCondition(
      observedMedianReductionMs <= MAX_EXPECTED_TTFB_REDUCTION_MS,
      `Expected median TTFB reduction <= ${MAX_EXPECTED_TTFB_REDUCTION_MS}ms, got ${observedMedianReductionMs.toFixed(1)}ms`
    );

    for (const run of prefetchedRuns) {
      assertCondition(Boolean(run.prefetchResult), `[${run.runId}] missing prefetch result.`);
      assertCondition(
        run.prefetchResult.status === "PREFETCHED",
        `[${run.runId}] expected prefetch status PREFETCHED, got ${run.prefetchResult.status}`
      );
      assertCondition(
        run.urlBeforePrefetch === run.urlAfterPrefetch,
        `[${run.runId}] prefetch changed URL unexpectedly: before=${run.urlBeforePrefetch} after=${run.urlAfterPrefetch}`
      );
    }

    const loopIntegration = await runLoopPrefetchIntegrationCheck({
      origin: harness.origin,
      cdpClient,
      createPerceptionActionLoop
    });

    const result = {
      ok: true,
      phase: MILESTONE,
      harnessOrigin: harness.origin,
      runCount,
      traceSettleMs,
      threshold: {
        minExpectedTtfbReductionMs: MIN_EXPECTED_TTFB_REDUCTION_MS,
        maxExpectedTtfbReductionMs: MAX_EXPECTED_TTFB_REDUCTION_MS,
        observedMedianReductionMs
      },
      baseline: {
        medianTtfbMs: baselineMedianTtfbMs,
        ttfbValuesMs: baselineTtfbValues,
        runs: baselineRuns
      },
      prefetched: {
        medianTtfbMs: prefetchedMedianTtfbMs,
        ttfbValuesMs: prefetchedTtfbValues,
        runs: prefetchedRuns
      },
      loopIntegration,
      requestLog: harness.state.requestLog,
      timestamp: new Date().toISOString()
    };

    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(artifactPath, `${JSON.stringify(result, null, 2)}\n`);

    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (cdpClient) {
      await cdpClient.close().catch(() => {});
    }

    await stopHarnessServer(harness.server).catch(() => {});
    await stopElectronCdpHost(electronHost);
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
