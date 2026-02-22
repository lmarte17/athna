import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REMOTE_DEBUGGING_PORT = 9333;
const DEFAULT_POOL_SIZE = 6;
const DEFAULT_TASK_HOLD_MS = 1500;
const DEFAULT_QUEUED_TASK_HOLD_MS = 400;
const POLL_INTERVAL_MS = 100;
const STARTUP_TIMEOUT_MS = 20_000;
const QUEUE_TIMEOUT_MS = 15_000;
const MILESTONE = "3.5";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const artifactDirectory = path.join(repositoryRoot, "docs", "artifacts", "phase3", "phase3-3.5");
const artifactPath = path.join(artifactDirectory, "parallel-task-scheduling-queue-result.json");

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
        `<head><title>Phase 3.5 Task ${taskId}</title></head>`,
        "<body>",
        `<main data-task-id=\"${taskId}\">parallel task scheduling harness</main>`,
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

function toTaskResultMap(results) {
  const map = new Map();
  for (const result of results) {
    map.set(result.taskId, result);
  }
  return map;
}

function parseQueueDispatchEvents(statusMessages) {
  return statusMessages.filter((message) => {
    if (message.type !== "TASK_STATUS") {
      return false;
    }
    if (message.payload.kind !== "QUEUE") {
      return false;
    }
    return message.payload.event === "DISPATCHED";
  });
}

async function main() {
  const poolSize = parseIntegerEnv("PHASE3_PARALLEL_POOL_SIZE", DEFAULT_POOL_SIZE);
  const taskHoldMs = parseIntegerEnv("PHASE3_PARALLEL_TASK_HOLD_MS", DEFAULT_TASK_HOLD_MS);
  const queuedTaskHoldMs = parseIntegerEnv(
    "PHASE3_PARALLEL_QUEUED_TASK_HOLD_MS",
    DEFAULT_QUEUED_TASK_HOLD_MS
  );

  if (poolSize < 2) {
    throw new Error(`PHASE3_PARALLEL_POOL_SIZE must be >= 2. Received: ${poolSize}`);
  }

  const harness = startHarnessServer();
  const harnessHandle = await harness.listen();
  const remoteDebuggingPort = parseRemoteDebuggingPort();
  const versionEndpoint = `http://127.0.0.1:${remoteDebuggingPort}/json/version`;
  const electronHost = startElectronCdpHost(remoteDebuggingPort, poolSize);

  let scheduler = null;
  const statusMessages = [];

  try {
    const wsEndpoint = await waitForWebSocketEndpoint(versionEndpoint, STARTUP_TIMEOUT_MS);
    const {
      createParallelTaskScheduler,
      createGhostTabTaskErrorDetail
    } = await import("../dist/index.js");

    scheduler = createParallelTaskScheduler({
      endpointURL: wsEndpoint,
      minSize: poolSize,
      maxSize: poolSize,
      connectTimeoutMs: STARTUP_TIMEOUT_MS,
      logger: (line) => console.info(`[scheduler-smoke] ${line}`),
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
            reason: "SIMPLE_HOLD"
          });
          lease.transitionTaskState("ACTING", {
            step: 1,
            url: currentUrl,
            reason: "WAIT"
          });
          await cdpClient.executeAction({
            action: "WAIT",
            target: null,
            text: String(input.holdMs)
          });
          lease.transitionTaskState("COMPLETE", {
            step: 1,
            url: currentUrl,
            reason: "WAIT_COMPLETE"
          });
          lease.transitionTaskState("IDLE", {
            step: 1,
            url: currentUrl,
            reason: "TASK_CONTEXT_CLEANUP"
          });

          return {
            currentUrl,
            holdMs: input.holdMs
          };
        } catch (error) {
          lease.transitionTaskState("FAILED", {
            step: 1,
            url: startUrl,
            reason: "TASK_EXECUTION_FAILED",
            errorDetail: createGhostTabTaskErrorDetail({
              error,
              step: 1,
              url: startUrl
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

    const baseTasks = Array.from({ length: poolSize }, (_, index) => ({
      taskId: `task-${index + 1}`,
      priority: "BACKGROUND",
      input: {
        origin: harnessHandle.origin,
        holdMs: taskHoldMs
      }
    }));

    const baseTaskPromises = baseTasks.map((task) => scheduler.submitTask(task));
    await waitForCondition(
      async () => {
        const snapshot = scheduler.getPoolSnapshot();
        if (snapshot.inUse === poolSize && snapshot.queued === 0) {
          return snapshot;
        }
        return null;
      },
      QUEUE_TIMEOUT_MS,
      `${poolSize} concurrent tasks`
    );

    const queuedBackgroundPromise = scheduler.submitTask({
      taskId: "task-7",
      priority: "BACKGROUND",
      input: {
        origin: harnessHandle.origin,
        holdMs: queuedTaskHoldMs
      }
    });
    await waitForCondition(
      async () => {
        const snapshot = scheduler.getPoolSnapshot();
        return snapshot.queued >= 1 ? snapshot : null;
      },
      QUEUE_TIMEOUT_MS,
      "7th task queueing"
    );

    const queuedForegroundPromise = scheduler.submitTask({
      taskId: "task-8",
      priority: "FOREGROUND",
      input: {
        origin: harnessHandle.origin,
        holdMs: queuedTaskHoldMs
      }
    });
    await waitForCondition(
      async () => {
        const snapshot = scheduler.getPoolSnapshot();
        return snapshot.queued >= 2 ? snapshot : null;
      },
      QUEUE_TIMEOUT_MS,
      "foreground priority queue insertion"
    );

    await waitForCondition(
      async () => {
        const dispatchEvents = parseQueueDispatchEvents(statusMessages).filter((event) => {
          return (
            event.payload.wasQueued &&
            (event.taskId === "task-7" || event.taskId === "task-8")
          );
        });
        return dispatchEvents.length >= 2 ? dispatchEvents : null;
      },
      QUEUE_TIMEOUT_MS,
      "queued task dispatch order"
    );

    const completedTasks = await Promise.all([
      ...baseTaskPromises,
      queuedBackgroundPromise,
      queuedForegroundPromise
    ]);
    const completedByTaskId = toTaskResultMap(completedTasks);

    const queueEvents = statusMessages.filter((message) => {
      return message.type === "TASK_STATUS" && message.payload.kind === "QUEUE";
    });
    const queueDispatchEvents = parseQueueDispatchEvents(statusMessages);
    const queuedDispatchEvents = queueDispatchEvents.filter((event) => {
      return (
        event.payload.wasQueued &&
        (event.taskId === "task-7" || event.taskId === "task-8")
      );
    });
    const queuedDispatchOrder = queuedDispatchEvents.map((event) => event.taskId);
    const foregroundDispatchIndex = queuedDispatchOrder.indexOf("task-8");
    const backgroundDispatchIndex = queuedDispatchOrder.indexOf("task-7");
    const maxConcurrentInUse = queueEvents.reduce((max, event) => {
      return Math.max(max, event.payload.inUse);
    }, 0);
    const maxQueueDepth = queueEvents.reduce((max, event) => {
      return Math.max(max, event.payload.queueDepth);
    }, 0);

    const task7Result = completedByTaskId.get("task-7");
    const task8Result = completedByTaskId.get("task-8");
    assertCondition(!!task7Result, "Missing result for task-7.");
    assertCondition(!!task8Result, "Missing result for task-8.");
    assertCondition(maxConcurrentInUse >= poolSize, `Expected max concurrent inUse >= ${poolSize}.`);
    assertCondition(task7Result.assignmentWaitMs > 0, "Expected task-7 to wait in queue.");
    assertCondition(
      foregroundDispatchIndex !== -1 && backgroundDispatchIndex !== -1,
      "Missing dispatch records for queued foreground/background tasks."
    );
    assertCondition(
      foregroundDispatchIndex < backgroundDispatchIndex,
      `Expected foreground task dispatch before background task. order=${queuedDispatchOrder.join(" -> ")}`
    );

    const finalSnapshot = scheduler.getPoolSnapshot();
    const telemetry = scheduler.getPoolTelemetry();
    assertCondition(finalSnapshot.inUse === 0, `Expected no in-use slots. actual=${finalSnapshot.inUse}`);
    assertCondition(finalSnapshot.queued === 0, `Expected empty queue. actual=${finalSnapshot.queued}`);

    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(
      artifactPath,
      JSON.stringify(
        {
          ok: true,
          phase: MILESTONE,
          runConfig: {
            poolSize,
            taskHoldMs,
            queuedTaskHoldMs
          },
          acceptance: {
            concurrentSlotsTarget: poolSize,
            observedMaxConcurrentInUse: maxConcurrentInUse,
            seventhTaskQueued: task7Result.assignmentWaitMs > 0,
            priorityPreemptionVerified: foregroundDispatchIndex < backgroundDispatchIndex,
            queuedDispatchOrder
          },
          queueMetrics: {
            maxQueueDepth,
            task7AssignmentWaitMs: task7Result.assignmentWaitMs,
            task8AssignmentWaitMs: task8Result.assignmentWaitMs,
            averageQueueWaitMs: telemetry.averageQueueWaitMs
          },
          harness: {
            origin: harnessHandle.origin,
            requestCount: harnessHandle.getRequestCount()
          },
          telemetry,
          finalSnapshot
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
          observedMaxConcurrentInUse: maxConcurrentInUse,
          queuedDispatchOrder
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
