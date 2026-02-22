import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REMOTE_DEBUGGING_PORT = 9333;
const DEFAULT_POOL_MIN_SIZE = 2;
const DEFAULT_POOL_MAX_SIZE = 3;
const DEFAULT_ASSIGNMENT_TARGET_MS = 10;
const POLL_INTERVAL_MS = 100;
const STARTUP_TIMEOUT_MS = 20_000;
const MILESTONE = "3.2";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const artifactDirectory = path.join(repositoryRoot, "docs", "artifacts", "phase3", "phase3-3.2");
const artifactPath = path.join(artifactDirectory, "ghost-tab-pool-result.json");

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

function assertSnapshotCounts(snapshot, expected, label) {
  if (snapshot.available !== expected.available) {
    throw new Error(
      `[${label}] expected available=${expected.available} actual=${snapshot.available}`
    );
  }

  if (snapshot.inUse !== expected.inUse) {
    throw new Error(`[${label}] expected inUse=${expected.inUse} actual=${snapshot.inUse}`);
  }

  if (snapshot.queued !== expected.queued) {
    throw new Error(`[${label}] expected queued=${expected.queued} actual=${snapshot.queued}`);
  }
}

async function main() {
  const poolMinSize = parseIntegerEnv("PHASE3_POOL_MIN_SIZE", DEFAULT_POOL_MIN_SIZE);
  const poolMaxSize = parseIntegerEnv("PHASE3_POOL_MAX_SIZE", DEFAULT_POOL_MAX_SIZE);
  const assignmentTargetMs = parseIntegerEnv(
    "PHASE3_POOL_ASSIGNMENT_TARGET_MS",
    DEFAULT_ASSIGNMENT_TARGET_MS
  );
  if (poolMinSize > poolMaxSize) {
    throw new Error(
      `PHASE3_POOL_MIN_SIZE must be <= PHASE3_POOL_MAX_SIZE. min=${poolMinSize} max=${poolMaxSize}`
    );
  }

  const remoteDebuggingPort = parseRemoteDebuggingPort();
  const versionEndpoint = `http://127.0.0.1:${remoteDebuggingPort}/json/version`;
  const electronHost = startElectronCdpHost(remoteDebuggingPort, poolMaxSize);

  let pool = null;
  const heldLeases = [];

  try {
    const wsEndpoint = await waitForWebSocketEndpoint(versionEndpoint, STARTUP_TIMEOUT_MS);
    const { createGhostTabPoolManager } = await import("../dist/index.js");

    pool = createGhostTabPoolManager({
      endpointURL: wsEndpoint,
      minSize: poolMinSize,
      maxSize: poolMaxSize,
      connectTimeoutMs: STARTUP_TIMEOUT_MS,
      logger: (line) => console.info(`[pool-smoke] ${line}`)
    });

    await pool.initialize();
    const snapshotAfterInit = pool.getSnapshot();
    assertSnapshotCounts(
      snapshotAfterInit,
      {
        available: poolMinSize,
        inUse: 0,
        queued: 0
      },
      "after-init"
    );

    const lease1 = await pool.acquireGhostTab({
      taskId: "task-1"
    });
    heldLeases.push(lease1);
    if (lease1.assignmentWaitMs > assignmentTargetMs) {
      throw new Error(
        `Warm assignment exceeded target. waitMs=${lease1.assignmentWaitMs} targetMs=${assignmentTargetMs}`
      );
    }

    const snapshotAfterReplenish = await waitForCondition(
      async () => {
        const snapshot = pool.getSnapshot();
        if (snapshot.available >= poolMinSize && snapshot.inUse === 1) {
          return snapshot;
        }
        return null;
      },
      10_000,
      "pool replenishment to minimum available slots"
    );

    const lease2 = await pool.acquireGhostTab({
      taskId: "task-2"
    });
    const lease3 = await pool.acquireGhostTab({
      taskId: "task-3"
    });
    heldLeases.push(lease2, lease3);

    const snapshotAfterExhaustion = pool.getSnapshot();
    assertSnapshotCounts(
      snapshotAfterExhaustion,
      {
        available: 0,
        inUse: poolMaxSize,
        queued: 0
      },
      "after-exhaustion"
    );

    const queuedAcquirePromise = pool.acquireGhostTab({
      taskId: "task-4",
      priority: "BACKGROUND"
    });
    await waitForCondition(
      async () => {
        const snapshot = pool.getSnapshot();
        return snapshot.queued === 1 ? snapshot : null;
      },
      5_000,
      "pool queue entry for task-4"
    );

    await lease2.release();
    const queuedLease = await queuedAcquirePromise;
    heldLeases.push(queuedLease);
    if (queuedLease.assignmentWaitMs <= 0) {
      throw new Error(
        `Expected queued task to wait before assignment. task-4 waitMs=${queuedLease.assignmentWaitMs}`
      );
    }

    await Promise.all(
      heldLeases.map(async (lease) => {
        await lease.release();
      })
    );

    const finalSnapshot = await waitForCondition(
      async () => {
        const snapshot = pool.getSnapshot();
        if (snapshot.inUse === 0 && snapshot.available >= poolMinSize && snapshot.queued === 0) {
          return snapshot;
        }
        return null;
      },
      5_000,
      "final pool idle snapshot"
    );

    const telemetry = pool.getTelemetry();
    const coldStartSavingsMs = Math.max(
      0,
      telemetry.averageWarmDurationMs - telemetry.averageWarmAssignmentWaitMs
    );

    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(
      artifactPath,
      JSON.stringify(
        {
          ok: true,
          phase: MILESTONE,
          runConfig: {
            poolMinSize,
            poolMaxSize,
            assignmentTargetMs
          },
          snapshots: {
            afterInit: snapshotAfterInit,
            afterReplenish: snapshotAfterReplenish,
            afterExhaustion: snapshotAfterExhaustion,
            final: finalSnapshot
          },
          leaseMetrics: {
            lease1WarmAssignmentWaitMs: lease1.assignmentWaitMs,
            queuedLeaseAssignmentWaitMs: queuedLease.assignmentWaitMs
          },
          telemetry: {
            ...telemetry,
            estimatedColdStartSavingsMs: Number(coldStartSavingsMs.toFixed(3))
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
          assignmentTargetMs,
          lease1WarmAssignmentWaitMs: lease1.assignmentWaitMs,
          queueingVerified: true
        },
        null,
        2
      )
    );
  } finally {
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
