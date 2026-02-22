import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REMOTE_DEBUGGING_PORT = 9333;
const DEFAULT_CONTEXT_COUNT = 2;
const DEFAULT_FETCH_ROUNDS = 6;
const DEFAULT_TRACE_SETTLE_MS = 150;
const POLL_INTERVAL_MS = 100;
const STARTUP_TIMEOUT_MS = 20_000;
const MILESTONE = "5.2";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const artifactDirectory = path.join(repositoryRoot, "docs", "artifacts", "phase5", "phase5-5.2");
const artifactPath = path.join(artifactDirectory, "connection-pool-isolation-result.json");

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
    nextSocketId: 0,
    socketInfoBySocket: new WeakMap(),
    requestLog: [],
    connectionLog: []
  };
}

async function startHarnessServer() {
  const state = createHarnessState();

  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const contextId = requestUrl.searchParams.get("contextId") ?? "unknown";
    const runId = requestUrl.searchParams.get("run") ?? "unknown";
    const socket = request.socket;

    const socketInfo = state.socketInfoBySocket.get(socket);
    const socketId = socketInfo?.socketId ?? "untracked";

    if (socketInfo) {
      socketInfo.requestCount += 1;
    }

    state.requestLog.push({
      contextId,
      runId,
      path: requestUrl.pathname,
      method: request.method ?? "GET",
      socketId,
      remoteAddress: socket.remoteAddress ?? null,
      remotePort: socket.remotePort ?? null,
      timestamp: new Date().toISOString()
    });

    if (requestUrl.pathname === "/connection-harness") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive"
      });
      response.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Phase 5.2 Connection Harness</title>
  </head>
  <body>
    <main id="context" data-context-id="${contextId}" data-run-id="${runId}">
      Phase 5.2 connection harness
    </main>
  </body>
</html>`);
      return;
    }

    if (requestUrl.pathname === "/probe") {
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive"
      });
      response.end(
        JSON.stringify({
          ok: true,
          contextId,
          runId,
          phase: requestUrl.searchParams.get("phase") ?? null,
          seq: requestUrl.searchParams.get("seq") ?? null,
          socketId
        })
      );
      return;
    }

    if (requestUrl.pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }

    response.writeHead(404, {
      "content-type": "text/plain; charset=utf-8",
      connection: "keep-alive"
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
      openedAt: new Date().toISOString(),
      closedAt: null,
      hadError: null,
      remoteAddress: socket.remoteAddress ?? null,
      remotePort: socket.remotePort ?? null,
      requestCount: 0
    };

    state.socketInfoBySocket.set(socket, info);
    state.connectionLog.push({
      event: "OPEN",
      socketId,
      timestamp: info.openedAt,
      remoteAddress: info.remoteAddress,
      remotePort: info.remotePort
    });

    socket.on("close", (hadError) => {
      info.closedAt = new Date().toISOString();
      info.hadError = hadError;
      state.connectionLog.push({
        event: "CLOSE",
        socketId,
        timestamp: info.closedAt,
        remoteAddress: info.remoteAddress,
        remotePort: info.remotePort,
        requestCount: info.requestCount,
        hadError
      });
    });
  });

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

async function evaluateExpression(cdpClient, expression) {
  const execution = await cdpClient.executeAction({
    action: "EXTRACT",
    target: null,
    text: expression
  });

  if (execution.status !== "acted") {
    throw new Error(`Expected EXTRACT action status=acted, got ${execution.status}`);
  }

  return execution.extractedData;
}

async function runFetchProbe({ cdpClient, origin, contextId, runId, phase, rounds }) {
  const expression = `(() => (async () => {
    const responses = [];
    for (let index = 1; index <= ${rounds}; index += 1) {
      const response = await fetch(
        ${JSON.stringify(origin)} + "/probe?contextId=" + encodeURIComponent(${JSON.stringify(
          contextId
        )}) +
          "&run=" + encodeURIComponent(${JSON.stringify(runId)}) +
          "&phase=" + encodeURIComponent(${JSON.stringify(phase)}) +
          "&seq=" + String(index),
        { cache: "no-store" }
      );
      responses.push({
        status: response.status,
        body: await response.text()
      });
    }

    return {
      count: responses.length,
      statuses: responses.map((entry) => entry.status),
      ok: responses.every((entry) => entry.status === 200)
    };
  })())();`;

  const result = await evaluateExpression(cdpClient, expression);
  return result;
}

async function runContextProbe({ lease, origin, rounds, traceSettleMs }) {
  const contextId = lease.contextId;
  const runId = `${contextId}-${Date.now()}`;

  const traced = await lease.cdpClient.traceNetworkConnections(
    async () => {
      await lease.cdpClient.navigate(
        `${origin}/connection-harness?contextId=${encodeURIComponent(contextId)}&run=${encodeURIComponent(runId)}&visit=1`
      );
      const phaseA = await runFetchProbe({
        cdpClient: lease.cdpClient,
        origin,
        contextId,
        runId,
        phase: "A",
        rounds
      });

      await lease.cdpClient.navigate(
        `${origin}/connection-harness?contextId=${encodeURIComponent(contextId)}&run=${encodeURIComponent(runId)}&visit=2`
      );
      const phaseB = await runFetchProbe({
        cdpClient: lease.cdpClient,
        origin,
        contextId,
        runId,
        phase: "B",
        rounds
      });

      return {
        phaseA,
        phaseB
      };
    },
    traceSettleMs
  );

  assertCondition(Boolean(traced.result.phaseA?.ok), `[${contextId}] phase A probe failed.`);
  assertCondition(Boolean(traced.result.phaseB?.ok), `[${contextId}] phase B probe failed.`);

  return {
    contextId,
    runId,
    fetchSummary: traced.result,
    cdpTrace: traced.trace
  };
}

function summarizeRequestsByContext(requestLog, contextIds) {
  const contextIdSet = new Set(contextIds);
  const byContext = {};

  for (const contextId of contextIds) {
    byContext[contextId] = {
      requestCount: 0,
      socketCounts: {},
      paths: {}
    };
  }

  for (const entry of requestLog) {
    if (!contextIdSet.has(entry.contextId)) {
      continue;
    }

    const bucket = byContext[entry.contextId];
    bucket.requestCount += 1;
    bucket.socketCounts[entry.socketId] = (bucket.socketCounts[entry.socketId] ?? 0) + 1;
    bucket.paths[entry.path] = (bucket.paths[entry.path] ?? 0) + 1;
  }

  return byContext;
}

function getSharedValues(valuesA, valuesB) {
  const setA = new Set(valuesA);
  const shared = [];
  for (const value of valuesB) {
    if (setA.has(value)) {
      shared.push(value);
    }
  }

  return [...new Set(shared)].sort();
}

async function main() {
  const contextCount = parseIntegerEnv("PHASE5_CONTEXT_COUNT", DEFAULT_CONTEXT_COUNT);
  const fetchRounds = parseIntegerEnv("PHASE5_CONNECTION_FETCH_ROUNDS", DEFAULT_FETCH_ROUNDS);
  const traceSettleMs = parseIntegerEnv("PHASE5_CONNECTION_TRACE_SETTLE_MS", DEFAULT_TRACE_SETTLE_MS);

  if (contextCount < 2) {
    throw new Error(`PHASE5_CONTEXT_COUNT must be >= 2. Received: ${contextCount}`);
  }

  const remoteDebuggingPort = parseRemoteDebuggingPort();
  const versionEndpoint = `http://127.0.0.1:${remoteDebuggingPort}/json/version`;
  const electronHost = startElectronCdpHost(remoteDebuggingPort, contextCount);
  const harness = await startHarnessServer();

  let pool = null;
  const leases = [];

  try {
    const wsEndpoint = await waitForWebSocketEndpoint(versionEndpoint, STARTUP_TIMEOUT_MS);
    const { createGhostTabPoolManager } = await import("../dist/index.js");

    pool = createGhostTabPoolManager({
      endpointURL: wsEndpoint,
      minSize: contextCount,
      maxSize: contextCount,
      connectTimeoutMs: STARTUP_TIMEOUT_MS,
      logger: (line) => console.info(`[connection-pool-smoke] ${line}`)
    });
    await pool.initialize();

    const leaseA = await pool.acquireGhostTab({ taskId: "phase5.2-context-a" });
    leases.push(leaseA);
    const leaseB = await pool.acquireGhostTab({ taskId: "phase5.2-context-b" });
    leases.push(leaseB);

    assertCondition(
      leaseA.contextId !== leaseB.contextId,
      `Expected distinct context ids, got ${leaseA.contextId}`
    );

    const probeA = await runContextProbe({
      lease: leaseA,
      origin: harness.origin,
      rounds: fetchRounds,
      traceSettleMs
    });
    const probeB = await runContextProbe({
      lease: leaseB,
      origin: harness.origin,
      rounds: fetchRounds,
      traceSettleMs
    });

    const requestSummary = summarizeRequestsByContext(harness.state.requestLog, [
      probeA.contextId,
      probeB.contextId
    ]);

    const socketsA = Object.keys(requestSummary[probeA.contextId].socketCounts).sort();
    const socketsB = Object.keys(requestSummary[probeB.contextId].socketCounts).sort();
    const sharedServerSockets = getSharedValues(socketsA, socketsB);

    const cdpConnectionIdsA = probeA.cdpTrace.uniqueConnectionIds;
    const cdpConnectionIdsB = probeB.cdpTrace.uniqueConnectionIds;
    const sharedCdpConnectionIds = getSharedValues(cdpConnectionIdsA, cdpConnectionIdsB);

    const reusedServerSocketByContext = {
      [probeA.contextId]: Object.values(requestSummary[probeA.contextId].socketCounts).some(
        (count) => count > 1
      ),
      [probeB.contextId]: Object.values(requestSummary[probeB.contextId].socketCounts).some(
        (count) => count > 1
      )
    };

    assertCondition(
      requestSummary[probeA.contextId].requestCount > 0,
      `[${probeA.contextId}] expected requests in harness log.`
    );
    assertCondition(
      requestSummary[probeB.contextId].requestCount > 0,
      `[${probeB.contextId}] expected requests in harness log.`
    );
    assertCondition(
      sharedServerSockets.length === 0,
      `Expected zero shared TCP sockets across contexts. shared=${JSON.stringify(sharedServerSockets)}`
    );
    assertCondition(
      reusedServerSocketByContext[probeA.contextId] || reusedServerSocketByContext[probeB.contextId],
      "Expected at least one context to reuse a keep-alive socket within its own connection pool."
    );
    assertCondition(
      probeA.cdpTrace.entries.length > 0 && probeB.cdpTrace.entries.length > 0,
      "Expected non-empty CDP network traces for both contexts."
    );

    await Promise.allSettled(
      leases.map((lease) => {
        return lease.release();
      })
    );
    leases.length = 0;

    const finalPoolSnapshot = pool.getSnapshot();
    assertCondition(
      finalPoolSnapshot.inUse === 0,
      `Expected final pool snapshot to have no in-use contexts. actual=${finalPoolSnapshot.inUse}`
    );

    const result = {
      ok: true,
      phase: MILESTONE,
      runConfig: {
        contextCount,
        fetchRounds,
        traceSettleMs
      },
      harnessOrigin: harness.origin,
      contextProbes: [probeA, probeB],
      requestSummary,
      analysis: {
        sharedServerSockets,
        reusedServerSocketByContext,
        sharedCdpConnectionIds,
        cdpUniqueConnectionIdsByContext: {
          [probeA.contextId]: cdpConnectionIdsA,
          [probeB.contextId]: cdpConnectionIdsB
        }
      },
      poolSnapshotAfterRun: finalPoolSnapshot,
      poolTelemetry: pool.getTelemetry(),
      connectionLog: harness.state.connectionLog,
      timestamp: new Date().toISOString()
    };

    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(artifactPath, `${JSON.stringify(result, null, 2)}\n`);

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await Promise.allSettled(
      leases.map((lease) => {
        return lease.release();
      })
    );

    if (pool) {
      await pool.shutdown().catch(() => {});
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
