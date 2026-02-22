import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REMOTE_DEBUGGING_PORT = 9333;
const DEFAULT_POOL_SIZE = 3;
const POLL_INTERVAL_MS = 100;
const STARTUP_TIMEOUT_MS = 20_000;
const WAIT_TIMEOUT_MS = 20_000;
const MILESTONE = "3.7";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const artifactDirectory = path.join(repositoryRoot, "docs", "artifacts", "phase3", "phase3-3.7");
const artifactPath = path.join(artifactDirectory, "crash-recovery-result.json");

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
    const attempt = requestUrl.searchParams.get("attempt") ?? "unknown";
    response.statusCode = 200;
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(
      [
        "<!doctype html>",
        "<html>",
        `<head><title>Phase 3.7 Task ${taskId}</title></head>`,
        "<body>",
        `<main data-task-id=\"${taskId}\" data-attempt=\"${attempt}\">crash recovery harness</main>`,
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

function countSchedulerEvents(statusMessages, taskId, eventName) {
  return findSchedulerEvents(statusMessages, taskId).filter((message) => {
    return message.payload.event === eventName;
  }).length;
}

function shouldForceRendererCrash(mode, attempt) {
  if (mode === "CRASH_ONCE_THEN_SUCCEED") {
    return attempt === 1;
  }
  if (mode === "ALWAYS_CRASH") {
    return attempt === 1;
  }
  return false;
}

function shouldForceTargetClosure(mode, attempt) {
  return mode === "ALWAYS_CRASH" && attempt >= 2;
}

function isParallelExecutionError(value) {
  return value && typeof value === "object" && value.name === "ParallelTaskExecutionError";
}

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${String(timeoutMs)}ms while waiting for ${label}`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function main() {
  const poolSize = parseIntegerEnv("PHASE3_CRASH_POOL_SIZE", DEFAULT_POOL_SIZE);
  const maxRetries = parseIntegerEnv("PHASE3_CRASH_MAX_RETRIES", 2);

  if (poolSize < 2) {
    throw new Error(`PHASE3_CRASH_POOL_SIZE must be >= 2. Received: ${poolSize}`);
  }

  const harness = startHarnessServer();
  const harnessHandle = await harness.listen();
  const remoteDebuggingPort = parseRemoteDebuggingPort();
  const versionEndpoint = `http://127.0.0.1:${remoteDebuggingPort}/json/version`;
  const electronHost = startElectronCdpHost(remoteDebuggingPort, poolSize);

  let scheduler = null;
  const statusMessages = [];
  let exhaustError = null;

  try {
    const wsEndpoint = await waitForWebSocketEndpoint(versionEndpoint, STARTUP_TIMEOUT_MS);
    const {
      createParallelTaskScheduler,
      createGhostTabTaskErrorDetail,
      ParallelTaskExecutionError
    } = await import("../dist/index.js");

    scheduler = createParallelTaskScheduler({
      endpointURL: wsEndpoint,
      minSize: poolSize,
      maxSize: poolSize,
      connectTimeoutMs: STARTUP_TIMEOUT_MS,
      logger: (line) => console.info(`[crash-smoke] ${line}`),
      crashRecovery: {
        maxRetries
      },
      resourceBudget: {
        enabled: false
      },
      onStatusMessage: (message) => {
        statusMessages.push(message);
      },
      runTask: async ({ taskId, input, attempt, lease, cdpClient }) => {
        const startUrl =
          `${input.origin}/task` +
          `?taskId=${encodeURIComponent(taskId)}` +
          `&attempt=${String(attempt)}`;
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
            reason: "CRASH_RECOVERY_CHECK"
          });

          if (shouldForceRendererCrash(input.mode, attempt)) {
            lease.transitionTaskState("ACTING", {
              step: 1,
              url: currentUrl,
              reason: "SIMULATE_RENDERER_CRASH"
            });
            await withTimeout(
              cdpClient.crashRendererForTesting(),
              2_000,
              `renderer crash trigger for ${taskId} attempt ${String(attempt)}`
            );
            await sleep(200);

            // Probe current URL after the forced crash so this attempt fails immediately.
            await withTimeout(
              cdpClient.getCurrentUrl(),
              1_000,
              `renderer crash probe for ${taskId} attempt ${String(attempt)}`
            );
            throw new Error(
              `Expected renderer crash to close target for task ${taskId} attempt ${String(attempt)}`
            );
          }

          if (shouldForceTargetClosure(input.mode, attempt)) {
            lease.transitionTaskState("ACTING", {
              step: 1,
              url: currentUrl,
              reason: "FORCE_TARGET_CLOSURE_RETRY_EXHAUSTION"
            });
            await withTimeout(
              cdpClient.closeTarget(),
              2_000,
              `target close for retry exhaustion ${taskId} attempt ${String(attempt)}`
            );
            throw new Error(
              `Target closed during crash-retry exhaustion for task ${taskId} attempt ${String(attempt)}`
            );
          }

          lease.transitionTaskState("ACTING", {
            step: 1,
            url: currentUrl,
            reason: "STABLE_WAIT"
          });
          await cdpClient.executeAction({
            action: "WAIT",
            target: null,
            text: "300"
          });

          const finalUrl = await cdpClient.getCurrentUrl();
          lease.transitionTaskState("COMPLETE", {
            step: 2,
            url: finalUrl,
            reason: "TASK_COMPLETE"
          });
          lease.transitionTaskState("IDLE", {
            step: 2,
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
              retryable: true
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

    const [recoverResult, siblingResult] = await Promise.all([
      scheduler.submitTask({
        taskId: "task-crash-recover",
        priority: "BACKGROUND",
        input: {
          origin: harnessHandle.origin,
          mode: "CRASH_ONCE_THEN_SUCCEED"
        }
      }),
      scheduler.submitTask({
        taskId: "task-crash-sibling",
        priority: "BACKGROUND",
        input: {
          origin: harnessHandle.origin,
          mode: "STABLE"
        }
      })
    ]);

    const exhaustResult = await scheduler
      .submitTask({
        taskId: "task-crash-exhaust",
        priority: "BACKGROUND",
        input: {
          origin: harnessHandle.origin,
          mode: "ALWAYS_CRASH"
        }
      })
      .catch((error) => {
        exhaustError = error;
        return null;
      });

    assertCondition(recoverResult.attemptsUsed === 2, "Expected task-crash-recover to succeed on retry.");
    assertCondition(
      recoverResult.attempts.length === 2 &&
        recoverResult.attempts[0].status === "FAILED" &&
        recoverResult.attempts[0].crashDetected &&
        recoverResult.attempts[1].status === "SUCCEEDED",
      "Expected task-crash-recover attempts to show one crash failure then success."
    );

    assertCondition(siblingResult.attemptsUsed === 1, "Expected sibling task to complete in one attempt.");
    assertCondition(exhaustResult === null, "Expected task-crash-exhaust to fail after retries.");
    assertCondition(
      isParallelExecutionError(exhaustError),
      "Expected task-crash-exhaust to throw ParallelTaskExecutionError."
    );
    assertCondition(
      exhaustError instanceof ParallelTaskExecutionError,
      "Expected task-crash-exhaust to throw a scheduler execution error."
    );
    assertCondition(
      exhaustError.attemptsUsed === maxRetries + 1,
      `Expected task-crash-exhaust attemptsUsed=${String(maxRetries + 1)}. actual=${String(exhaustError.attemptsUsed)}`
    );
    assertCondition(
      exhaustError.attempts.every((attempt) => attempt.crashDetected && attempt.status === "FAILED"),
      "Expected every exhausted attempt to be a crash-detected failure."
    );

    await waitForCondition(
      async () => {
        const recoverEvents = findSchedulerEvents(statusMessages, "task-crash-recover");
        const retryingEvent = recoverEvents.find((event) => event.payload.event === "RETRYING");
        const succeededEvent = recoverEvents.find((event) => event.payload.event === "SUCCEEDED");
        return retryingEvent && succeededEvent ? { retryingEvent, succeededEvent } : null;
      },
      WAIT_TIMEOUT_MS,
      "retry and success events for task-crash-recover"
    );

    const recoverEvents = findSchedulerEvents(statusMessages, "task-crash-recover");
    const siblingEvents = findSchedulerEvents(statusMessages, "task-crash-sibling");
    const exhaustEvents = findSchedulerEvents(statusMessages, "task-crash-exhaust");

    const recoverCrashDetectedCount = countSchedulerEvents(
      statusMessages,
      "task-crash-recover",
      "CRASH_DETECTED"
    );
    const recoverRetryingCount = countSchedulerEvents(statusMessages, "task-crash-recover", "RETRYING");
    const recoverSucceededCount = countSchedulerEvents(
      statusMessages,
      "task-crash-recover",
      "SUCCEEDED"
    );
    const siblingSucceededCount = countSchedulerEvents(
      statusMessages,
      "task-crash-sibling",
      "SUCCEEDED"
    );
    const exhaustCrashDetectedCount = countSchedulerEvents(
      statusMessages,
      "task-crash-exhaust",
      "CRASH_DETECTED"
    );
    const exhaustRetryingCount = countSchedulerEvents(statusMessages, "task-crash-exhaust", "RETRYING");
    const exhaustFailedCount = countSchedulerEvents(statusMessages, "task-crash-exhaust", "FAILED");

    assertCondition(
      recoverCrashDetectedCount >= 1,
      "Expected at least one CRASH_DETECTED event for task-crash-recover."
    );
    assertCondition(
      recoverRetryingCount >= 1,
      "Expected at least one RETRYING event for task-crash-recover."
    );
    assertCondition(recoverSucceededCount === 1, "Expected one SUCCEEDED event for task-crash-recover.");
    assertCondition(siblingSucceededCount === 1, "Expected one SUCCEEDED event for task-crash-sibling.");
    assertCondition(
      exhaustCrashDetectedCount === maxRetries + 1,
      `Expected crash-detected count=${String(maxRetries + 1)} for task-crash-exhaust. actual=${String(exhaustCrashDetectedCount)}`
    );
    assertCondition(
      exhaustRetryingCount === maxRetries,
      `Expected retrying count=${String(maxRetries)} for task-crash-exhaust. actual=${String(exhaustRetryingCount)}`
    );
    assertCondition(exhaustFailedCount === 1, "Expected one FAILED event for task-crash-exhaust.");

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
            maxRetries
          },
          acceptance: {
            crashTriggersRetry: recoverRetryingCount >= 1,
            retrySucceedsOnFreshAttempt: recoverResult.attemptsUsed === 2,
            retriesExhaustAtConfiguredLimit: exhaustError.attemptsUsed === maxRetries + 1,
            cleanFailureAfterExhaustion: exhaustFailedCount === 1,
            siblingTaskUnaffected: siblingSucceededCount === 1
          },
          tasks: {
            recover: {
              attemptsUsed: recoverResult.attemptsUsed,
              attempts: recoverResult.attempts.map((attempt) => ({
                attempt: attempt.attempt,
                contextId: attempt.contextId,
                status: attempt.status,
                crashDetected: attempt.crashDetected
              }))
            },
            sibling: {
              attemptsUsed: siblingResult.attemptsUsed
            },
            exhaust: {
              attemptsUsed: exhaustError.attemptsUsed,
              attempts: exhaustError.attempts.map((attempt) => ({
                attempt: attempt.attempt,
                contextId: attempt.contextId,
                status: attempt.status,
                crashDetected: attempt.crashDetected
              })),
              error: {
                type: exhaustError.errorDetail.type,
                message: exhaustError.errorDetail.message,
                retryable: exhaustError.errorDetail.retryable
              }
            }
          },
          schedulerEvents: {
            recover: recoverEvents.map((event) => event.payload.event),
            sibling: siblingEvents.map((event) => event.payload.event),
            exhaust: exhaustEvents.map((event) => event.payload.event)
          },
          counters: {
            recoverCrashDetectedCount,
            recoverRetryingCount,
            recoverSucceededCount,
            siblingSucceededCount,
            exhaustCrashDetectedCount,
            exhaustRetryingCount,
            exhaustFailedCount
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
          recoverAttemptsUsed: recoverResult.attemptsUsed,
          exhaustAttemptsUsed: exhaustError.attemptsUsed
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
