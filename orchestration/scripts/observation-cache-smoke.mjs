import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REMOTE_DEBUGGING_PORT = 9333;
const POLL_INTERVAL_MS = 250;
const STARTUP_TIMEOUT_MS = 20_000;
const MILESTONE = "4.4";
const DEFAULT_OBSERVATION_CACHE_TTL_MS = 60_000;
const STABLE_FIXTURE_PATH = "/cache-flow";

if (!process.env.GHOST_HEADFUL) {
  process.env.GHOST_HEADFUL = process.env.GHOST_HEADLESS ?? "true";
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const artifactDirectory = path.join(repositoryRoot, "docs", "artifacts", "phase4", "phase4-4.4");
const scenarioArtifactsDirectory = path.join(artifactDirectory, "scenarios");
const artifactPath = path.join(artifactDirectory, "observation-cache-result.json");

const CACHE_REUSE_INTENT_CANDIDATES = [
  "Click the Continue button three times before finishing the task.",
  "Use the page controls by clicking Continue and Submit repeatedly, then stop only after multiple actions.",
  "Focus the email field and click Continue at least twice before ending."
];

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseRemoteDebuggingPort() {
  const rawValue = process.env.GHOST_REMOTE_DEBUGGING_PORT;
  const parsedPort = Number.parseInt(rawValue ?? String(DEFAULT_REMOTE_DEBUGGING_PORT), 10);

  if (Number.isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new Error(`Invalid GHOST_REMOTE_DEBUGGING_PORT: ${String(rawValue)}`);
  }

  return parsedPort;
}

function parseBooleanLike(rawValue, defaultValue) {
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return defaultValue;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function isHeadfulEnabled() {
  return parseBooleanLike(process.env.GHOST_HEADFUL, true);
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
  const runHeadfulGhostTab = isHeadfulEnabled();
  const scriptName = runHeadfulGhostTab ? "cdp:host:headful" : "cdp:host";

  return spawn("npm", ["run", scriptName, "-w", "@ghost-browser/electron"], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      GHOST_REMOTE_DEBUGGING_PORT: String(remoteDebuggingPort),
      GHOST_HEADFUL: String(runHeadfulGhostTab)
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

async function startLocalScenarioServer() {
  const server = createServer((request, response) => {
    const requestUrl = request.url || "/";
    if (requestUrl.startsWith(STABLE_FIXTURE_PATH)) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Observation Cache Fixture</title>
  </head>
  <body>
    <main>
      <h1>Observation Cache Fixture</h1>
      <p>This form fixture intentionally avoids navigation and significant DOM mutation.</p>
      <label for="email">Email</label>
      <input id="email" aria-label="Email address" name="email" type="email" />
      <button id="continue-btn" type="button">Continue</button>
      <button id="submit-btn" type="button">Submit</button>
    </main>
    <script>
      const prevent = (event) => event.preventDefault();
      document.getElementById("continue-btn").addEventListener("click", prevent);
      document.getElementById("submit-btn").addEventListener("click", prevent);
    </script>
  </body>
</html>`);
      return;
    }

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<html><body><h1>OK</h1></body></html>");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve local scenario server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    server,
    port: address.port,
    baseUrl
  };
}

async function stopLocalScenarioServer(server) {
  await new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function countHistoryHits(history, field) {
  return history.filter((record) => record && record[field] === true).length;
}

function summarizeCacheReuseWithinTask(input) {
  const { result, navigatorCallCount, intent } = input;
  assertCondition(result && typeof result === "object", "within-task-cache-reuse result missing.");
  assertCondition(Array.isArray(result.history), "within-task-cache-reuse history missing.");
  assertCondition(result.history.length >= 2, "within-task-cache-reuse expected at least 2 steps.");
  assertCondition(
    result.observationCache && typeof result.observationCache === "object",
    "within-task-cache-reuse observationCache metrics missing."
  );
  assertCondition(
    result.observationCache.ttlMs === DEFAULT_OBSERVATION_CACHE_TTL_MS,
    `within-task-cache-reuse expected ttlMs=${DEFAULT_OBSERVATION_CACHE_TTL_MS}, got=${String(result.observationCache.ttlMs)}`
  );

  const perceptionCacheHits = countHistoryHits(result.history, "observationCachePerceptionHit");
  const decisionCacheHits = countHistoryHits(result.history, "observationCacheDecisionHit");
  const screenshotCacheHits = countHistoryHits(result.history, "observationCacheScreenshotHit");
  const cacheReuseWithoutRefetch = result.history.filter(
    (record) => record.observationCachePerceptionHit === true && record.axTreeRefetched === false
  ).length;

  assertCondition(
    result.history[0].observationCachePerceptionHit === false,
    "within-task-cache-reuse first step should be a perception cache miss."
  );
  assertCondition(
    perceptionCacheHits > 0,
    "within-task-cache-reuse expected at least one perception cache hit."
  );
  assertCondition(
    decisionCacheHits > 0,
    "within-task-cache-reuse expected at least one decision cache hit (no re-inference)."
  );
  assertCondition(
    cacheReuseWithoutRefetch > 0,
    "within-task-cache-reuse expected cache hit with axTreeRefetched=false."
  );
  assertCondition(
    navigatorCallCount < result.history.length,
    `within-task-cache-reuse expected navigator calls (${navigatorCallCount}) < steps (${result.history.length}).`
  );

  return {
    intent,
    status: result.status,
    stepsTaken: result.stepsTaken,
    navigatorCallCount,
    perceptionCacheHits,
    decisionCacheHits,
    screenshotCacheHits,
    cacheReuseWithoutRefetch,
    observationCacheMetrics: result.observationCache
  };
}

function summarizeCacheResetBetweenTasks(input) {
  const { result, navigatorCallCount, intent } = input;
  assertCondition(result && typeof result === "object", "task-session-cache-reset result missing.");
  assertCondition(Array.isArray(result.history) && result.history.length > 0, "task-session-cache-reset history missing.");
  assertCondition(
    result.observationCache && typeof result.observationCache === "object",
    "task-session-cache-reset observationCache metrics missing."
  );

  const firstStep = result.history[0];
  assertCondition(
    firstStep.observationCachePerceptionHit === false,
    "task-session-cache-reset first step must be a perception cache miss for a new task session."
  );
  assertCondition(
    firstStep.observationCacheDecisionHit === false,
    "task-session-cache-reset first step must be a decision cache miss for a new task session."
  );
  assertCondition(
    navigatorCallCount >= 1,
    "task-session-cache-reset expected at least one navigator inference call."
  );

  return {
    intent,
    status: result.status,
    stepsTaken: result.stepsTaken,
    navigatorCallCount,
    firstStepPerceptionCacheHit: firstStep.observationCachePerceptionHit,
    firstStepDecisionCacheHit: firstStep.observationCacheDecisionHit,
    observationCacheMetrics: result.observationCache
  };
}

async function writeScenarioArtifact(name, payload) {
  await mkdir(scenarioArtifactsDirectory, { recursive: true });
  const scenarioArtifactPath = path.join(
    scenarioArtifactsDirectory,
    `${name}-observation-cache-result.json`
  );
  await writeFile(scenarioArtifactPath, JSON.stringify(payload, null, 2));
  return scenarioArtifactPath;
}

async function main() {
  const remoteDebuggingPort = parseRemoteDebuggingPort();
  const versionEndpoint = `http://127.0.0.1:${remoteDebuggingPort}/json/version`;
  const electronHost = startElectronCdpHost(remoteDebuggingPort);
  const localServer = await startLocalScenarioServer();

  let cdpClient = null;

  try {
    const wsEndpoint = await waitForWebSocketEndpoint(versionEndpoint, STARTUP_TIMEOUT_MS);
    const { connectToGhostTabCdp, createNavigatorEngine, createPerceptionActionLoop } =
      await import("../dist/index.js");

    cdpClient = await connectToGhostTabCdp({ endpointURL: wsEndpoint });
    const baseNavigator = createNavigatorEngine();
    let totalNavigatorCalls = 0;
    const recordingNavigator = {
      async decideNextAction(input) {
        totalNavigatorCalls += 1;
        return baseNavigator.decideNextAction(input);
      }
    };

    const loop = createPerceptionActionLoop({
      cdpClient,
      navigatorEngine: recordingNavigator,
      maxSteps: 8,
      maxNoProgressSteps: 8,
      logger: (line) => console.info(`[observation-cache] ${line}`)
    });

    const startUrl = `${localServer.baseUrl}${STABLE_FIXTURE_PATH}`;
    const attemptRuns = [];
    let selectedReuseRun = null;

    for (const intent of CACHE_REUSE_INTENT_CANDIDATES) {
      const callsBeforeAttempt = totalNavigatorCalls;
      const result = await loop.runTask({
        intent,
        startUrl,
        maxSteps: 6,
        maxNoProgressSteps: 8,
        observationCacheTtlMs: DEFAULT_OBSERVATION_CACHE_TTL_MS
      });
      const navigatorCallCount = totalNavigatorCalls - callsBeforeAttempt;

      try {
        const summary = summarizeCacheReuseWithinTask({
          result,
          navigatorCallCount,
          intent
        });
        selectedReuseRun = {
          intent,
          result,
          navigatorCallCount,
          summary
        };
        attemptRuns.push({
          intent,
          status: "passed",
          navigatorCallCount,
          stepsTaken: result.stepsTaken,
          summary
        });
        break;
      } catch (error) {
        attemptRuns.push({
          intent,
          status: "failed",
          navigatorCallCount,
          stepsTaken: result.stepsTaken,
          failure: error instanceof Error ? error.message : String(error)
        });
      }
    }

    assertCondition(
      selectedReuseRun !== null,
      `Unable to satisfy within-task cache reuse assertions. Attempts: ${JSON.stringify(attemptRuns)}`
    );

    const withinTaskScenarioPayload = {
      ...selectedReuseRun.result,
      runConfig: {
        phase: MILESTONE,
        scenario: "within-task-cache-reuse",
        startUrl,
        remoteDebuggingPort,
        headful: isHeadfulEnabled(),
        localServerPort: localServer.port,
        intentCandidates: CACHE_REUSE_INTENT_CANDIDATES,
        selectedIntent: selectedReuseRun.intent,
        observationCacheTtlMs: DEFAULT_OBSERVATION_CACHE_TTL_MS
      },
      navigatorCallCount: selectedReuseRun.navigatorCallCount,
      cacheReuseAttemptRuns: attemptRuns,
      summary: selectedReuseRun.summary
    };

    const withinTaskArtifact = await writeScenarioArtifact(
      "within-task-cache-reuse",
      withinTaskScenarioPayload
    );

    const callsBeforeTaskSessionReset = totalNavigatorCalls;
    const taskSessionResetResult = await loop.runTask({
      intent: selectedReuseRun.intent,
      startUrl,
      maxSteps: 3,
      maxNoProgressSteps: 5,
      observationCacheTtlMs: DEFAULT_OBSERVATION_CACHE_TTL_MS
    });
    const taskSessionResetNavigatorCalls = totalNavigatorCalls - callsBeforeTaskSessionReset;
    const taskSessionResetSummary = summarizeCacheResetBetweenTasks({
      result: taskSessionResetResult,
      navigatorCallCount: taskSessionResetNavigatorCalls,
      intent: selectedReuseRun.intent
    });

    const taskSessionResetPayload = {
      ...taskSessionResetResult,
      runConfig: {
        phase: MILESTONE,
        scenario: "task-session-cache-reset",
        startUrl,
        remoteDebuggingPort,
        headful: isHeadfulEnabled(),
        localServerPort: localServer.port,
        selectedIntent: selectedReuseRun.intent,
        observationCacheTtlMs: DEFAULT_OBSERVATION_CACHE_TTL_MS
      },
      navigatorCallCount: taskSessionResetNavigatorCalls,
      summary: taskSessionResetSummary
    };
    const taskSessionResetArtifact = await writeScenarioArtifact(
      "task-session-cache-reset",
      taskSessionResetPayload
    );

    const scenarioRuns = [
      {
        name: "within-task-cache-reuse",
        status: selectedReuseRun.result.status,
        stepsTaken: selectedReuseRun.result.stepsTaken,
        summary: selectedReuseRun.summary,
        artifact: withinTaskArtifact
      },
      {
        name: "task-session-cache-reset",
        status: taskSessionResetResult.status,
        stepsTaken: taskSessionResetResult.stepsTaken,
        summary: taskSessionResetSummary,
        artifact: taskSessionResetArtifact
      }
    ];

    const payload = {
      ok: true,
      phase: MILESTONE,
      summary: {
        scenarioCount: scenarioRuns.length,
        scenarios: scenarioRuns
      },
      runConfig: {
        remoteDebuggingPort,
        headful: isHeadfulEnabled(),
        localServerPort: localServer.port,
        startUrl,
        selectedIntent: selectedReuseRun.intent,
        observationCacheTtlMs: DEFAULT_OBSERVATION_CACHE_TTL_MS
      }
    };

    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(artifactPath, JSON.stringify(payload, null, 2));
    console.log(
      JSON.stringify(
        {
          ok: true,
          phase: MILESTONE,
          artifact: artifactPath,
          scenarioCount: scenarioRuns.length
        },
        null,
        2
      )
    );
  } finally {
    if (cdpClient) {
      await cdpClient.close().catch(() => {});
    }

    await stopElectronCdpHost(electronHost);
    await stopLocalScenarioServer(localServer.server);
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
  process.exitCode = 1;
});
