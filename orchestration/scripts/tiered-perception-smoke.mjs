import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REMOTE_DEBUGGING_PORT = 9333;
const DEFAULT_TASK_INTENT = "search for mechanical keyboards";
const DEFAULT_TASK_START_URL = "https://www.google.com/";
const DEFAULT_TASK_MAX_STEPS = 20;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;
const POLL_INTERVAL_MS = 250;
const STARTUP_TIMEOUT_MS = 20_000;
const MILESTONE = "2.1";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const artifactDirectory = path.join(repositoryRoot, "docs", "artifacts", "phase2", "phase2-2.1");
const scenarioArtifactsDirectory = path.join(artifactDirectory, "scenarios");

const suiteName = (process.env.PHASE2_SUITE ?? "complex").trim() || "complex";

const CUSTOM_TASK_INTENT = process.env.PHASE2_TASK_INTENT;
const CUSTOM_TASK_START_URL = process.env.PHASE2_TASK_START_URL;
const CUSTOM_SCENARIO_NAME = process.env.PHASE2_SCENARIO;

/** @typedef {{ expectTier1?: boolean, expectTier2?: boolean, expectAxDeficient?: boolean, expectTier3Scroll?: boolean, expectLowConfidenceEscalation?: boolean, expectDomBypass?: boolean }} ScenarioExpectations */

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
const COMPLEX_SCENARIOS = [
  {
    name: "baseline-google-tier1",
    intent: "search for mechanical keyboards",
    startUrl: "https://www.google.com/",
    maxSteps: 20,
    expectations: {
      expectTier1: true
    }
  },
  {
    name: "ax-deficient-webgl-tier2",
    intent: "identify any visible interactive control or if unavailable report failure",
    startUrl: "https://webglsamples.org/aquarium/aquarium.html",
    maxSteps: 4,
    axDeficientInteractiveThreshold: 20,
    expectations: {
      expectTier2: true,
      expectAxDeficient: true
    }
  },
  {
    name: "below-fold-footer-scroll-tier3",
    intent: "open the Privacy link in the page footer",
    startUrl: "https://developer.mozilla.org/en-US/",
    maxSteps: 6,
    // Force Tier 2 so this scenario validates scroll-driven recovery behavior.
    axDeficientInteractiveThreshold: 10_000,
    maxScrollSteps: 3,
    expectations: {
      expectTier2: true,
      expectTier3Scroll: true
    }
  }
];

/** @type {ScenarioConfig[]} */
const BASELINE_SCENARIOS = [
  {
    name: "default",
    intent: DEFAULT_TASK_INTENT,
    startUrl: DEFAULT_TASK_START_URL,
    maxSteps: DEFAULT_TASK_MAX_STEPS
  }
];

/** @type {Record<string, ScenarioConfig>} */
const SCENARIO_LOOKUP = Object.fromEntries(
  [...COMPLEX_SCENARIOS, ...BASELINE_SCENARIOS].map((scenario) => [scenario.name, scenario])
);

const globalOverrides = {
  taskMaxSteps: parseOptionalIntegerEnv("PHASE2_TASK_MAX_STEPS"),
  confidenceThreshold: parseOptionalNumberEnv("PHASE2_CONFIDENCE_THRESHOLD"),
  axDeficientInteractiveThreshold: parseOptionalIntegerEnv("PHASE2_AX_DEFICIENT_THRESHOLD"),
  scrollStepPx: parseOptionalIntegerEnv("PHASE2_SCROLL_STEP_PX"),
  maxScrollSteps: parseOptionalIntegerEnv("PHASE2_MAX_SCROLL_STEPS"),
  maxNoProgressSteps: parseOptionalIntegerEnv("PHASE2_MAX_NO_PROGRESS_STEPS")
};

const globalExpectations = {
  expectTier1: parseOptionalBooleanEnv("PHASE2_EXPECT_TIER1"),
  expectTier2: parseOptionalBooleanEnv("PHASE2_EXPECT_TIER2"),
  expectAxDeficient: parseOptionalBooleanEnv("PHASE2_EXPECT_AX_DEFICIENT"),
  expectTier3Scroll: parseOptionalBooleanEnv("PHASE2_EXPECT_TIER3_SCROLL"),
  expectDomBypass: parseOptionalBooleanEnv("PHASE2_EXPECT_DOM_BYPASS"),
  expectLowConfidenceEscalation: parseOptionalBooleanEnv(
    "PHASE2_EXPECT_LOW_CONFIDENCE_ESCALATION"
  )
};

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
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be an integer. Received: ${rawValue}`);
  }
  return parsed;
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

function parseOptionalBooleanEnv(name) {
  const rawValue = process.env[name];
  if (!rawValue || !rawValue.trim()) {
    return undefined;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`${name} must be a boolean-like value. Received: ${rawValue}`);
}

function parseRemoteDebuggingPort() {
  const rawValue = process.env.GHOST_REMOTE_DEBUGGING_PORT;
  const parsedPort = Number.parseInt(rawValue ?? String(DEFAULT_REMOTE_DEBUGGING_PORT), 10);

  if (Number.isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new Error(`Invalid GHOST_REMOTE_DEBUGGING_PORT: ${String(rawValue)}`);
  }

  return parsedPort;
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

function assertOptionalExpectation(expectation, condition, label, scenarioNameValue) {
  if (expectation === undefined) {
    return;
  }

  if (expectation !== condition) {
    throw new Error(
      `[${scenarioNameValue}] ${label} expectation failed. expected=${expectation} actual=${condition}`
    );
  }
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

  if (!loopResult.tierUsage || typeof loopResult.tierUsage !== "object") {
    throw new Error(`[${scenario.name}] tierUsage metrics are missing.`);
  }
  if (!Array.isArray(loopResult.escalations)) {
    throw new Error(`[${scenario.name}] escalation events are missing.`);
  }

  const confidenceThreshold = scenario.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  for (const [index, record] of loopResult.history.entries()) {
    if (record?.resolvedTier !== "TIER_1_AX") {
      continue;
    }

    const confidence = Number(record?.action?.confidence);
    if (!Number.isFinite(confidence)) {
      throw new Error(
        `[${scenario.name}] history[${index}] missing numeric action confidence for TIER_1_AX.`
      );
    }

    if (confidence < confidenceThreshold) {
      throw new Error(
        `[${scenario.name}] confidence-threshold policy violated at step=${record.step}. Tier 1 action confidence ${confidence.toFixed(2)} < threshold ${confidenceThreshold.toFixed(2)}`
      );
    }
  }

  for (const [index, escalation] of loopResult.escalations.entries()) {
    if (!escalation || typeof escalation !== "object") {
      throw new Error(`[${scenario.name}] escalation[${index}] is invalid.`);
    }
    if (typeof escalation.urlAtEscalation !== "string" || escalation.urlAtEscalation.length === 0) {
      throw new Error(`[${scenario.name}] escalation[${index}] missing urlAtEscalation.`);
    }
    if (typeof escalation.resolvedTier !== "string" || escalation.resolvedTier.length === 0) {
      throw new Error(`[${scenario.name}] escalation[${index}] missing resolvedTier.`);
    }
    if (escalation.reason === "LOW_CONFIDENCE") {
      const triggerConfidence = Number(escalation.triggerConfidence);
      const threshold = Number(escalation.confidenceThreshold);
      if (!Number.isFinite(triggerConfidence) || !Number.isFinite(threshold)) {
        throw new Error(
          `[${scenario.name}] escalation[${index}] LOW_CONFIDENCE missing numeric confidence metadata.`
        );
      }
      if (triggerConfidence >= threshold) {
        throw new Error(
          `[${scenario.name}] escalation[${index}] LOW_CONFIDENCE has triggerConfidence >= threshold (${triggerConfidence.toFixed(2)} >= ${threshold.toFixed(2)}).`
        );
      }
    }
  }

  const historyByStep = new Map(
    loopResult.history.map((record) => [Number(record?.step), record])
  );
  const axDeficientEscalations = loopResult.escalations.filter(
    (event) => event?.reason === "AX_DEFICIENT"
  );
  for (const [index, escalation] of axDeficientEscalations.entries()) {
    const record = historyByStep.get(Number(escalation.step));
    if (!record) {
      throw new Error(
        `[${scenario.name}] AX_DEFICIENT escalation[${index}] missing matching history step=${String(escalation.step)}.`
      );
    }

    if (!record.axDeficientDetected) {
      throw new Error(
        `[${scenario.name}] AX_DEFICIENT escalation[${index}] step=${record.step} did not mark axDeficientDetected=true.`
      );
    }

    const signals = record.axDeficiencySignals;
    if (!signals || typeof signals !== "object") {
      throw new Error(
        `[${scenario.name}] AX_DEFICIENT escalation[${index}] step=${record.step} missing axDeficiencySignals.`
      );
    }
    if (!signals.isLoadComplete) {
      throw new Error(
        `[${scenario.name}] AX_DEFICIENT escalation[${index}] step=${record.step} violated load-complete gate.`
      );
    }
    if (!signals.hasSignificantVisualContent) {
      throw new Error(
        `[${scenario.name}] AX_DEFICIENT escalation[${index}] step=${record.step} violated significant-visual-content gate.`
      );
    }
  }

  const lowConfidenceEscalationCount = loopResult.escalations.filter(
    (event) => event.reason === "LOW_CONFIDENCE"
  ).length;
  const noProgressEscalationCount = loopResult.escalations.filter(
    (event) => event.reason === "NO_PROGRESS"
  ).length;
  const unsafeActionEscalationCount = loopResult.escalations.filter(
    (event) => event.reason === "UNSAFE_ACTION"
  ).length;
  if (Number(loopResult.tierUsage.lowConfidenceEscalations ?? 0) !== lowConfidenceEscalationCount) {
    throw new Error(
      `[${scenario.name}] tierUsage.lowConfidenceEscalations does not match escalation events (${loopResult.tierUsage.lowConfidenceEscalations} !== ${lowConfidenceEscalationCount}).`
    );
  }
  if (Number(loopResult.tierUsage.noProgressEscalations ?? 0) !== noProgressEscalationCount) {
    throw new Error(
      `[${scenario.name}] tierUsage.noProgressEscalations does not match escalation events (${loopResult.tierUsage.noProgressEscalations} !== ${noProgressEscalationCount}).`
    );
  }
  if (Number(loopResult.tierUsage.unsafeActionEscalations ?? 0) !== unsafeActionEscalationCount) {
    throw new Error(
      `[${scenario.name}] tierUsage.unsafeActionEscalations does not match escalation events (${loopResult.tierUsage.unsafeActionEscalations} !== ${unsafeActionEscalationCount}).`
    );
  }
  const axDeficientPageLogs = Array.isArray(loopResult.axDeficientPages) ? loopResult.axDeficientPages : [];
  const axDeficientDetections = Number(loopResult.tierUsage.axDeficientDetections ?? 0);
  if (axDeficientPageLogs.length !== axDeficientDetections) {
    throw new Error(
      `[${scenario.name}] axDeficientPages count does not match tierUsage.axDeficientDetections (${axDeficientPageLogs.length} !== ${axDeficientDetections}).`
    );
  }

  const tier3History = loopResult.history.filter((record) => record?.resolvedTier === "TIER_3_SCROLL");
  const tier3ScrollCount = Number(loopResult.tierUsage.tier3Scrolls ?? 0);
  if (tier3History.length !== tier3ScrollCount) {
    throw new Error(
      `[${scenario.name}] TIER_3_SCROLL history count does not match tierUsage.tier3Scrolls (${tier3History.length} !== ${tier3ScrollCount}).`
    );
  }
  for (const [index, record] of tier3History.entries()) {
    if (record?.action?.action !== "SCROLL") {
      throw new Error(
        `[${scenario.name}] TIER_3_SCROLL history[${index}] must execute SCROLL action.`
      );
    }
    if (!record?.targetMightBeBelowFold) {
      throw new Error(
        `[${scenario.name}] TIER_3_SCROLL history[${index}] violated below-fold heuristic (targetMightBeBelowFold=false).`
      );
    }
    const scrollPosition = record?.scrollPosition;
    if (!scrollPosition || typeof scrollPosition !== "object") {
      throw new Error(
        `[${scenario.name}] TIER_3_SCROLL history[${index}] missing scrollPosition snapshot.`
      );
    }
  }
  const maxObservedScrollCount = loopResult.history.reduce((maxValue, record) => {
    const count = Number(record?.scrollCount ?? 0);
    return Number.isFinite(count) ? Math.max(maxValue, count) : maxValue;
  }, 0);
  const configuredMaxScrollSteps = Number(scenario.maxScrollSteps ?? 8);
  if (maxObservedScrollCount > configuredMaxScrollSteps) {
    throw new Error(
      `[${scenario.name}] observed scrollCount exceeds configured maxScrollSteps (${maxObservedScrollCount} > ${configuredMaxScrollSteps}).`
    );
  }

  for (const [index, record] of loopResult.history.entries()) {
    if (!record || typeof record !== "object") {
      throw new Error(`[${scenario.name}] history[${index}] is invalid.`);
    }

    if (index === 0) {
      if (!record.axTreeRefetched || record.axTreeRefetchReason !== "INITIAL") {
        throw new Error(
          `[${scenario.name}] history[0] must refetch AX tree with refetchReason=INITIAL.`
        );
      }
    } else {
      const previous = loopResult.history[index - 1];
      const expectedRefetchReason =
        previous?.execution?.navigationObserved ||
        previous?.urlAfterAction !== previous?.urlAtPerception
          ? "NAVIGATION"
          : previous?.action?.action === "SCROLL"
            ? "SCROLL_ACTION"
            : previous?.postActionSignificantDomMutationObserved
              ? "SIGNIFICANT_DOM_MUTATION"
              : "NONE";

      if (expectedRefetchReason === "NONE") {
        if (record.axTreeRefetched) {
          throw new Error(
            `[${scenario.name}] history[${index}] unexpectedly refetched AX tree without trigger.`
          );
        }
      } else {
        if (!record.axTreeRefetched) {
          throw new Error(
            `[${scenario.name}] history[${index}] missed AX tree refetch for reason=${expectedRefetchReason}.`
          );
        }
        if (record.axTreeRefetchReason !== expectedRefetchReason) {
          throw new Error(
            `[${scenario.name}] history[${index}] refetch reason mismatch. expected=${expectedRefetchReason} actual=${record.axTreeRefetchReason}`
          );
        }
      }
    }

    const mutationSummary = record.postActionMutationSummary;
    const significantMutation = Boolean(record.postActionSignificantDomMutationObserved);
    if (significantMutation) {
      if (!mutationSummary || !mutationSummary.significantMutationObserved) {
        throw new Error(
          `[${scenario.name}] history[${index}] significant mutation flag missing supporting summary.`
        );
      }
    }
  }

  const domBypassHistoryCount = loopResult.history.filter((record) => record?.domBypassUsed).length;
  const domBypassUsage = Number(loopResult.tierUsage.domBypassResolutions ?? 0);
  if (domBypassHistoryCount !== domBypassUsage) {
    throw new Error(
      `[${scenario.name}] domBypassResolutions does not match history domBypassUsed count (${domBypassUsage} !== ${domBypassHistoryCount}).`
    );
  }
  for (const [index, record] of loopResult.history.entries()) {
    if (!record?.domBypassUsed) {
      continue;
    }
    if (!record.domExtractionAttempted) {
      throw new Error(
        `[${scenario.name}] history[${index}] domBypassUsed=true but domExtractionAttempted=false.`
      );
    }
    if (record.resolvedTier !== "TIER_1_AX") {
      throw new Error(
        `[${scenario.name}] history[${index}] domBypassUsed=true must resolve without Tier 2 vision.`
      );
    }
  }

  const expectations = {
    ...scenario.expectations,
    ...globalExpectations
  };

  assertOptionalExpectation(
    expectations.expectTier1,
    Number(loopResult.tierUsage.tier1Calls ?? 0) > 0,
    "expectTier1",
    scenario.name
  );
  assertOptionalExpectation(
    expectations.expectTier2,
    Number(loopResult.tierUsage.tier2Calls ?? 0) > 0,
    "expectTier2",
    scenario.name
  );
  assertOptionalExpectation(
    expectations.expectAxDeficient,
    Number(loopResult.tierUsage.axDeficientDetections ?? 0) > 0,
    "expectAxDeficient",
    scenario.name
  );
  assertOptionalExpectation(
    expectations.expectTier3Scroll,
    Number(loopResult.tierUsage.tier3Scrolls ?? 0) > 0,
    "expectTier3Scroll",
    scenario.name
  );
  assertOptionalExpectation(
    expectations.expectLowConfidenceEscalation,
    lowConfidenceEscalationCount > 0,
    "expectLowConfidenceEscalation",
    scenario.name
  );
  assertOptionalExpectation(
    expectations.expectDomBypass,
    domBypassHistoryCount > 0,
    "expectDomBypass",
    scenario.name
  );
}

/** @returns {ScenarioConfig[]} */
function resolveScenarios() {
  if ((CUSTOM_TASK_INTENT && CUSTOM_TASK_INTENT.trim()) || (CUSTOM_TASK_START_URL && CUSTOM_TASK_START_URL.trim())) {
    return [
      {
        name: CUSTOM_SCENARIO_NAME?.trim() || "custom",
        intent: CUSTOM_TASK_INTENT?.trim() || DEFAULT_TASK_INTENT,
        startUrl: CUSTOM_TASK_START_URL?.trim() || DEFAULT_TASK_START_URL,
        maxSteps: globalOverrides.taskMaxSteps ?? DEFAULT_TASK_MAX_STEPS,
        confidenceThreshold: globalOverrides.confidenceThreshold,
        axDeficientInteractiveThreshold: globalOverrides.axDeficientInteractiveThreshold,
        scrollStepPx: globalOverrides.scrollStepPx,
        maxScrollSteps: globalOverrides.maxScrollSteps,
        maxNoProgressSteps: globalOverrides.maxNoProgressSteps
      }
    ];
  }

  if (CUSTOM_SCENARIO_NAME && CUSTOM_SCENARIO_NAME.trim()) {
    const resolved = SCENARIO_LOOKUP[CUSTOM_SCENARIO_NAME.trim()];
    if (!resolved) {
      throw new Error(
        `Unknown PHASE2_SCENARIO=${CUSTOM_SCENARIO_NAME}. Known scenarios: ${Object.keys(SCENARIO_LOOKUP).join(", ")}`
      );
    }
    return [resolved];
  }

  if (suiteName === "complex") {
    return COMPLEX_SCENARIOS;
  }

  if (suiteName === "baseline") {
    return BASELINE_SCENARIOS;
  }

  throw new Error(`Unsupported PHASE2_SUITE=${suiteName}. Use: complex | baseline`);
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

function summarizeSuite(scenarioRuns) {
  const totals = {
    tier1Calls: 0,
    tier2Calls: 0,
    tier3Scrolls: 0,
    axDeficientDetections: 0,
    lowConfidenceEscalations: 0,
    noProgressEscalations: 0,
    unsafeActionEscalations: 0,
    domBypassResolutions: 0,
    resolvedAtTier1: 0,
    resolvedAtTier2: 0,
    estimatedCostUsd: 0,
    estimatedVisionCostAvoidedUsd: 0
  };

  for (const run of scenarioRuns) {
    const usage = run.result.tierUsage;
    totals.tier1Calls += Number(usage.tier1Calls ?? 0);
    totals.tier2Calls += Number(usage.tier2Calls ?? 0);
    totals.tier3Scrolls += Number(usage.tier3Scrolls ?? 0);
    totals.axDeficientDetections += Number(usage.axDeficientDetections ?? 0);
    totals.lowConfidenceEscalations += Number(usage.lowConfidenceEscalations ?? 0);
    totals.noProgressEscalations += Number(usage.noProgressEscalations ?? 0);
    totals.unsafeActionEscalations += Number(usage.unsafeActionEscalations ?? 0);
    totals.domBypassResolutions += Number(usage.domBypassResolutions ?? 0);
    totals.resolvedAtTier1 += Number(usage.resolvedAtTier1 ?? 0);
    totals.resolvedAtTier2 += Number(usage.resolvedAtTier2 ?? 0);
    totals.estimatedCostUsd += Number(usage.estimatedCostUsd ?? 0);
    totals.estimatedVisionCostAvoidedUsd += Number(usage.estimatedVisionCostAvoidedUsd ?? 0);
  }

  totals.estimatedCostUsd = Math.round(totals.estimatedCostUsd * 1_000_000) / 1_000_000;
  totals.estimatedVisionCostAvoidedUsd =
    Math.round(totals.estimatedVisionCostAvoidedUsd * 1_000_000) / 1_000_000;

  return totals;
}

function validateComplexSuiteCoverage(scenarioRuns) {
  if (scenarioRuns.length === 0) {
    throw new Error("No scenarios executed.");
  }

  const suiteTotals = summarizeSuite(scenarioRuns);
  if (suiteTotals.tier2Calls <= 0) {
    throw new Error("Complex suite did not trigger Tier 2 in any scenario.");
  }

  if (suiteTotals.tier3Scrolls <= 0) {
    throw new Error("Complex suite did not trigger Tier 3 scroll fallback in any scenario.");
  }
}

async function writeScenarioArtifact(scenarioNameValue, payload) {
  await mkdir(scenarioArtifactsDirectory, { recursive: true });
  const scenarioArtifactPath = path.join(
    scenarioArtifactsDirectory,
    `${scenarioNameValue}-tiered-perception-result.json`
  );
  await writeFile(scenarioArtifactPath, JSON.stringify(payload, null, 2));
  return scenarioArtifactPath;
}

async function main() {
  const scenarios = resolveScenarios().map(mergeScenarioWithGlobalOverrides);
  const runLabel =
    scenarios.length === 1 && scenarios[0].name === "default" ? "default" : `${suiteName}-suite`;
  const suiteArtifactPath = path.join(artifactDirectory, `${runLabel}-tiered-perception-result.json`);

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
          suiteName,
          scenario,
          globalOverrides,
          globalExpectations
        }
      };
      const scenarioArtifactPath = await writeScenarioArtifact(scenario.name, scenarioArtifactPayload);

      scenarioRuns.push({
        scenario,
        result: loopResult,
        scenarioArtifactPath
      });
    }

    if (suiteName === "complex" && scenarios.length > 1) {
      validateComplexSuiteCoverage(scenarioRuns);
    }

    const suiteSummary = {
      scenarioCount: scenarioRuns.length,
      suiteTierUsage: summarizeSuite(scenarioRuns),
      scenarios: scenarioRuns.map((run) => ({
        name: run.scenario.name,
        intent: run.scenario.intent,
        startUrl: run.scenario.startUrl,
        status: run.result.status,
        stepsTaken: run.result.stepsTaken,
        finalUrl: run.result.finalUrl,
        tierUsage: run.result.tierUsage,
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
          suiteName,
          runLabel,
          summary: suiteSummary,
          runConfig: {
            scenarios,
            globalOverrides,
            globalExpectations
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
          suiteName,
          runLabel,
          summary: suiteSummary,
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
