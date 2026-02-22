import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REMOTE_DEBUGGING_PORT = 9333;
const POLL_INTERVAL_MS = 250;
const STARTUP_TIMEOUT_MS = 20_000;
const MILESTONE = "4.2";

if (!process.env.GHOST_HEADFUL) {
  process.env.GHOST_HEADFUL = process.env.GHOST_HEADLESS ?? "true";
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const artifactDirectory = path.join(repositoryRoot, "docs", "artifacts", "phase4", "phase4-4.2");
const scenarioArtifactsDirectory = path.join(artifactDirectory, "scenarios");
const artifactPath = path.join(artifactDirectory, "task-decomposition-checkpointing-result.json");

const SCENARIOS = [
  {
    name: "flight-intent-decomposition",
    intent:
      "Find the cheapest flight from NYC to London next Friday on Google Flights, set travel dates, run search, and extract the top itinerary.",
    startUrl: "about:blank",
    maxSteps: 8,
    maxNoProgressSteps: 2,
    maxSubtaskRetries: 1,
    expectations: {
      minSubtasks: 5,
      requireDecomposed: true
    }
  },
  {
    name: "checkpoint-retry-pressure",
    intent:
      "Open flights search, fill origin and destination, set dates, apply cheapest filter, extract top fare, and verify final details.",
    startUrl: "about:blank",
    maxSteps: 10,
    maxNoProgressSteps: 1,
    maxSubtaskRetries: 2,
    expectations: {
      minSubtasks: 5,
      requireDecomposed: true,
      requireRetryFromCheckpoint: true
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

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validateScenario(run) {
  const { scenario, result, onSubtaskStatusEvents } = run;
  assertCondition(result && typeof result === "object", `[${scenario.name}] result missing.`);
  assertCondition(result.decomposition && typeof result.decomposition === "object", `[${scenario.name}] decomposition missing.`);
  assertCondition(Array.isArray(result.subtasks), `[${scenario.name}] subtasks missing.`);
  assertCondition(
    result.subtasks.length >= Number(scenario.expectations?.minSubtasks ?? 1),
    `[${scenario.name}] expected at least ${scenario.expectations?.minSubtasks ?? 1} subtasks. got=${result.subtasks.length}`
  );
  assertCondition(
    !scenario.expectations?.requireDecomposed || result.decomposition.isDecomposed === true,
    `[${scenario.name}] expected decomposition.isDecomposed=true.`
  );

  const validStatuses = new Set(["PENDING", "IN_PROGRESS", "COMPLETE", "FAILED"]);
  for (const [index, subtask] of result.subtasks.entries()) {
    assertCondition(subtask && typeof subtask === "object", `[${scenario.name}] subtask[${index}] invalid.`);
    assertCondition(
      validStatuses.has(subtask.status),
      `[${scenario.name}] subtask[${index}] invalid status=${String(subtask.status)}`
    );
  }

  assertCondition(result.checkpoint && typeof result.checkpoint === "object", `[${scenario.name}] checkpoint missing.`);
  assertCondition(
    Number.isFinite(result.checkpoint.lastCompletedSubtaskIndex),
    `[${scenario.name}] checkpoint.lastCompletedSubtaskIndex invalid.`
  );
  assertCondition(
    Array.isArray(result.checkpoint.subtaskArtifacts),
    `[${scenario.name}] checkpoint.subtaskArtifacts missing.`
  );

  assertCondition(
    Array.isArray(result.subtaskStatusTimeline) && result.subtaskStatusTimeline.length >= result.subtasks.length,
    `[${scenario.name}] subtaskStatusTimeline missing or too short.`
  );

  const retryEvents = result.subtaskStatusTimeline.filter((event) =>
    typeof event.reason === "string" && event.reason.includes("RETRY_FROM_CHECKPOINT")
  );

  if (scenario.expectations?.requireRetryFromCheckpoint) {
    assertCondition(
      retryEvents.length > 0,
      `[${scenario.name}] expected at least one RETRY_FROM_CHECKPOINT event.`
    );
  }

  assertCondition(
    onSubtaskStatusEvents.length === result.subtaskStatusTimeline.length,
    `[${scenario.name}] callback timeline mismatch: callback=${onSubtaskStatusEvents.length} result=${result.subtaskStatusTimeline.length}`
  );

  return {
    status: result.status,
    stepsTaken: result.stepsTaken,
    totalSubtasks: result.subtasks.length,
    completedSubtasks: result.subtasks.filter((subtask) => subtask.status === "COMPLETE").length,
    failedSubtasks: result.subtasks.filter((subtask) => subtask.status === "FAILED").length,
    retryFromCheckpointEvents: retryEvents.length,
    checkpoint: result.checkpoint,
    decomposition: result.decomposition
  };
}

async function writeScenarioArtifact(name, payload) {
  await mkdir(scenarioArtifactsDirectory, { recursive: true });
  const scenarioArtifactPath = path.join(
    scenarioArtifactsDirectory,
    `${name}-task-decomposition-checkpointing-result.json`
  );
  await writeFile(scenarioArtifactPath, JSON.stringify(payload, null, 2));
  return scenarioArtifactPath;
}

async function main() {
  const remoteDebuggingPort = parseRemoteDebuggingPort();
  const versionEndpoint = `http://127.0.0.1:${remoteDebuggingPort}/json/version`;
  const electronHost = startElectronCdpHost(remoteDebuggingPort);

  let cdpClient = null;

  try {
    const wsEndpoint = await waitForWebSocketEndpoint(versionEndpoint, STARTUP_TIMEOUT_MS);
    const { connectToGhostTabCdp, createNavigatorEngine, createPerceptionActionLoop } =
      await import("../dist/index.js");

    cdpClient = await connectToGhostTabCdp({ endpointURL: wsEndpoint });
    const navigator = createNavigatorEngine();

    const scenarioRuns = [];

    for (const scenario of SCENARIOS) {
      const onSubtaskStatusEvents = [];
      const loop = createPerceptionActionLoop({
        cdpClient,
        navigatorEngine: navigator,
        maxSteps: scenario.maxSteps,
        maxNoProgressSteps: scenario.maxNoProgressSteps,
        maxSubtaskRetries: scenario.maxSubtaskRetries,
        logger: (line) => console.info(`[${scenario.name}] ${line}`),
        onSubtaskStatus: (event) => {
          onSubtaskStatusEvents.push(event);
        }
      });

      const result = await loop.runTask({
        intent: scenario.intent,
        startUrl: scenario.startUrl,
        maxSteps: scenario.maxSteps,
        maxNoProgressSteps: scenario.maxNoProgressSteps,
        maxSubtaskRetries: scenario.maxSubtaskRetries
      });

      const summary = validateScenario({
        scenario,
        result,
        onSubtaskStatusEvents
      });

      const scenarioPayload = {
        ...result,
        runConfig: {
          phase: MILESTONE,
          scenario,
          remoteDebuggingPort,
          headful: isHeadfulEnabled()
        },
        subtaskStatusCallbackEvents: onSubtaskStatusEvents,
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
        headful: isHeadfulEnabled()
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
