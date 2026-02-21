import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REMOTE_DEBUGGING_PORT = 9333;
const POLL_INTERVAL_MS = 250;
const STARTUP_TIMEOUT_MS = 20_000;
const MILESTONE = "1.8";
const TASK_INTENT = "search for mechanical keyboards";
const TASK_START_URL = "https://www.google.com/";
const TASK_MAX_STEPS = 20;

function parseUseToonEncoding() {
  const raw = process.env.USE_TOON_ENCODING;
  if (!raw) {
    return true;
  }

  const normalized = raw.trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  return true;
}

const USE_TOON_ENCODING = parseUseToonEncoding();

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const artifactDirectory = path.join(repositoryRoot, "docs", "artifacts", "phase1", "phase1-1.8");
const artifactPath = path.join(
  artifactDirectory,
  USE_TOON_ENCODING ? "google-loop-result-toon.json" : "google-loop-result.json"
);

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

function validateLoopResult(loopResult) {
  if (!loopResult || typeof loopResult !== "object") {
    throw new Error("Loop result missing.");
  }

  if (!Array.isArray(loopResult.history) || loopResult.history.length === 0) {
    throw new Error("Loop history is empty.");
  }

  if (loopResult.stepsTaken > TASK_MAX_STEPS) {
    throw new Error(`Loop exceeded max steps (${loopResult.stepsTaken} > ${TASK_MAX_STEPS}).`);
  }

  if (!["DONE", "FAILED", "MAX_STEPS"].includes(loopResult.status)) {
    throw new Error(`Unexpected loop status: ${String(loopResult.status)}`);
  }
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
    const loop = createPerceptionActionLoop({
      cdpClient,
      navigatorEngine: navigator,
      maxSteps: TASK_MAX_STEPS,
      logger: (line) => console.info(line)
    });

    const loopResult = await loop.runTask({
      intent: TASK_INTENT,
      startUrl: TASK_START_URL,
      maxSteps: TASK_MAX_STEPS
    });

    validateLoopResult(loopResult);

    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(
      artifactPath,
      JSON.stringify(
        {
          ...loopResult,
          runConfig: {
            useToonEncoding: USE_TOON_ENCODING
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
          intent: TASK_INTENT,
          startUrl: TASK_START_URL,
          finalStatus: loopResult.status,
          stepsTaken: loopResult.stepsTaken,
          finalUrl: loopResult.finalUrl,
          useToonEncoding: USE_TOON_ENCODING,
          artifact: artifactPath
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
