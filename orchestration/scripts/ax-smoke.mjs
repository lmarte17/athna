import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REMOTE_DEBUGGING_PORT = 9333;
const POLL_INTERVAL_MS = 250;
const STARTUP_TIMEOUT_MS = 20_000;
const TARGET_URL = "https://www.wikipedia.org/";
const MILESTONE = "1.4";
const CHAR_BUDGET = 8_000;
const TIME_BUDGET_MS = 15;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const artifactDirectory = path.join(repositoryRoot, "docs", "artifacts", "phase1-1.4");
const normalizedTreePath = path.join(artifactDirectory, "wikipedia-normalized-ax-tree.json");

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
  return spawn("npm", ["run", "cdp:host", "-w", "@ghost-browser/electron"], {
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

function validateNormalizedAXTree(result) {
  if (!Array.isArray(result.nodes) || result.nodes.length === 0) {
    throw new Error("Normalized AX tree is empty.");
  }

  if (result.interactiveNodeCount <= 0) {
    throw new Error("Expected at least one interactive element in normalized AX tree.");
  }

  const disallowedRoles = new Set(["generic", "none", "presentation", "inlinetextbox"]);
  const offendingRole = result.nodes.find((node) => disallowedRoles.has(node.role));
  if (offendingRole) {
    throw new Error(`Found pruned AX role in normalized output: ${offendingRole.role}`);
  }

  if (result.normalizedCharCount > CHAR_BUDGET) {
    throw new Error(
      `Normalized AX tree exceeds ${CHAR_BUDGET} chars (${result.normalizedCharCount}).`
    );
  }
}

async function main() {
  const remoteDebuggingPort = parseRemoteDebuggingPort();
  const versionEndpoint = `http://127.0.0.1:${remoteDebuggingPort}/json/version`;
  const electronHost = startElectronCdpHost(remoteDebuggingPort);

  let cdpClient = null;

  try {
    const wsEndpoint = await waitForWebSocketEndpoint(versionEndpoint, STARTUP_TIMEOUT_MS);
    const { connectToGhostTabCdp } = await import("../dist/cdp/client.js");
    cdpClient = await connectToGhostTabCdp({ endpointURL: wsEndpoint });

    await cdpClient.navigate(TARGET_URL);
    const axTree = await cdpClient.extractNormalizedAXTree({
      charBudget: CHAR_BUDGET,
      normalizationTimeBudgetMs: TIME_BUDGET_MS,
      includeBoundingBoxes: true
    });

    validateNormalizedAXTree(axTree);

    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(normalizedTreePath, axTree.json);

    console.log(
      JSON.stringify(
        {
          ok: true,
          phase: MILESTONE,
          navigatedUrl: TARGET_URL,
          versionEndpoint,
          artifact: normalizedTreePath,
          rawNodeCount: axTree.rawNodeCount,
          normalizedNodeCount: axTree.normalizedNodeCount,
          interactiveNodeCount: axTree.interactiveNodeCount,
          normalizedCharCount: axTree.normalizedCharCount,
          normalizationDurationMs: axTree.normalizationDurationMs,
          exceededCharBudget: axTree.exceededCharBudget,
          exceededNormalizationTimeBudget: axTree.exceededNormalizationTimeBudget,
          truncated: axTree.truncated
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
