import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REMOTE_DEBUGGING_PORT = 9333;
const POLL_INTERVAL_MS = 250;
const STARTUP_TIMEOUT_MS = 20_000;
const MILESTONE = "5.1";

if (!process.env.GHOST_HEADFUL) {
  process.env.GHOST_HEADFUL = "true";
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const artifactDirectory = path.join(repositoryRoot, "docs", "artifacts", "phase5", "phase5-5.1");
const scenarioArtifactsDirectory = path.join(artifactDirectory, "scenarios");
const artifactPath = path.join(artifactDirectory, "decision-routing-result.json");

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
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");

    if (requestUrl.pathname === "/enter-required") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Enter Required Search</title>
  </head>
  <body>
    <main>
      <h1>Enter Required Search</h1>
      <p>Typing alone does not submit. Enter is required.</p>
      <form id="search-form" action="/enter-required/results" method="get">
        <label for="query">Query</label>
        <input id="query" name="q" type="search" autocomplete="off" />
      </form>
    </main>
    <script>
      const input = document.getElementById("query");
      input?.focus();
      input?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
          return;
        }
        event.preventDefault();
        const query = encodeURIComponent(input.value || "");
        window.location.assign("/enter-required/results?q=" + query);
      });
    </script>
  </body>
</html>`);
      return;
    }

    if (requestUrl.pathname === "/enter-required/results") {
      const query = requestUrl.searchParams.get("q") || "";
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Search Results</title>
  </head>
  <body>
    <main>
      <h1 id="result-title">Results for: ${escapeHtml(query)}</h1>
    </main>
  </body>
</html>`);
      return;
    }

    if (requestUrl.pathname === "/noop-button") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>No-Op Button Fixture</title>
  </head>
  <body>
    <main>
      <h1>No-Op Button Fixture</h1>
      <button id="noop-button" type="button">Click me (no-op)</button>
    </main>
    <script>
      const button = document.getElementById("noop-button");
      button?.addEventListener("click", (event) => {
        event.preventDefault();
      });
    </script>
  </body>
</html>`);
      return;
    }

    if (requestUrl.pathname === "/visible-answer") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Visible Answer Fixture</title>
  </head>
  <body>
    <main>
      <h1>Support Code</h1>
      <p id="support-code">The support code is 8491.</p>
    </main>
  </body>
</html>`);
      return;
    }

    if (requestUrl.pathname === "/computer-use-link") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Computer Use Link Fixture</title>
  </head>
  <body>
    <main>
      <h1>Computer Use Link Fixture</h1>
      <p>Click the continue link to finish.</p>
      <a id="continue-link" href="/computer-use/success" style="display:block;padding:24px 16px;border:2px solid #333;max-width:420px;">
        Continue to Success
      </a>
    </main>
    <script>
      document.body.addEventListener("click", (event) => {
        event.preventDefault();
        window.location.assign("/computer-use/success");
      });
    </script>
  </body>
</html>`);
      return;
    }

    if (requestUrl.pathname === "/computer-use/success") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Computer Use Success</title>
  </head>
  <body>
    <main>
      <h1>Success</h1>
      <p id="done-message">Computer use fallback reached the target page.</p>
    </main>
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

function getTargetFromObservation(observation, matcher) {
  if (!observation || !Array.isArray(observation.interactiveElementIndex)) {
    return null;
  }

  const entry = observation.interactiveElementIndex.find((candidate) => matcher(candidate));
  const box = entry?.boundingBox;
  if (!box) {
    return null;
  }

  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  };
}

function createEnterFallbackNavigator() {
  let callCount = 0;
  return {
    async decideNextAction(input) {
      callCount += 1;

      if (callCount === 1) {
        const target = getTargetFromObservation(input.observation, (candidate) => {
          const role = String(candidate?.role || "").toLowerCase();
          const name = String(candidate?.name || "").toLowerCase();
          return role === "searchbox" || role === "textbox" || name.includes("query");
        });
        if (!target) {
          throw new Error("enter-required fixture: unable to resolve query input target.");
        }
        return {
          action: "CLICK",
          target,
          text: null,
          key: null,
          confidence: 0.95,
          reasoning: "Focus the search field before typing."
        };
      }

      if (callCount === 2) {
        return {
          action: "TYPE",
          target: null,
          text: "athna reliability routing",
          key: null,
          confidence: 0.95,
          reasoning: "Type the query without embedding Enter in text."
        };
      }

      return {
        action: "DONE",
        target: null,
        text: "enter fixture complete",
        key: null,
        confidence: 1,
        reasoning: "Stop once Enter fallback has been exercised."
      };
    }
  };
}

function createRepeatedNoopClickNavigator() {
  return {
    async decideNextAction(input) {
      const target = getTargetFromObservation(input.observation, (candidate) => {
        const role = String(candidate?.role || "").toLowerCase();
        const name = String(candidate?.name || "").toLowerCase();
        return role === "button" || name.includes("click me");
      });
      if (!target) {
        throw new Error("noop fixture: unable to resolve no-op button target.");
      }

      return {
        action: "CLICK",
        target,
        text: null,
        key: null,
        confidence: 0.9,
        reasoning: "Repeatedly click the same no-op button to exercise anti-repeat routing."
      };
    }
  };
}

function createReadScreenNavigator() {
  const calls = {
    readScreenCalls: 0,
    standardCalls: 0
  };

  return {
    calls,
    async decideNextAction(input) {
      if (input?.decisionMode === "READ_SCREEN") {
        calls.readScreenCalls += 1;
        return {
          action: "DONE",
          target: null,
          text: "Support code: 8491",
          key: null,
          confidence: 0.95,
          reasoning: "Answer is directly visible on screen."
        };
      }

      calls.standardCalls += 1;
      return {
        action: "WAIT",
        target: null,
        text: "250",
        key: null,
        confidence: 0.6,
        reasoning: "Fallback wait."
      };
    }
  };
}

function createComputerUseFallbackNavigator() {
  const calls = {
    computerUseCalls: 0,
    standardCalls: 0
  };

  return {
    calls,
    async decideNextAction(input) {
      const currentUrl = String(input?.observation?.currentUrl || "");
      if (currentUrl.includes("/computer-use/success")) {
        return {
          action: "DONE",
          target: null,
          text: "computer-use fixture complete",
          key: null,
          confidence: 1,
          reasoning: "Finish after successful navigation."
        };
      }

      if (input?.decisionMode === "COMPUTER_USE") {
        calls.computerUseCalls += 1;
        return {
          action: "CLICK",
          target: { x: 140, y: 190 },
          text: null,
          key: null,
          confidence: 0.93,
          reasoning: "Computer-use fallback issues a deterministic viewport click."
        };
      }

      calls.standardCalls += 1;
      return {
        action: "WAIT",
        target: null,
        text: "250",
        key: null,
        confidence: 0.62,
        reasoning: "Deliberate stall to trigger computer-use fallback."
      };
    }
  };
}

function validateEnterRequiredScenario(result, startUrl) {
  assertCondition(result && typeof result === "object", "enter-required result missing.");
  assertCondition(Array.isArray(result.history) && result.history.length > 0, "enter-required history missing.");

  const typeStepIndex = result.history.findIndex((record) => record?.action?.action === "TYPE");
  assertCondition(typeStepIndex >= 0, "enter-required expected at least one TYPE action.");

  const pressEnterStepIndex = result.history.findIndex((record, index) => {
    if (index <= typeStepIndex || index > typeStepIndex + 2) {
      return false;
    }
    return record?.action?.action === "PRESS_KEY" && record?.action?.key === "Enter";
  });
  assertCondition(
    pressEnterStepIndex >= 0,
    "enter-required expected PRESS_KEY Enter within 1-2 steps after TYPE."
  );

  const pressEnterRecord = result.history[pressEnterStepIndex];
  assertCondition(
    pressEnterRecord?.execution?.navigationObserved || pressEnterRecord?.execution?.urlChanged,
    "enter-required expected PRESS_KEY Enter to produce navigation or URL change."
  );

  assertCondition(
    typeof result.finalUrl === "string" && result.finalUrl.includes("/enter-required/results"),
    `enter-required expected finalUrl to include /enter-required/results, got ${String(result.finalUrl)}`
  );
  assertCondition(
    result.finalUrl !== startUrl,
    "enter-required expected finalUrl to differ from startUrl after Enter submission."
  );

  return {
    status: result.status,
    stepsTaken: result.stepsTaken,
    finalUrl: result.finalUrl,
    typeStep: result.history[typeStepIndex]?.step ?? null,
    pressEnterStep: pressEnterRecord?.step ?? null
  };
}

function validateNoopRepeatScenario(result) {
  assertCondition(result && typeof result === "object", "noop-repeat result missing.");
  assertCondition(Array.isArray(result.history) && result.history.length > 0, "noop-repeat history missing.");

  let lastNoProgressFingerprint = null;
  let repeatedNoProgressFingerprintCount = 0;
  let diversifiedActions = 0;
  let noProgressDecisionCacheHits = 0;

  for (const [index, record] of result.history.entries()) {
    const noProgressStreak = Number(record?.noProgressStreak ?? 0);
    const previousNoProgressStreak = Number(result.history[index - 1]?.noProgressStreak ?? 0);
    const fingerprint =
      typeof record?.actionFingerprint === "string" && record.actionFingerprint.length > 0
        ? record.actionFingerprint
        : null;

    if (record?.action?.action !== "CLICK") {
      diversifiedActions += 1;
    }

    if (previousNoProgressStreak > 0 && record?.observationCacheDecisionHit === true) {
      noProgressDecisionCacheHits += 1;
    }

    if (noProgressStreak <= 0 || !fingerprint) {
      lastNoProgressFingerprint = null;
      repeatedNoProgressFingerprintCount = 0;
      continue;
    }

    if (fingerprint === lastNoProgressFingerprint) {
      repeatedNoProgressFingerprintCount += 1;
    } else {
      lastNoProgressFingerprint = fingerprint;
      repeatedNoProgressFingerprintCount = 1;
    }

    assertCondition(
      repeatedNoProgressFingerprintCount <= 2,
      `noop-repeat history[${index}] repeated no-progress action fingerprint exceeded limit.`
    );
  }

  assertCondition(diversifiedActions > 0, "noop-repeat expected at least one diversified non-CLICK action.");
  assertCondition(
    noProgressDecisionCacheHits === 0,
    "noop-repeat expected zero decision-cache hits while noProgressStreak > 0."
  );

  return {
    status: result.status,
    stepsTaken: result.stepsTaken,
    diversifiedActions,
    noProgressDecisionCacheHits
  };
}

function validateReadScreenScenario(result, navigatorCalls) {
  assertCondition(result && typeof result === "object", "read-screen result missing.");
  assertCondition(Array.isArray(result.history) && result.history.length > 0, "read-screen history missing.");
  assertCondition(navigatorCalls.readScreenCalls > 0, "read-screen scenario expected at least one READ_SCREEN call.");
  assertCondition(navigatorCalls.standardCalls === 0, "read-screen scenario should terminate before STANDARD calls.");

  const firstRecord = result.history[0];
  assertCondition(firstRecord?.action?.action === "DONE", "read-screen scenario expected first action DONE.");
  assertCondition(
    typeof firstRecord?.action?.text === "string" && firstRecord.action.text.includes("8491"),
    "read-screen scenario expected DONE text to include 8491."
  );

  return {
    status: result.status,
    stepsTaken: result.stepsTaken,
    readScreenCalls: navigatorCalls.readScreenCalls,
    standardCalls: navigatorCalls.standardCalls,
    firstAction: firstRecord?.action?.action ?? null
  };
}

function validateComputerUseFallbackScenario(result, navigatorCalls, startUrl) {
  assertCondition(result && typeof result === "object", "computer-use result missing.");
  assertCondition(Array.isArray(result.history) && result.history.length > 0, "computer-use history missing.");
  assertCondition(
    navigatorCalls.computerUseCalls > 0,
    "computer-use scenario expected at least one COMPUTER_USE decision call."
  );

  const fallbackStep = result.history.find((record) => {
    return (
      record?.resolvedTier === "TIER_2_VISION" &&
      record?.action?.action === "CLICK" &&
      record?.noProgressStreak >= 2
    );
  });
  assertCondition(Boolean(fallbackStep), "computer-use expected a Tier-2 click after a no-progress streak.");

  return {
    status: result.status,
    stepsTaken: result.stepsTaken,
    computerUseCalls: navigatorCalls.computerUseCalls,
    standardCalls: navigatorCalls.standardCalls,
    fallbackStep: fallbackStep?.step ?? null,
    finalUrlChanged: typeof result.finalUrl === "string" ? result.finalUrl !== startUrl : false,
    finalUrl: result.finalUrl
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function writeScenarioArtifact(name, payload) {
  await mkdir(scenarioArtifactsDirectory, { recursive: true });
  const scenarioArtifactPath = path.join(
    scenarioArtifactsDirectory,
    `${name}-decision-routing-result.json`
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
    const { connectToGhostTabCdp, createPerceptionActionLoop } = await import("../dist/index.js");
    cdpClient = await connectToGhostTabCdp({ endpointURL: wsEndpoint });

    const enterStartUrl = `${localServer.baseUrl}/enter-required`;
    const enterLoop = createPerceptionActionLoop({
      cdpClient,
      navigatorEngine: createEnterFallbackNavigator(),
      maxSteps: 6,
      maxNoProgressSteps: 4,
      logger: (line) => console.info(`[enter-required] ${line}`)
    });
    const enterResult = await enterLoop.runTask({
      intent: "Type a query and submit via Enter.",
      startUrl: enterStartUrl,
      maxSteps: 6,
      maxNoProgressSteps: 4
    });
    const enterSummary = validateEnterRequiredScenario(enterResult, enterStartUrl);
    const enterArtifact = await writeScenarioArtifact("enter-required-submit", {
      ...enterResult,
      summary: enterSummary,
      runConfig: {
        phase: MILESTONE,
        scenario: "enter-required-submit",
        remoteDebuggingPort,
        headful: isHeadfulEnabled(),
        startUrl: enterStartUrl,
        localServerPort: localServer.port
      }
    });

    const noopStartUrl = `${localServer.baseUrl}/noop-button`;
    const noopLoop = createPerceptionActionLoop({
      cdpClient,
      navigatorEngine: createRepeatedNoopClickNavigator(),
      maxSteps: 7,
      maxNoProgressSteps: 6,
      logger: (line) => console.info(`[noop-repeat] ${line}`)
    });
    const noopResult = await noopLoop.runTask({
      intent: "Repeatedly click the only button.",
      startUrl: noopStartUrl,
      maxSteps: 7,
      maxNoProgressSteps: 6
    });
    const noopSummary = validateNoopRepeatScenario(noopResult);
    const noopArtifact = await writeScenarioArtifact("noop-repeat-diversification", {
      ...noopResult,
      summary: noopSummary,
      runConfig: {
        phase: MILESTONE,
        scenario: "noop-repeat-diversification",
        remoteDebuggingPort,
        headful: isHeadfulEnabled(),
        startUrl: noopStartUrl,
        localServerPort: localServer.port
      }
    });

    const readScreenNavigator = createReadScreenNavigator();
    const readScreenStartUrl = `${localServer.baseUrl}/visible-answer`;
    const readScreenLoop = createPerceptionActionLoop({
      cdpClient,
      navigatorEngine: readScreenNavigator,
      maxSteps: 3,
      maxNoProgressSteps: 2,
      logger: (line) => console.info(`[read-screen] ${line}`)
    });
    const readScreenResult = await readScreenLoop.runTask({
      intent: "What is the support code shown on the screen?",
      startUrl: readScreenStartUrl,
      maxSteps: 3,
      maxNoProgressSteps: 2
    });
    const readScreenSummary = validateReadScreenScenario(readScreenResult, readScreenNavigator.calls);
    const readScreenArtifact = await writeScenarioArtifact("read-screen-fast-answer", {
      ...readScreenResult,
      summary: readScreenSummary,
      runConfig: {
        phase: MILESTONE,
        scenario: "read-screen-fast-answer",
        remoteDebuggingPort,
        headful: isHeadfulEnabled(),
        startUrl: readScreenStartUrl,
        localServerPort: localServer.port
      }
    });

    const computerUseNavigator = createComputerUseFallbackNavigator();
    const computerUseStartUrl = `${localServer.baseUrl}/computer-use-link`;
    const computerUseLoop = createPerceptionActionLoop({
      cdpClient,
      navigatorEngine: computerUseNavigator,
      maxSteps: 8,
      maxNoProgressSteps: 6,
      logger: (line) => console.info(`[computer-use] ${line}`)
    });
    const computerUseResult = await computerUseLoop.runTask({
      intent: "Proceed to the destination page and finish.",
      startUrl: computerUseStartUrl,
      maxSteps: 8,
      maxNoProgressSteps: 6
    });
    const computerUseSummary = validateComputerUseFallbackScenario(
      computerUseResult,
      computerUseNavigator.calls,
      computerUseStartUrl
    );
    const computerUseArtifact = await writeScenarioArtifact("computer-use-fallback", {
      ...computerUseResult,
      summary: computerUseSummary,
      runConfig: {
        phase: MILESTONE,
        scenario: "computer-use-fallback",
        remoteDebuggingPort,
        headful: isHeadfulEnabled(),
        startUrl: computerUseStartUrl,
        localServerPort: localServer.port
      }
    });

    const scenarios = [
      {
        name: "enter-required-submit",
        status: enterResult.status,
        stepsTaken: enterResult.stepsTaken,
        summary: enterSummary,
        artifact: enterArtifact
      },
      {
        name: "noop-repeat-diversification",
        status: noopResult.status,
        stepsTaken: noopResult.stepsTaken,
        summary: noopSummary,
        artifact: noopArtifact
      },
      {
        name: "read-screen-fast-answer",
        status: readScreenResult.status,
        stepsTaken: readScreenResult.stepsTaken,
        summary: readScreenSummary,
        artifact: readScreenArtifact
      },
      {
        name: "computer-use-fallback",
        status: computerUseResult.status,
        stepsTaken: computerUseResult.stepsTaken,
        summary: computerUseSummary,
        artifact: computerUseArtifact
      }
    ];

    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(
      artifactPath,
      JSON.stringify(
        {
          ok: true,
          phase: MILESTONE,
          summary: {
            scenarioCount: scenarios.length,
            scenarios
          },
          runConfig: {
            remoteDebuggingPort,
            headful: isHeadfulEnabled(),
            localServerPort: localServer.port
          }
        },
        null,
        2
      )
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          phase: MILESTONE,
          artifact: artifactPath,
          scenarioCount: scenarios.length
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
