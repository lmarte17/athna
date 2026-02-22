import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REMOTE_DEBUGGING_PORT = 9333;
const POLL_INTERVAL_MS = 250;
const STARTUP_TIMEOUT_MS = 20_000;
const MILESTONE = "4.3";

if (!process.env.GHOST_HEADFUL) {
  process.env.GHOST_HEADFUL = process.env.GHOST_HEADLESS ?? "true";
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const artifactDirectory = path.join(repositoryRoot, "docs", "artifacts", "phase4", "phase4-4.3");
const scenarioArtifactsDirectory = path.join(artifactDirectory, "scenarios");
const artifactPath = path.join(artifactDirectory, "structured-error-objects-result.json");

const SCENARIOS = [
  {
    name: "http-404-structured",
    path: "/404",
    intent: "Load this page and summarize the most relevant details.",
    maxSteps: 4,
    maxNoProgressSteps: 1,
    expected: {
      source: "NAVIGATION",
      type: "NETWORK",
      status: 404,
      retryable: false
    }
  },
  {
    name: "http-503-retryable",
    path: "/503",
    intent: "Open the page and continue only if it is recoverable.",
    maxSteps: 4,
    maxNoProgressSteps: 1,
    expected: {
      source: "NAVIGATION",
      type: "NETWORK",
      status: 503,
      retryable: true
    }
  },
  {
    name: "runtime-eval-fault-structured",
    path: "/runtime-fault",
    intent: "Inspect this page and extract key details.",
    maxSteps: 4,
    maxNoProgressSteps: 1,
    expected: {
      source: "PERCEPTION",
      type: "RUNTIME",
      status: null,
      retryable: false
    }
  }
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
    if (requestUrl.startsWith("/404")) {
      response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      response.end("<html><body><h1>Not Found</h1><p>Synthetic 404 route.</p></body></html>");
      return;
    }

    if (requestUrl.startsWith("/503")) {
      response.writeHead(503, { "content-type": "text/html; charset=utf-8" });
      response.end("<html><body><h1>Service Unavailable</h1><p>Synthetic 503 route.</p></body></html>");
      return;
    }

    if (requestUrl.startsWith("/runtime-fault")) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html>
  <head><title>Runtime Fault Fixture</title></head>
  <body>
    <h1>Runtime Fault Fixture</h1>
    <p>This page intentionally breaks querySelectorAll for smoke validation.</p>
    <script>
      Document.prototype.querySelectorAll = function querySelectorAllBroken() {
        throw new Error("synthetic_query_selector_failure");
      };
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

function validateScenario(run) {
  const { scenario, result, onStructuredErrorEvents } = run;
  assertCondition(result && typeof result === "object", `[${scenario.name}] result missing.`);
  assertCondition(result.errorDetail && typeof result.errorDetail === "object", `[${scenario.name}] errorDetail missing.`);
  assertCondition(Array.isArray(result.structuredErrors), `[${scenario.name}] structuredErrors missing.`);
  assertCondition(result.structuredErrors.length > 0, `[${scenario.name}] expected structuredErrors events.`);

  const matchingEvent = result.structuredErrors.find((event) => {
    return (
      event.source === scenario.expected.source &&
      event.error &&
      event.error.type === scenario.expected.type &&
      event.error.retryable === scenario.expected.retryable &&
      event.error.status === scenario.expected.status
    );
  });

  assertCondition(
    Boolean(matchingEvent),
    `[${scenario.name}] missing expected structured error: ${JSON.stringify(scenario.expected)}`
  );
  assertCondition(
    matchingEvent.navigatorDecision && typeof matchingEvent.navigatorDecision === "object",
    `[${scenario.name}] expected navigatorDecision for structured error event.`
  );
  if (scenario.expected.retryable) {
    assertCondition(
      matchingEvent.navigatorDecision.action !== "FAILED",
      `[${scenario.name}] retryable structured error should not produce FAILED decision.`
    );
  }

  assertCondition(
    onStructuredErrorEvents.length === result.structuredErrors.length,
    `[${scenario.name}] callback event mismatch: callback=${onStructuredErrorEvents.length} result=${result.structuredErrors.length}`
  );

  assertCondition(
    result.tierUsage && result.tierUsage.tier2Calls === 0,
    `[${scenario.name}] tier2Calls should be 0 for structured error handling path.`
  );

  return {
    status: result.status,
    stepsTaken: result.stepsTaken,
    finalError: result.errorDetail,
    structuredErrorCount: result.structuredErrors.length,
    expectedMatch: {
      source: scenario.expected.source,
      type: scenario.expected.type,
      status: scenario.expected.status,
      retryable: scenario.expected.retryable
    },
    navigatorDecisionAction: matchingEvent.navigatorDecision.action,
    decisionSource: matchingEvent.decisionSource
  };
}

async function writeScenarioArtifact(name, payload) {
  await mkdir(scenarioArtifactsDirectory, { recursive: true });
  const scenarioArtifactPath = path.join(
    scenarioArtifactsDirectory,
    `${name}-structured-error-objects-result.json`
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
    const navigator = createNavigatorEngine();

    const scenarioRuns = [];
    for (const scenario of SCENARIOS) {
      const onStructuredErrorEvents = [];
      const loop = createPerceptionActionLoop({
        cdpClient,
        navigatorEngine: navigator,
        maxSteps: scenario.maxSteps,
        maxNoProgressSteps: scenario.maxNoProgressSteps,
        logger: (line) => console.info(`[${scenario.name}] ${line}`),
        onStructuredError: (event) => {
          onStructuredErrorEvents.push(event);
        }
      });

      const startUrl = `${localServer.baseUrl}${scenario.path}`;
      const result = await loop.runTask({
        intent: scenario.intent,
        startUrl,
        maxSteps: scenario.maxSteps,
        maxNoProgressSteps: scenario.maxNoProgressSteps
      });

      const summary = validateScenario({
        scenario,
        result,
        onStructuredErrorEvents
      });

      const scenarioPayload = {
        ...result,
        runConfig: {
          phase: MILESTONE,
          scenario,
          remoteDebuggingPort,
          headful: isHeadfulEnabled(),
          localServerPort: localServer.port
        },
        structuredErrorCallbackEvents: onStructuredErrorEvents,
        summary
      };
      const scenarioArtifact = await writeScenarioArtifact(scenario.name, scenarioPayload);
      scenarioRuns.push({
        name: scenario.name,
        status: result.status,
        stepsTaken: result.stepsTaken,
        summary,
        artifact: scenarioArtifact
      });
    }

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
        localServerPort: localServer.port
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
