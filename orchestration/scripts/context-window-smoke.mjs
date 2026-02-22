import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REMOTE_DEBUGGING_PORT = 9333;
const POLL_INTERVAL_MS = 250;
const STARTUP_TIMEOUT_MS = 20_000;
const MILESTONE = "4.1";
const DEFAULT_TASK_MAX_STEPS = 15;
const DEFAULT_SUITE = (process.env.PHASE4_SUITE ?? "aa").trim().toLowerCase() || "aa";

if (!process.env.GHOST_HEADFUL) {
  // Compatibility with prior smoke-script toggles: default to visible browser.
  process.env.GHOST_HEADFUL = process.env.GHOST_HEADLESS ?? "true";
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const artifactDirectory = path.join(repositoryRoot, "docs", "artifacts", "phase4", "phase4-4.1");
const scenarioArtifactsDirectory = path.join(artifactDirectory, "scenarios");
const suiteArtifactPath = path.join(artifactDirectory, "context-window-management-result.json");

const CUSTOM_TASK_INTENT = process.env.PHASE4_TASK_INTENT;
const CUSTOM_TASK_START_URL = process.env.PHASE4_TASK_START_URL;
const CUSTOM_SCENARIO_NAME = process.env.PHASE4_SCENARIO;

const globalOverrides = {
  taskMaxSteps: parseOptionalIntegerEnv("PHASE4_TASK_MAX_STEPS"),
  confidenceThreshold: parseOptionalNumberEnv("PHASE4_CONFIDENCE_THRESHOLD"),
  axDeficientInteractiveThreshold: parseOptionalIntegerEnv("PHASE4_AX_DEFICIENT_THRESHOLD"),
  scrollStepPx: parseOptionalIntegerEnv("PHASE4_SCROLL_STEP_PX"),
  maxScrollSteps: parseOptionalIntegerEnv("PHASE4_MAX_SCROLL_STEPS"),
  maxNoProgressSteps: parseOptionalIntegerEnv("PHASE4_MAX_NO_PROGRESS_STEPS")
};

/** @typedef {{ minimumHistoryForSummaryCheck?: number }} ScenarioExpectations */

/**
 * @typedef {Object} ScenarioConfig
 * @property {string} name
 * @property {string} intent
 * @property {string} startUrl
 * @property {number=} maxSteps
 * @property {number=} confidenceThreshold
 * @property {number=} axDeficientInteractiveThreshold
 * @property {number=} scrollStepPx
 * @property {number=} maxScrollSteps
 * @property {number=} maxNoProgressSteps
 * @property {ScenarioExpectations=} expectations
 */

/** @type {ScenarioConfig[]} */
const AIRLINE_SCENARIOS = [
  {
    name: "aa-flight-search-march-2026",
    intent:
      "Search round-trip flights on aa.com from JFK to LAX. Use departure date March 18, 2026 and return date March 25, 2026. Fill departure airport, arrival airport, and both dates, then execute the search.",
    startUrl: "https://www.aa.com/",
    maxSteps: DEFAULT_TASK_MAX_STEPS,
    expectations: {
      minimumHistoryForSummaryCheck: 7
    }
  },
  {
    name: "delta-flight-search-march-2026",
    intent:
      "Search round-trip flights on delta.com from SEA to BOS. Use departure date March 12, 2026 and return date March 19, 2026. Fill departure airport, arrival airport, and both dates, then execute the search.",
    startUrl: "https://www.delta.com/",
    maxSteps: DEFAULT_TASK_MAX_STEPS,
    expectations: {
      minimumHistoryForSummaryCheck: 7
    }
  }
];

/** @type {ScenarioConfig[]} */
const MUSIC_SCENARIOS = [
  {
    name: "guitarcenter-guitar-search",
    intent:
      "Search for Fender Stratocaster electric guitar, open one product result, and extract the listed price.",
    startUrl: "https://www.guitarcenter.com/",
    maxSteps: DEFAULT_TASK_MAX_STEPS,
    expectations: {
      minimumHistoryForSummaryCheck: 7
    }
  },
  {
    name: "themusiczoo-guitar-search",
    intent:
      "Search for Fender Stratocaster electric guitar, open one product result, and extract the listed price.",
    startUrl: "https://www.themusiczoo.com/",
    maxSteps: DEFAULT_TASK_MAX_STEPS,
    expectations: {
      minimumHistoryForSummaryCheck: 7
    }
  }
];

const DEFAULT_SCENARIOS = AIRLINE_SCENARIOS;

/** @type {Record<string, ScenarioConfig>} */
const SCENARIO_LOOKUP = Object.fromEntries(
  [...AIRLINE_SCENARIOS, ...MUSIC_SCENARIOS].map((scenario) => [scenario.name, scenario])
);

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseOptionalIntegerEnv(name) {
  const rawValue = process.env[name];
  if (!rawValue || !rawValue.trim()) {
    return undefined;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be an integer. Received: ${rawValue}`);
  }
  return parsed;
}

function parseOptionalNumberEnv(name) {
  const rawValue = process.env[name];
  if (!rawValue || !rawValue.trim()) {
    return undefined;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number. Received: ${rawValue}`);
  }
  return parsed;
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

function mergeScenarioWithGlobalOverrides(scenario) {
  return {
    ...scenario,
    maxSteps: globalOverrides.taskMaxSteps ?? scenario.maxSteps ?? DEFAULT_TASK_MAX_STEPS,
    confidenceThreshold: globalOverrides.confidenceThreshold ?? scenario.confidenceThreshold,
    axDeficientInteractiveThreshold:
      globalOverrides.axDeficientInteractiveThreshold ?? scenario.axDeficientInteractiveThreshold,
    scrollStepPx: globalOverrides.scrollStepPx ?? scenario.scrollStepPx,
    maxScrollSteps: globalOverrides.maxScrollSteps ?? scenario.maxScrollSteps,
    maxNoProgressSteps: globalOverrides.maxNoProgressSteps ?? scenario.maxNoProgressSteps
  };
}

function resolveScenarios() {
  if ((CUSTOM_TASK_INTENT && CUSTOM_TASK_INTENT.trim()) || (CUSTOM_TASK_START_URL && CUSTOM_TASK_START_URL.trim())) {
    return [
      {
        name: CUSTOM_SCENARIO_NAME?.trim() || "custom-context-window",
        intent: CUSTOM_TASK_INTENT?.trim() || DEFAULT_SCENARIOS[0].intent,
        startUrl: CUSTOM_TASK_START_URL?.trim() || DEFAULT_SCENARIOS[0].startUrl,
        maxSteps: globalOverrides.taskMaxSteps ?? DEFAULT_TASK_MAX_STEPS
      }
    ];
  }

  if (CUSTOM_SCENARIO_NAME && CUSTOM_SCENARIO_NAME.trim()) {
    const scenario = SCENARIO_LOOKUP[CUSTOM_SCENARIO_NAME.trim()];
    if (!scenario) {
      throw new Error(
        `Unknown PHASE4_SCENARIO=${CUSTOM_SCENARIO_NAME}. Known scenarios: ${Object.keys(SCENARIO_LOOKUP).join(", ")}`
      );
    }
    return [scenario];
  }

  if (DEFAULT_SUITE === "aa") {
    return [DEFAULT_SCENARIOS[0]];
  }
  if (DEFAULT_SUITE === "aa+delta" || DEFAULT_SUITE === "multi") {
    return AIRLINE_SCENARIOS;
  }
  if (DEFAULT_SUITE === "music" || DEFAULT_SUITE === "guitars") {
    return MUSIC_SCENARIOS;
  }

  throw new Error(
    `Unsupported PHASE4_SUITE=${DEFAULT_SUITE}. Use: aa | aa+delta | multi | music | guitars`
  );
}

function validateLoopResult(loopResult, scenario) {
  if (!loopResult || typeof loopResult !== "object") {
    throw new Error(`[${scenario.name}] Loop result missing.`);
  }
  if (!Array.isArray(loopResult.history) || loopResult.history.length === 0) {
    throw new Error(`[${scenario.name}] Loop history is empty.`);
  }
  if (!["DONE", "FAILED", "MAX_STEPS"].includes(loopResult.status)) {
    throw new Error(`[${scenario.name}] Unexpected loop status: ${String(loopResult.status)}`);
  }
  if (loopResult.stepsTaken > Number(scenario.maxSteps ?? DEFAULT_TASK_MAX_STEPS)) {
    throw new Error(
      `[${scenario.name}] Loop exceeded max steps (${loopResult.stepsTaken} > ${scenario.maxSteps ?? DEFAULT_TASK_MAX_STEPS}).`
    );
  }

  for (const [index, record] of loopResult.history.entries()) {
    if (!record || typeof record !== "object") {
      throw new Error(`[${scenario.name}] history[${index}] is invalid.`);
    }

    const expectedRecentCount = Math.min(Math.max(Number(record.step) - 1, 0), 5);
    if (Number(record.contextRecentPairCount) !== expectedRecentCount) {
      throw new Error(
        `[${scenario.name}] history[${index}] contextRecentPairCount mismatch. expected=${expectedRecentCount} actual=${String(record.contextRecentPairCount)}`
      );
    }
    if (Number(record.contextRecentPairCount) > 5) {
      throw new Error(
        `[${scenario.name}] history[${index}] contextRecentPairCount exceeded 5 (${record.contextRecentPairCount}).`
      );
    }

    const expectedSummarizedCount = Math.max(Number(record.step) - 1 - 5, 0);
    if (Number(record.contextSummarizedPairCount) !== expectedSummarizedCount) {
      throw new Error(
        `[${scenario.name}] history[${index}] contextSummarizedPairCount mismatch. expected=${expectedSummarizedCount} actual=${String(record.contextSummarizedPairCount)}`
      );
    }

    const expectedSummaryIncluded = expectedSummarizedCount > 0;
    if (Boolean(record.contextSummaryIncluded) !== expectedSummaryIncluded) {
      throw new Error(
        `[${scenario.name}] history[${index}] contextSummaryIncluded mismatch. expected=${expectedSummaryIncluded} actual=${String(record.contextSummaryIncluded)}`
      );
    }
    if (expectedSummaryIncluded && Number(record.contextSummaryCharCount) <= 0) {
      throw new Error(
        `[${scenario.name}] history[${index}] summary expected but contextSummaryCharCount <= 0.`
      );
    }

    const tier1PromptTokens = Number(record.tier1EstimatedPromptTokens ?? 0);
    const tier2PromptTokens = Number(record.tier2EstimatedPromptTokens ?? 0);
    if (!Number.isFinite(tier1PromptTokens) || tier1PromptTokens < 0) {
      throw new Error(
        `[${scenario.name}] history[${index}] invalid tier1EstimatedPromptTokens=${String(record.tier1EstimatedPromptTokens)}.`
      );
    }
    if (!Number.isFinite(tier2PromptTokens) || tier2PromptTokens < 0) {
      throw new Error(
        `[${scenario.name}] history[${index}] invalid tier2EstimatedPromptTokens=${String(record.tier2EstimatedPromptTokens)}.`
      );
    }
  }

  const contextMetrics = loopResult.contextWindow;
  if (!contextMetrics || typeof contextMetrics !== "object") {
    throw new Error(`[${scenario.name}] contextWindow metrics are missing.`);
  }

  if (Number(contextMetrics.maxRecentPairCount ?? 0) > 5) {
    throw new Error(
      `[${scenario.name}] contextWindow.maxRecentPairCount exceeded 5 (${contextMetrics.maxRecentPairCount}).`
    );
  }
  if (Number(contextMetrics.maxEstimatedPromptTokens ?? 0) <= 0) {
    throw new Error(`[${scenario.name}] contextWindow.maxEstimatedPromptTokens is missing or zero.`);
  }
  if (!Array.isArray(contextMetrics.tokenAlerts)) {
    throw new Error(`[${scenario.name}] contextWindow.tokenAlerts is not an array.`);
  }
  if (Number(contextMetrics.tokenAlertCount ?? 0) !== contextMetrics.tokenAlerts.length) {
    throw new Error(
      `[${scenario.name}] contextWindow.tokenAlertCount does not match tokenAlerts length (${contextMetrics.tokenAlertCount} !== ${contextMetrics.tokenAlerts.length}).`
    );
  }

  const minimumHistoryForSummaryCheck = Number(scenario.expectations?.minimumHistoryForSummaryCheck ?? 0);
  if (loopResult.history.length >= minimumHistoryForSummaryCheck) {
    if (Number(contextMetrics.summaryRefreshCount ?? 0) <= 0) {
      throw new Error(
        `[${scenario.name}] expected summaryRefreshCount > 0 for history length ${loopResult.history.length}.`
      );
    }
    if (Number(contextMetrics.maxSummarizedPairCount ?? 0) <= 0) {
      throw new Error(
        `[${scenario.name}] expected maxSummarizedPairCount > 0 for history length ${loopResult.history.length}.`
      );
    }
  }
}

function summarizeSuite(scenarioRuns) {
  let maxRecentPairCount = 0;
  let maxSummarizedPairCount = 0;
  let maxEstimatedPromptTokens = 0;
  let tokenAlertCount = 0;
  let summaryRefreshCount = 0;

  for (const run of scenarioRuns) {
    const metrics = run.result.contextWindow ?? {};
    maxRecentPairCount = Math.max(maxRecentPairCount, Number(metrics.maxRecentPairCount ?? 0));
    maxSummarizedPairCount = Math.max(
      maxSummarizedPairCount,
      Number(metrics.maxSummarizedPairCount ?? 0)
    );
    maxEstimatedPromptTokens = Math.max(
      maxEstimatedPromptTokens,
      Number(metrics.maxEstimatedPromptTokens ?? 0)
    );
    tokenAlertCount += Number(metrics.tokenAlertCount ?? 0);
    summaryRefreshCount += Number(metrics.summaryRefreshCount ?? 0);
  }

  return {
    maxRecentPairCount,
    maxSummarizedPairCount,
    maxEstimatedPromptTokens,
    tokenAlertCount,
    summaryRefreshCount
  };
}

async function writeScenarioArtifact(scenarioName, payload) {
  await mkdir(scenarioArtifactsDirectory, { recursive: true });
  const scenarioArtifactPath = path.join(
    scenarioArtifactsDirectory,
    `${scenarioName}-context-window-result.json`
  );
  await writeFile(scenarioArtifactPath, JSON.stringify(payload, null, 2));
  return scenarioArtifactPath;
}

async function main() {
  const scenarios = resolveScenarios().map(mergeScenarioWithGlobalOverrides);
  const remoteDebuggingPort = parseRemoteDebuggingPort();
  const versionEndpoint = `http://127.0.0.1:${remoteDebuggingPort}/json/version`;
  const electronHost = startElectronCdpHost(remoteDebuggingPort);
  const runHeadfulGhostTab = isHeadfulEnabled();

  let cdpClient = null;

  try {
    const wsEndpoint = await waitForWebSocketEndpoint(versionEndpoint, STARTUP_TIMEOUT_MS);
    const { connectToGhostTabCdp, createNavigatorEngine, createPerceptionActionLoop } =
      await import("../dist/index.js");

    cdpClient = await connectToGhostTabCdp({ endpointURL: wsEndpoint });
    const navigator = createNavigatorEngine();

    const scenarioRuns = [];
    for (const scenario of scenarios) {
      const loop = createPerceptionActionLoop({
        cdpClient,
        navigatorEngine: navigator,
        maxSteps: scenario.maxSteps,
        confidenceThreshold: scenario.confidenceThreshold,
        axDeficientInteractiveThreshold: scenario.axDeficientInteractiveThreshold,
        scrollStepPx: scenario.scrollStepPx,
        maxScrollSteps: scenario.maxScrollSteps,
        maxNoProgressSteps: scenario.maxNoProgressSteps,
        logger: (line) => console.info(`[${scenario.name}] ${line}`)
      });

      const loopResult = await loop.runTask({
        intent: scenario.intent,
        startUrl: scenario.startUrl,
        maxSteps: scenario.maxSteps,
        confidenceThreshold: scenario.confidenceThreshold,
        axDeficientInteractiveThreshold: scenario.axDeficientInteractiveThreshold,
        scrollStepPx: scenario.scrollStepPx,
        maxScrollSteps: scenario.maxScrollSteps,
        maxNoProgressSteps: scenario.maxNoProgressSteps
      });

      validateLoopResult(loopResult, scenario);
      const scenarioArtifactPayload = {
        ...loopResult,
        runConfig: {
          milestone: MILESTONE,
          suite: DEFAULT_SUITE,
          scenario,
          runHeadfulGhostTab,
          globalOverrides
        }
      };
      const scenarioArtifactPath = await writeScenarioArtifact(scenario.name, scenarioArtifactPayload);
      scenarioRuns.push({
        scenario,
        result: loopResult,
        scenarioArtifactPath
      });
    }

    const summary = {
      scenarioCount: scenarioRuns.length,
      runHeadfulGhostTab,
      contextWindowSummary: summarizeSuite(scenarioRuns),
      scenarios: scenarioRuns.map((run) => ({
        name: run.scenario.name,
        status: run.result.status,
        stepsTaken: run.result.stepsTaken,
        finalUrl: run.result.finalUrl,
        contextWindow: run.result.contextWindow,
        artifact: run.scenarioArtifactPath
      }))
    };

    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(
      suiteArtifactPath,
      JSON.stringify(
        {
          ok: true,
          phase: MILESTONE,
          suiteName: DEFAULT_SUITE,
          summary,
          runConfig: {
            scenarios,
            runHeadfulGhostTab,
            globalOverrides
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
          suiteName: DEFAULT_SUITE,
          runHeadfulGhostTab,
          summary,
          artifact: suiteArtifactPath
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
