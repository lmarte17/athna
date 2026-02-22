import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REMOTE_DEBUGGING_PORT = 9333;
const DEFAULT_POOL_SIZE = 2;
const DEFAULT_MEMORY_BUDGET_MB = 1;
const DEFAULT_CPU_BUDGET_PERCENT = 25;
const DEFAULT_VIOLATION_WINDOW_MS = 3_000;
const DEFAULT_SAMPLE_INTERVAL_MS = 500;
const DEFAULT_HOG_HOLD_ITERATIONS = 40;
const DEFAULT_HOG_HOLD_STEP_MS = 250;
const DEFAULT_CPU_BURN_MS = 180;
const POLL_INTERVAL_MS = 100;
const STARTUP_TIMEOUT_MS = 20_000;
const WAIT_TIMEOUT_MS = 20_000;
const MILESTONE = "3.6";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const artifactDirectory = path.join(repositoryRoot, "docs", "artifacts", "phase3", "phase3-3.6");
const artifactPath = path.join(artifactDirectory, "resource-budgets-result.json");

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

function startHarnessServer() {
  let requestCount = 0;
  const server = createServer((request, response) => {
    requestCount += 1;
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const taskId = requestUrl.searchParams.get("taskId") ?? "unknown";
    response.statusCode = 200;
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(
      [
        "<!doctype html>",
        "<html>",
        `<head><title>Phase 3.6 Task ${taskId}</title></head>`,
        "<body>",
        `<main data-task-id=\"${taskId}\">resource budget harness</main>`,
        "</body>",
        "</html>"
      ].join("")
    );
  });

  return {
    async listen() {
      await new Promise((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Failed to bind harness server.");
      }
      return {
        origin: `http://127.0.0.1:${address.port}`,
        getRequestCount: () => requestCount
      };
    },
    async close() {
      if (!server.listening) {
        return;
      }
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
  };
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitForCondition(fn, timeoutMs, description) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await fn();
    if (result) {
      return result;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for ${description}`);
}

function findSchedulerEvents(statusMessages, taskId) {
  return statusMessages.filter((message) => {
    return (
      message.type === "TASK_STATUS" &&
      message.taskId === taskId &&
      message.payload.kind === "SCHEDULER"
    );
  });
}

function buildCpuBurnExpression(durationMs) {
  return `(() => {
    const end = Date.now() + ${durationMs};
    let accumulator = 0;
    while (Date.now() < end) {
      accumulator += Math.sqrt(Math.random() * 1000);
    }
    window.__phase36CpuBurnAccumulator = accumulator;
    return accumulator;
  })();`;
}

async function main() {
  const poolSize = parseIntegerEnv("PHASE3_RESOURCE_POOL_SIZE", DEFAULT_POOL_SIZE);
  const memoryBudgetMb = parseIntegerEnv("PHASE3_RESOURCE_MEMORY_BUDGET_MB", DEFAULT_MEMORY_BUDGET_MB);
  const cpuBudgetPercent = parseIntegerEnv(
    "PHASE3_RESOURCE_CPU_BUDGET_PERCENT",
    DEFAULT_CPU_BUDGET_PERCENT
  );
  const violationWindowMs = parseIntegerEnv(
    "PHASE3_RESOURCE_VIOLATION_WINDOW_MS",
    DEFAULT_VIOLATION_WINDOW_MS
  );
  const sampleIntervalMs = parseIntegerEnv(
    "PHASE3_RESOURCE_SAMPLE_INTERVAL_MS",
    DEFAULT_SAMPLE_INTERVAL_MS
  );
  const hogHoldIterations = parseIntegerEnv(
    "PHASE3_RESOURCE_HOG_HOLD_ITERATIONS",
    DEFAULT_HOG_HOLD_ITERATIONS
  );
  const hogHoldStepMs = parseIntegerEnv("PHASE3_RESOURCE_HOG_HOLD_STEP_MS", DEFAULT_HOG_HOLD_STEP_MS);
  const cpuBurnMs = parseIntegerEnv("PHASE3_RESOURCE_CPU_BURN_MS", DEFAULT_CPU_BURN_MS);

  if (poolSize < 2) {
    throw new Error(`PHASE3_RESOURCE_POOL_SIZE must be >= 2. Received: ${poolSize}`);
  }

  const harness = startHarnessServer();
  const harnessHandle = await harness.listen();
  const remoteDebuggingPort = parseRemoteDebuggingPort();
  const versionEndpoint = `http://127.0.0.1:${remoteDebuggingPort}/json/version`;
  const electronHost = startElectronCdpHost(remoteDebuggingPort, poolSize);

  let scheduler = null;
  const statusMessages = [];
  let hogError = null;

  try {
    const wsEndpoint = await waitForWebSocketEndpoint(versionEndpoint, STARTUP_TIMEOUT_MS);
    const { createParallelTaskScheduler, createGhostTabTaskErrorDetail } = await import("../dist/index.js");

    scheduler = createParallelTaskScheduler({
      endpointURL: wsEndpoint,
      minSize: poolSize,
      maxSize: poolSize,
      connectTimeoutMs: STARTUP_TIMEOUT_MS,
      logger: (line) => console.info(`[resource-smoke] ${line}`),
      crashRecovery: {
        maxRetries: 0
      },
      resourceBudget: {
        enabled: true,
        cpuBudgetPercentPerCore: cpuBudgetPercent,
        memoryBudgetMb,
        violationWindowMs,
        sampleIntervalMs,
        enforcementMode: "KILL_TAB"
      },
      onStatusMessage: (message) => {
        statusMessages.push(message);
      },
      runTask: async ({ taskId, input, lease, cdpClient }) => {
        const startUrl = `${input.origin}/task?taskId=${encodeURIComponent(taskId)}`;
        lease.transitionTaskState("LOADING", {
          step: 1,
          url: startUrl,
          reason: "SCHEDULER_DISPATCHED"
        });
        try {
          await cdpClient.navigate(startUrl);
          const currentUrl = await cdpClient.getCurrentUrl();
          lease.transitionTaskState("PERCEIVING", {
            step: 1,
            url: currentUrl,
            reason: "NAVIGATION_COMPLETE"
          });
          lease.transitionTaskState("INFERRING", {
            step: 1,
            url: currentUrl,
            reason: "RESOURCE_BUDGET_CHECK"
          });

          if (taskId === "task-budget-hog") {
            lease.transitionTaskState("ACTING", {
              step: 1,
              url: currentUrl,
              reason: "SUSTAIN_RESOURCE_PRESSURE"
            });

            for (let index = 0; index < hogHoldIterations; index += 1) {
              await cdpClient.executeAction({
                action: "EXTRACT",
                target: null,
                text: buildCpuBurnExpression(cpuBurnMs)
              }, {
                settleTimeoutMs: 50
              });
              await sleep(hogHoldStepMs);
            }
          } else {
            lease.transitionTaskState("ACTING", {
              step: 1,
              url: currentUrl,
              reason: "SHORT_WAIT"
            });
            await cdpClient.executeAction({
              action: "WAIT",
              target: null,
              text: "1200"
            });
          }

          const finalUrl = await cdpClient.getCurrentUrl();
          lease.transitionTaskState("COMPLETE", {
            step: 3,
            url: finalUrl,
            reason: "TASK_COMPLETE"
          });
          lease.transitionTaskState("IDLE", {
            step: 3,
            url: finalUrl,
            reason: "TASK_CONTEXT_CLEANUP"
          });
          return {
            currentUrl: finalUrl
          };
        } catch (error) {
          lease.transitionTaskState("FAILED", {
            step: 1,
            url: startUrl,
            reason: "TASK_EXECUTION_FAILED",
            errorDetail: createGhostTabTaskErrorDetail({
              error,
              step: 1,
              url: startUrl,
              retryable: false
            })
          });
          lease.transitionTaskState("IDLE", {
            step: 1,
            url: startUrl,
            reason: "TASK_CONTEXT_CLEANUP"
          });
          throw error;
        }
      }
    });

    await scheduler.initialize();

    const hogTaskPromise = scheduler
      .submitTask({
        taskId: "task-budget-hog",
        priority: "BACKGROUND",
        input: {
          origin: harnessHandle.origin
        }
      })
      .catch((error) => {
        hogError = error;
        return null;
      });

    const siblingTaskResult = await scheduler.submitTask({
      taskId: "task-budget-sibling",
      priority: "BACKGROUND",
      input: {
        origin: harnessHandle.origin
      }
    });

    const hogTaskResult = await hogTaskPromise;
    assertCondition(hogTaskResult === null, "Expected task-budget-hog to fail after enforced kill.");
    assertCondition(hogError instanceof Error, "Expected task-budget-hog failure error.");

    await waitForCondition(
      async () => {
        const events = findSchedulerEvents(statusMessages, "task-budget-hog");
        const violationEvent = events.find((event) => {
          return (
            event.payload.event === "RESOURCE_BUDGET_EXCEEDED" ||
            event.payload.event === "RESOURCE_BUDGET_KILLED"
          );
        });
        return violationEvent ?? null;
      },
      WAIT_TIMEOUT_MS,
      "resource budget violation event"
    );

    const hogEvents = findSchedulerEvents(statusMessages, "task-budget-hog");
    const siblingEvents = findSchedulerEvents(statusMessages, "task-budget-sibling");
    const hogStartEvent = hogEvents.find((event) => event.payload.event === "STARTED");
    const hogViolationEvent = hogEvents.find((event) => {
      return (
        event.payload.event === "RESOURCE_BUDGET_EXCEEDED" ||
        event.payload.event === "RESOURCE_BUDGET_KILLED"
      );
    });
    const hogFailedEvent = hogEvents.find((event) => event.payload.event === "FAILED");
    const siblingSucceededEvent = siblingEvents.find((event) => event.payload.event === "SUCCEEDED");

    assertCondition(!!hogStartEvent, "Missing STARTED event for task-budget-hog.");
    assertCondition(!!hogViolationEvent, "Missing resource budget violation event for task-budget-hog.");
    assertCondition(!!hogFailedEvent, "Missing FAILED event for task-budget-hog.");
    assertCondition(!!siblingSucceededEvent, "Missing SUCCEEDED event for task-budget-sibling.");

    const hogViolationLatencyMs = Date.parse(hogViolationEvent.timestamp) - Date.parse(hogStartEvent.timestamp);
    assertCondition(
      hogViolationLatencyMs <= 10_000,
      `Resource violation should be flagged within 10s. observed=${hogViolationLatencyMs}ms`
    );

    const finalSnapshot = scheduler.getPoolSnapshot();
    assertCondition(finalSnapshot.inUse === 0, `Expected no in-use slots. actual=${finalSnapshot.inUse}`);
    assertCondition(finalSnapshot.queued === 0, `Expected queue depth 0. actual=${finalSnapshot.queued}`);

    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(
      artifactPath,
      JSON.stringify(
        {
          ok: true,
          phase: MILESTONE,
          runConfig: {
            poolSize,
            memoryBudgetMb,
            cpuBudgetPercent,
            violationWindowMs,
            sampleIntervalMs,
            cpuBurnMs,
            enforcementMode: "KILL_TAB"
          },
          acceptance: {
            violationFlaggedWithin10s: hogViolationLatencyMs <= 10_000,
            violationLatencyMs: hogViolationLatencyMs,
            hogTaskFailedAfterEnforcement: Boolean(hogFailedEvent),
            siblingTaskUnaffected: Boolean(siblingSucceededEvent),
            siblingAttemptsUsed: siblingTaskResult.attemptsUsed
          },
          events: {
            hogStartedAt: hogStartEvent.timestamp,
            hogViolationEvent: hogViolationEvent.payload.event,
            hogFailedAt: hogFailedEvent.timestamp,
            siblingSucceededAt: siblingSucceededEvent.timestamp
          },
          pool: {
            finalSnapshot,
            telemetry: scheduler.getPoolTelemetry()
          },
          harness: {
            origin: harnessHandle.origin,
            requestCount: harnessHandle.getRequestCount()
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
          violationLatencyMs: hogViolationLatencyMs,
          siblingTaskUnaffected: true
        },
        null,
        2
      )
    );
  } finally {
    if (scheduler) {
      await scheduler.shutdown().catch(() => {});
    }

    await stopElectronCdpHost(electronHost);
    await harness.close();
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
