/**
 * Phase 6.5: Ghost Tab Visibility — Smoke Test
 *
 * Validates that ghost contexts can render content and be captured as screenshots,
 * which is the foundational capability for the read-only PiP viewer added in Phase 6.5.
 *
 * Phase 6.5 adds `GhostContextManager.captureGhostPage()` (Electron-level, using
 * `webContents.capturePage()`) and the `workspace:get-task-screenshot` IPC channel.
 * Both mechanisms rely on the ghost BrowserWindow rendering pages correctly.
 *
 * This script validates that capability at the orchestration/CDP level, proving
 * that ghost contexts produce distinct, non-trivial screenshots for each context.
 *
 * Checks verified:
 *   - ghostContextScreenshotCapture  Ghost CDP screenshot returns valid base64 data
 *   - screenshotIsValidJpeg          Buffer starts with JPEG magic bytes (0xFF 0xD8 0xFF)
 *   - screenshotDimensionsMatch      Width and height match the ghost window size (1280×900)
 *   - screenshotIsNonTrivial         Rendered content is larger than a blank-page threshold
 *   - multipleContextsIsolated       Two ghost tabs produce distinct screenshot data
 *   - poolReturnedToIdle             Pool is clean after both leases are released
 *
 * Run:
 *   npm run ghost-visibility:smoke -w @ghost-browser/orchestration
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
const MILESTONE = "6.5";

// Min JPEG byte length that indicates actual rendered content (not a blank frame).
// A 1280×900 solid-white JPEG at quality=80 is ~12 KB; we use a conservative 4 KB floor.
const MIN_SCREENSHOT_BYTES = 4_096;
const EXPECTED_WIDTH = 1280;
const EXPECTED_HEIGHT = 900;

// Two data-URL pages with visually distinct backgrounds — no network required.
const CONTEXT_1_URL =
  "data:text/html,<html><body style='background:%23e8f4f8;font:48px sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'><div>Ghost Context 1</div></body></html>";
const CONTEXT_2_URL =
  "data:text/html,<html><body style='background:%231a1a2e;color:%23e0e0ff;font:48px sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'><div>Ghost Context 2</div></body></html>";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const artifactDirectory = path.join(
  repositoryRoot,
  "docs",
  "artifacts",
  "phase6",
  "phase6-6.5"
);
const artifactPath = path.join(artifactDirectory, "ghost-tab-visibility-result.json");
const screenshot1Path = path.join(artifactDirectory, "ghost-context-1-screenshot.jpg");
const screenshot2Path = path.join(artifactDirectory, "ghost-context-2-screenshot.jpg");

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
      logger: (line) => console.info(`[visibility-smoke] ${line}`)
    });

    await pool.initialize();

    const snapshotAfterInit = pool.getSnapshot();
    if (snapshotAfterInit.available !== GHOST_CONTEXT_COUNT) {
      throw new Error(
        `Expected ${GHOST_CONTEXT_COUNT} available slots after init, got ${snapshotAfterInit.available}`
      );
    }

    // ── 2. Acquire Ghost context 1, navigate, capture screenshot ───────────
    const lease1 = await pool.acquireGhostTab({ taskId: "visibility-task-1" });
    heldLeases.push(lease1);

    await lease1.cdpClient.navigate(CONTEXT_1_URL, NAVIGATION_TIMEOUT_MS);

    const shot1 = await lease1.cdpClient.captureScreenshot({ mode: "viewport", quality: 80 });
    const buf1 = Buffer.from(shot1.base64, "base64");

    // ── 3. Acquire Ghost context 2, navigate, capture screenshot ───────────
    const lease2 = await pool.acquireGhostTab({ taskId: "visibility-task-2" });
    heldLeases.push(lease2);

    await lease2.cdpClient.navigate(CONTEXT_2_URL, NAVIGATION_TIMEOUT_MS);

    const shot2 = await lease2.cdpClient.captureScreenshot({ mode: "viewport", quality: 80 });
    const buf2 = Buffer.from(shot2.base64, "base64");

    // ── 4. Evaluate checks ─────────────────────────────────────────────────
    const screenshotIsValidJpeg = isJpegBuffer(buf1) && isJpegBuffer(buf2);
    const screenshotDimensionsMatch =
      shot1.width === EXPECTED_WIDTH &&
      shot1.height === EXPECTED_HEIGHT &&
      shot2.width === EXPECTED_WIDTH &&
      shot2.height === EXPECTED_HEIGHT;
    const screenshotIsNonTrivial =
      buf1.length >= MIN_SCREENSHOT_BYTES && buf2.length >= MIN_SCREENSHOT_BYTES;
    // The two contexts have different background colours; their screenshots must differ.
    const multipleContextsIsolated = shot1.base64 !== shot2.base64;
    const ghostContextScreenshotCapture =
      shot1.base64.length > 0 && shot2.base64.length > 0;

    if (!screenshotIsValidJpeg) {
      throw new Error(
        `Screenshot JPEG validation failed. buf1[0-2]=${buf1.slice(0, 3).toString("hex")} buf2[0-2]=${buf2.slice(0, 3).toString("hex")}`
      );
    }
    if (!screenshotDimensionsMatch) {
      throw new Error(
        `Screenshot dimension mismatch. ctx1=${shot1.width}×${shot1.height} ctx2=${shot2.width}×${shot2.height} expected=${EXPECTED_WIDTH}×${EXPECTED_HEIGHT}`
      );
    }
    if (!screenshotIsNonTrivial) {
      throw new Error(
        `Screenshot too small — likely a blank frame. buf1=${buf1.length}B buf2=${buf2.length}B min=${MIN_SCREENSHOT_BYTES}B`
      );
    }
    if (!multipleContextsIsolated) {
      throw new Error(
        "Both ghost contexts produced identical screenshots — isolation check failed."
      );
    }

    // ── 5. Release leases and verify pool returns to idle ──────────────────
    await Promise.all(heldLeases.map((l) => l.release()));
    heldLeases.length = 0;

    const finalSnapshot = await waitForCondition(
      async () => {
        const snap = pool.getSnapshot();
        if (snap.inUse === 0 && snap.available >= GHOST_CONTEXT_COUNT && snap.queued === 0) {
          return snap;
        }
        return null;
      },
      5_000,
      "pool to return to idle after releases"
    );

    const poolReturnedToIdle = finalSnapshot.inUse === 0;

    const checks = {
      ghostContextScreenshotCapture,
      screenshotIsValidJpeg,
      screenshotDimensionsMatch,
      screenshotIsNonTrivial,
      multipleContextsIsolated,
      poolReturnedToIdle
    };

    const allPassed = Object.values(checks).every(Boolean);

    // ── 6. Write artifacts ─────────────────────────────────────────────────
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(screenshot1Path, buf1);
    await writeFile(screenshot2Path, buf2);

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
            mode: process.env.GHOST_HEADFUL === "true" ? "headful" : "headless",
            runtime: "live-electron"
          },
          checks,
          evidence: {
            context1: {
              contextId: lease1.contextId,
              url: CONTEXT_1_URL.slice(0, 80) + "…",
              screenshotBytes: buf1.length,
              screenshotMimeType: shot1.mimeType,
              width: shot1.width,
              height: shot1.height,
              screenshotPath: screenshot1Path
            },
            context2: {
              contextId: lease2.contextId,
              url: CONTEXT_2_URL.slice(0, 80) + "…",
              screenshotBytes: buf2.length,
              screenshotMimeType: shot2.mimeType,
              width: shot2.width,
              height: shot2.height,
              screenshotPath: screenshot2Path
            },
            poolSnapshots: {
              afterInit: snapshotAfterInit,
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
          context1ScreenshotBytes: buf1.length,
          context2ScreenshotBytes: buf2.length,
          isolationVerified: multipleContextsIsolated
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
