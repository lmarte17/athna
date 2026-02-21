import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REMOTE_DEBUGGING_PORT = 9333;
const POLL_INTERVAL_MS = 250;
const STARTUP_TIMEOUT_MS = 20_000;
const TARGET_URL = "https://www.allbirds.com/products/mens-tree-runners";
const MILESTONE = "1.5";
const CHAR_BUDGET = 8_000;
const REQUIRED_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "combobox",
  "checkbox",
  "radio",
  "menuitem",
  "tab",
  "searchbox",
  "spinbutton",
  "slider",
  "switch"
]);

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const artifactDirectory = path.join(repositoryRoot, "docs", "artifacts", "phase1-1.5");
const interactiveIndexPath = path.join(artifactDirectory, "allbirds-interactive-index.json");
const normalizedTreePath = path.join(artifactDirectory, "allbirds-normalized-ax-tree.json");

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

function validateInteractiveIndex(indexResult) {
  if (!Array.isArray(indexResult.elements) || indexResult.elements.length === 0) {
    throw new Error("Interactive element index is empty.");
  }

  if (indexResult.indexCharCount >= indexResult.normalizedCharCount) {
    throw new Error(
      `Interactive index should be smaller than normalized tree (${indexResult.indexCharCount} >= ${indexResult.normalizedCharCount}).`
    );
  }

  const invalidRole = indexResult.elements.find((entry) => !REQUIRED_ROLES.has(entry.role));
  if (invalidRole) {
    throw new Error(`Unexpected role in interactive index: ${invalidRole.role}`);
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
    const indexResult = await cdpClient.extractInteractiveElementIndex({
      charBudget: CHAR_BUDGET,
      includeBoundingBoxes: true
    });

    validateInteractiveIndex(indexResult);

    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(interactiveIndexPath, indexResult.json);
    await writeFile(normalizedTreePath, indexResult.normalizedAXTree.json);

    const withinTypicalRange = indexResult.elementCount >= 20 && indexResult.elementCount <= 80;

    console.log(
      JSON.stringify(
        {
          ok: true,
          phase: MILESTONE,
          navigatedUrl: TARGET_URL,
          versionEndpoint,
          artifacts: {
            interactiveIndex: interactiveIndexPath,
            normalizedAXTree: normalizedTreePath
          },
          elementCount: indexResult.elementCount,
          normalizedNodeCount: indexResult.normalizedNodeCount,
          indexCharCount: indexResult.indexCharCount,
          normalizedCharCount: indexResult.normalizedCharCount,
          sizeRatio: indexResult.sizeRatio,
          withinTypicalRange,
          normalizationDurationMs: indexResult.normalizedAXTree.normalizationDurationMs,
          exceededNormalizationTimeBudget:
            indexResult.normalizedAXTree.exceededNormalizationTimeBudget
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
