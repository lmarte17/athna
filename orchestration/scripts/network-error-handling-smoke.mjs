import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REMOTE_DEBUGGING_PORT = 9333;
const POLL_INTERVAL_MS = 100;
const STARTUP_TIMEOUT_MS = 20_000;
const MILESTONE = "5.4";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const artifactDirectory = path.join(repositoryRoot, "docs", "artifacts", "phase5", "phase5-5.4");
const scenarioArtifactsDirectory = path.join(artifactDirectory, "scenarios");
const artifactPath = path.join(artifactDirectory, "network-error-handling-result.json");

const SCENARIOS = [
  {
    name: "dns-failure",
    intent: "Open the page and recover only if the failure is retryable.",
    kind: "DNS_FAILURE",
    expected: {
      source: "NAVIGATION",
      type: "NETWORK",
      status: null,
      retryable: true,
      errorType: "DNS_FAILURE"
    }
  },
  {
    name: "http-503",
    intent: "Open the page and recover only if the failure is retryable.",
    kind: "HTTP_503",
    expected: {
      source: "NAVIGATION",
      type: "NETWORK",
      status: 503,
      retryable: true,
      errorType: "HTTP_5XX"
    }
  }
];

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

async function startHarnessServer() {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = requestUrl.pathname;

    if (pathname === "/503") {
      response.writeHead(503, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store"
      });
      response.end("<!doctype html><html><body><h1>Service Unavailable</h1></body></html>");
      return;
    }

    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    });
    response.end("<!doctype html><html><body><h1>OK</h1></body></html>");
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
    origin: `http://127.0.0.1:${address.port}`,
    port: address.port
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

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildScenarioStartUrl(scenario, harnessOrigin) {
  if (scenario.kind === "HTTP_503") {
    return `${harnessOrigin}/503?run=${encodeURIComponent(`${scenario.name}-${Date.now()}`)}`;
  }

  if (scenario.kind === "DNS_FAILURE") {
    return `http://phase5-5-4-${Date.now()}.invalid/`;
  }

  throw new Error(`Unsupported scenario kind: ${String(scenario.kind)}`);
}

function createStubNavigator(navigatorCalls) {
  return {
    async decideNextAction(input) {
      const structuredError = input?.observation?.structuredError ?? null;
      navigatorCalls.push({
        timestamp: new Date().toISOString(),
        tier: input?.tier ?? "TIER_1_AX",
        hasScreenshot: Boolean(input?.observation?.screenshot),
        structuredError
      });

      if (structuredError && structuredError.retryable) {
        return {
          action: "WAIT",
          target: null,
          text: "1000",
          confidence: 0.82,
          reasoning: "Structured network error is retryable; prefer short wait/retry."
        };
      }

      return {
        action: "FAILED",
        target: null,
        text: "Navigation failed and is not retryable.",
        confidence: 0.95,
        reasoning: "Structured error is non-retryable."
      };
    }
  };
}

async function writeScenarioArtifact(name, payload) {
  await mkdir(scenarioArtifactsDirectory, { recursive: true });
  const scenarioArtifactPath = path.join(
    scenarioArtifactsDirectory,
    `${name}-network-error-handling-result.json`
  );
  await writeFile(scenarioArtifactPath, `${JSON.stringify(payload, null, 2)}\n`);
  return scenarioArtifactPath;
}

function validateScenario(run) {
  const { scenario, result, onStructuredErrorEvents, navigatorCalls } = run;
  assertCondition(result && typeof result === "object", `[${scenario.name}] loop result missing.`);
  assertCondition(result.errorDetail && typeof result.errorDetail === "object", `[${scenario.name}] errorDetail missing.`);
  assertCondition(result.errorDetail.type === scenario.expected.type, `[${scenario.name}] errorDetail.type mismatch.`);
  assertCondition(result.errorDetail.status === scenario.expected.status, `[${scenario.name}] errorDetail.status mismatch.`);
  assertCondition(result.errorDetail.retryable === scenario.expected.retryable, `[${scenario.name}] errorDetail.retryable mismatch.`);
  assertCondition(result.errorDetail.errorType === scenario.expected.errorType, `[${scenario.name}] errorDetail.errorType mismatch.`);

  assertCondition(Array.isArray(result.structuredErrors), `[${scenario.name}] structuredErrors missing.`);
  assertCondition(result.structuredErrors.length > 0, `[${scenario.name}] structuredErrors should not be empty.`);
  assertCondition(
    Array.isArray(onStructuredErrorEvents) && onStructuredErrorEvents.length === result.structuredErrors.length,
    `[${scenario.name}] callback structuredErrors count mismatch.`
  );

  const matchedEvent = result.structuredErrors.find((event) => {
    return (
      event.source === scenario.expected.source &&
      event.error &&
      event.error.type === scenario.expected.type &&
      event.error.status === scenario.expected.status &&
      event.error.retryable === scenario.expected.retryable &&
      event.error.errorType === scenario.expected.errorType
    );
  });

  assertCondition(
    Boolean(matchedEvent),
    `[${scenario.name}] missing expected structured error event ${JSON.stringify(scenario.expected)}`
  );
  assertCondition(
    matchedEvent.navigatorDecision && typeof matchedEvent.navigatorDecision === "object",
    `[${scenario.name}] expected navigatorDecision on matched structured error event.`
  );

  assertCondition(
    result.tierUsage && result.tierUsage.tier2Calls === 0,
    `[${scenario.name}] tier2Calls should remain 0 to avoid error-page screenshot routing.`
  );
  assertCondition(
    Array.isArray(result.history) && result.history.length === 0,
    `[${scenario.name}] expected no action history entries for navigation-level network error.`
  );
  assertCondition(
    Array.isArray(navigatorCalls) && navigatorCalls.length > 0,
    `[${scenario.name}] navigator should receive structured error routing calls.`
  );
  assertCondition(
    navigatorCalls.every((call) => call.hasScreenshot === false),
    `[${scenario.name}] navigator unexpectedly received screenshot payload during network-error routing.`
  );
  assertCondition(
    navigatorCalls.some(
      (call) =>
        call.structuredError &&
        call.structuredError.type === scenario.expected.type &&
        call.structuredError.errorType === scenario.expected.errorType
    ),
    `[${scenario.name}] navigator calls missing expected structuredError.errorType=${scenario.expected.errorType}.`
  );

  return {
    status: result.status,
    stepsTaken: result.stepsTaken,
    finalUrl: result.finalUrl,
    finalError: result.errorDetail,
    structuredErrorCount: result.structuredErrors.length,
    matchedEvent: {
      source: matchedEvent.source,
      error: matchedEvent.error,
      decisionSource: matchedEvent.decisionSource,
      decisionAction: matchedEvent.navigatorDecision.action
    },
    navigatorCallCount: navigatorCalls.length
  };
}

async function main() {
  const remoteDebuggingPort = parseRemoteDebuggingPort();
  const versionEndpoint = `http://127.0.0.1:${remoteDebuggingPort}/json/version`;

  const electronHost = startElectronCdpHost(remoteDebuggingPort);
  const harness = await startHarnessServer();
  let cdpClient = null;

  try {
    const wsEndpoint = await waitForWebSocketEndpoint(versionEndpoint, STARTUP_TIMEOUT_MS);
    const { connectToGhostTabCdp, createPerceptionActionLoop } = await import("../dist/index.js");
    cdpClient = await connectToGhostTabCdp({ endpointURL: wsEndpoint });

    const scenarioRuns = [];

    for (const scenario of SCENARIOS) {
      const startUrl = buildScenarioStartUrl(scenario, harness.origin);
      const onStructuredErrorEvents = [];
      const navigatorCalls = [];
      const loop = createPerceptionActionLoop({
        cdpClient,
        navigatorEngine: createStubNavigator(navigatorCalls),
        maxSteps: 3,
        maxNoProgressSteps: 1,
        logger: (line) => console.info(`[${scenario.name}] ${line}`),
        onStructuredError: (event) => {
          onStructuredErrorEvents.push(event);
        }
      });

      const result = await loop.runTask({
        intent: scenario.intent,
        startUrl,
        maxSteps: 3,
        maxNoProgressSteps: 1,
        navigationTimeoutMs: 12_000
      });

      const summary = validateScenario({
        scenario,
        result,
        onStructuredErrorEvents,
        navigatorCalls
      });

      const scenarioPayload = {
        ...result,
        runConfig: {
          phase: MILESTONE,
          scenario,
          startUrl,
          remoteDebuggingPort,
          harnessPort: harness.port
        },
        structuredErrorCallbackEvents: onStructuredErrorEvents,
        navigatorCalls,
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
        harnessPort: harness.port
      },
      timestamp: new Date().toISOString()
    };

    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(artifactPath, `${JSON.stringify(payload, null, 2)}\n`);
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
  process.exitCode = 1;
});
