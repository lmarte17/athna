/**
 * Phase 6.6: Task Cancellation — Smoke Test
 *
 * Validates the pool-level contract that underlies WorkspaceController.cancelTask():
 * a ghost context lease can be released early (simulating task cancellation), the
 * pool self-heals, and a subsequent task can run successfully on the replenished pool.
 *
 * Phase 6.6 adds:
 *   - `WorkspaceController.cancelTask(taskId)` — marks the task CANCELLED, destroys its
 *     ghost BrowserContext via `GhostContextManager.destroyContext()`, and freezes the
 *     partial result snapshot (currentUrl, progressLabel, currentAction).
 *   - `workspace:cancel-task` IPC channel — renderer-triggered cancel.
 *   - Cancel buttons on every QUEUED/RUNNING ghost chip and status feed item.
 *
 * This script validates the foundational pool behaviour:
 *   1. A lease is acquired and the ghost context navigates (simulating task start).
 *   2. A screenshot is captured before release — the "partial result evidence".
 *   3. The lease is released early without completing the task (simulating cancel).
 *   4. The pool replenishes back to the configured size (autoReplenish=true).
 *   5. A second task runs successfully on the replenished pool.
 *
 * Checks verified:
 *   - ghostContextAcquiredForTask    Pool leases a context successfully
 *   - partialScreenshotCaptured      CDP screenshot before cancel is a valid JPEG ≥ 4 KB
 *   - earlyReleaseCompletedWithoutError  lease.release() before task finishes doesn't throw
 *   - poolReplenishedAfterCancel     Pool reaches available >= 2, inUse === 0 after replenish
 *   - secondTaskRunsAfterCancel      Second acquire + navigate + screenshot succeeds
 *   - poolReturnedToIdle             Final state: inUse === 0, available >= 1, queued === 0
 *
 * Run:
 *   npm run cancellation:smoke -w @ghost-browser/orchestration
 *
 * Environment:
 *   GHOST_REMOTE_DEBUGGING_PORT  CDP port (default: 9333)
 *   GHOST_HEADFUL                Set to "true" to show ghost windows during run
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REMOTE_DEBUGGING_PORT = 9333;
const GHOST_CONTEXT_COUNT = 2;
const POLL_INTERVAL_MS = 100;
const STARTUP_TIMEOUT_MS = 20_000;
const NAVIGATION_TIMEOUT_MS = 15_000;
const REPLENISH_WAIT_TIMEOUT_MS = 15_000;
const MILESTONE = "6.6";

// Min JPEG byte length that indicates actual rendered content (not a blank frame).
// A 1280×900 solid-colour JPEG at quality=80 is ~12 KB; we use a conservative 4 KB floor.
const MIN_SCREENSHOT_BYTES = 4_096;

// Data-URL pages — no network required.
const TASK_PAGE_URL =
  "data:text/html,<html><body style='background:%23f0e8d0;font:48px sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'><div>Cancellation Task</div></body></html>";
const SECOND_TASK_URL =
  "data:text/html,<html><body style='background:%23d0e8f0;font:48px sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'><div>Second Task After Cancel</div></body></html>";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const artifactDirectory = path.join(
  repositoryRoot,
  "docs",
  "artifacts",
  "phase6",
  "phase6-6.6"
);
const artifactPath = path.join(artifactDirectory, "task-cancellation-result.json");
const partialScreenshotPath = path.join(artifactDirectory, "partial-result-screenshot.jpg");

// ── Helpers ──────────────────────────────────────────────────────────────────

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
      GHOST_REMOTE_DEBUGGING_PORT: String(remoteDebuggingPort),
      GHOST_CONTEXT_COUNT: String(GHOST_CONTEXT_COUNT),
      // autoReplenish must be true so the pool self-heals after an early lease release.
      GHOST_CONTEXT_AUTO_REPLENISH: "true"
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

      reject(
        new Error(
          `Process exited unexpectedly with code=${String(code)} signal=${String(signal)}`
        )
      );
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

/**
 * Returns true if the buffer starts with the JPEG Start-of-Image marker (0xFF 0xD8 0xFF).
 */
function isJpegBuffer(buffer) {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const remoteDebuggingPort = parseRemoteDebuggingPort();
  const versionEndpoint = `http://127.0.0.1:${remoteDebuggingPort}/json/version`;
  const electronHost = startElectronCdpHost(remoteDebuggingPort);

  let pool = null;
  const heldLeases = [];

  try {
    // ── 1. Wait for CDP host ────────────────────────────────────────────────
    const wsEndpoint = await waitForWebSocketEndpoint(versionEndpoint, STARTUP_TIMEOUT_MS);

    const { createGhostTabPoolManager } = await import("../dist/index.js");

    pool = createGhostTabPoolManager({
      endpointURL: wsEndpoint,
      minSize: GHOST_CONTEXT_COUNT,
      maxSize: GHOST_CONTEXT_COUNT,
      connectTimeoutMs: STARTUP_TIMEOUT_MS,
      logger: (line) => console.info(`[cancellation-smoke] ${line}`)
    });

    await pool.initialize();

    const snapshotAfterInit = pool.getSnapshot();
    if (snapshotAfterInit.available !== GHOST_CONTEXT_COUNT) {
      throw new Error(
        `Expected ${GHOST_CONTEXT_COUNT} available slots after init, got ${snapshotAfterInit.available}`
      );
    }

    // ── 2. Acquire Ghost context, navigate — simulates task starting ────────
    const lease1 = await pool.acquireGhostTab({ taskId: "cancel-task-1" });
    heldLeases.push(lease1);

    const ghostContextAcquiredForTask = Boolean(lease1.contextId);

    await lease1.cdpClient.navigate(TASK_PAGE_URL, NAVIGATION_TIMEOUT_MS);

    // ── 3. Capture partial result screenshot (evidence of work done so far) ─
    const partialShot = await lease1.cdpClient.captureScreenshot({ mode: "viewport", quality: 80 });
    const partialBuf = Buffer.from(partialShot.base64, "base64");

    const partialScreenshotCaptured =
      isJpegBuffer(partialBuf) && partialBuf.length >= MIN_SCREENSHOT_BYTES;

    if (!partialScreenshotCaptured) {
      throw new Error(
        `Partial screenshot validation failed. bytes=${partialBuf.length} isJpeg=${isJpegBuffer(partialBuf)}`
      );
    }

    // ── 4. Simulate cancellation: release lease early (task not yet done) ───
    // This mirrors what WorkspaceController.cancelTask() triggers at the pool level.
    // In the live app, GhostContextManager.destroyContext() closes the BrowserWindow,
    // which makes the pool slot transition through COLD → REPLENISHING → AVAILABLE.
    // Here, we release the lease early to exercise the same pool-recovery path.
    let earlyReleaseCompletedWithoutError = false;
    try {
      await lease1.release();
      heldLeases.splice(heldLeases.indexOf(lease1), 1);
      earlyReleaseCompletedWithoutError = true;
    } catch (releaseError) {
      console.warn(`[cancellation-smoke] Early release error (non-fatal): ${String(releaseError)}`);
      heldLeases.splice(heldLeases.indexOf(lease1), 1);
    }

    const snapshotAfterCancel = pool.getSnapshot();

    // ── 5. Wait for pool to replenish ────────────────────────────────────────
    // With autoReplenish=true the pool creates a fresh context to replace the
    // released slot, restoring available count to the configured minimum.
    const replenishedSnapshot = await waitForCondition(
      async () => {
        const snap = pool.getSnapshot();
        if (snap.available >= GHOST_CONTEXT_COUNT && snap.inUse === 0 && snap.queued === 0) {
          return snap;
        }
        return null;
      },
      REPLENISH_WAIT_TIMEOUT_MS,
      `pool to replenish to ${GHOST_CONTEXT_COUNT} available slots`
    );

    const poolReplenishedAfterCancel = replenishedSnapshot.available >= GHOST_CONTEXT_COUNT;

    // ── 6. Run a second task to confirm pool is healthy after cancellation ───
    const lease2 = await pool.acquireGhostTab({ taskId: "cancel-task-2" });
    heldLeases.push(lease2);

    await lease2.cdpClient.navigate(SECOND_TASK_URL, NAVIGATION_TIMEOUT_MS);
    const secondShot = await lease2.cdpClient.captureScreenshot({ mode: "viewport", quality: 80 });
    const secondBuf = Buffer.from(secondShot.base64, "base64");

    const secondTaskRunsAfterCancel =
      isJpegBuffer(secondBuf) && secondBuf.length >= MIN_SCREENSHOT_BYTES;

    if (!secondTaskRunsAfterCancel) {
      throw new Error(
        `Second task screenshot validation failed. bytes=${secondBuf.length} isJpeg=${isJpegBuffer(secondBuf)}`
      );
    }

    await lease2.release();
    heldLeases.splice(heldLeases.indexOf(lease2), 1);

    // ── 7. Verify final pool state ────────────────────────────────────────────
    const finalSnapshot = await waitForCondition(
      async () => {
        const snap = pool.getSnapshot();
        if (snap.inUse === 0 && snap.available >= 1 && snap.queued === 0) {
          return snap;
        }
        return null;
      },
      5_000,
      "pool to return to idle after second task"
    );

    const poolReturnedToIdle = finalSnapshot.inUse === 0;

    // ── 8. Assemble checks ────────────────────────────────────────────────────
    const checks = {
      ghostContextAcquiredForTask,
      partialScreenshotCaptured,
      earlyReleaseCompletedWithoutError,
      poolReplenishedAfterCancel,
      secondTaskRunsAfterCancel,
      poolReturnedToIdle
    };

    const allPassed = Object.values(checks).every(Boolean);

    // ── 9. Write artifacts ─────────────────────────────────────────────────
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(partialScreenshotPath, partialBuf);

    await writeFile(
      artifactPath,
      JSON.stringify(
        {
          ok: allPassed,
          phase: MILESTONE,
          validatedAt: new Date().toISOString(),
          runConfig: {
            remoteDebuggingPort,
            ghostContextCount: GHOST_CONTEXT_COUNT,
            autoReplenish: true,
            mode: process.env.GHOST_HEADFUL === "true" ? "headful" : "headless",
            runtime: "live-electron"
          },
          checks,
          evidence: {
            cancelledTask: {
              contextId: lease1.contextId,
              taskId: "cancel-task-1",
              url: TASK_PAGE_URL.slice(0, 80) + "…",
              partialScreenshotBytes: partialBuf.length,
              partialScreenshotMimeType: partialShot.mimeType,
              partialScreenshotPath
            },
            secondTask: {
              contextId: lease2.contextId,
              taskId: "cancel-task-2",
              url: SECOND_TASK_URL.slice(0, 80) + "…",
              screenshotBytes: secondBuf.length
            },
            poolSnapshots: {
              afterInit: snapshotAfterInit,
              afterCancel: snapshotAfterCancel,
              afterReplenish: replenishedSnapshot,
              final: finalSnapshot
            }
          }
        },
        null,
        2
      )
    );

    console.log(
      JSON.stringify(
        {
          ok: allPassed,
          phase: MILESTONE,
          artifact: artifactPath,
          checksVerified: Object.values(checks).filter(Boolean).length,
          checksTotal: Object.keys(checks).length,
          partialScreenshotBytes: partialBuf.length,
          poolReplenishedAvailable: replenishedSnapshot.available
        },
        null,
        2
      )
    );
  } finally {
    // Release any still-held leases before shutting down to avoid pool teardown warnings.
    if (heldLeases.length > 0) {
      await Promise.allSettled(heldLeases.map((l) => l.release()));
    }

    if (pool) {
      await pool.shutdown().catch(() => {});
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
