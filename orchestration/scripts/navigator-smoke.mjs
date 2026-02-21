import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REMOTE_DEBUGGING_PORT = 9333;
const POLL_INTERVAL_MS = 250;
const STARTUP_TIMEOUT_MS = 20_000;
const TARGET_URL = "https://www.google.com/";
const MILESTONE = "1.6";

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
const artifactDirectory = path.join(repositoryRoot, "docs", "artifacts", "phase1", "phase1-1.6");
const decisionArtifactPath = path.join(
  artifactDirectory,
  USE_TOON_ENCODING
    ? "google-mechanical-keyboards-action-toon.json"
    : "google-mechanical-keyboards-action.json"
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

function validateNavigatorDecision(decision) {
  if (!decision || typeof decision !== "object") {
    throw new Error("Navigator decision is missing.");
  }

  if (decision.action !== "CLICK") {
    throw new Error(`Expected first action CLICK on Google homepage, received ${String(decision.action)}.`);
  }

  if (!decision.target || typeof decision.target.x !== "number" || typeof decision.target.y !== "number") {
    throw new Error("CLICK decision requires numeric target coordinates.");
  }

  if (typeof decision.confidence !== "number" || decision.confidence < 0 || decision.confidence > 1) {
    throw new Error("Decision confidence must be a number between 0 and 1.");
  }

  if (decision.confidence < 0.9) {
    throw new Error(`Expected confidence >= 0.9 for Google search box, received ${decision.confidence}.`);
  }
}

async function main() {
  const remoteDebuggingPort = parseRemoteDebuggingPort();
  const versionEndpoint = `http://127.0.0.1:${remoteDebuggingPort}/json/version`;
  const electronHost = startElectronCdpHost(remoteDebuggingPort);

  let cdpClient = null;

  try {
    const wsEndpoint = await waitForWebSocketEndpoint(versionEndpoint, STARTUP_TIMEOUT_MS);
    const { connectToGhostTabCdp, createNavigatorEngine } = await import("../dist/index.js");
    cdpClient = await connectToGhostTabCdp({ endpointURL: wsEndpoint });

    await cdpClient.navigate(TARGET_URL);
    const indexResult = await cdpClient.extractInteractiveElementIndex({
      charBudget: 8_000,
      includeBoundingBoxes: true
    });
    const rawNormalizedTree = indexResult.normalizedAXTree.nodes;
    const rawNormalizedTreeCharCount = JSON.stringify(rawNormalizedTree).length;
    let normalizedAXTreeForNavigator = rawNormalizedTree;

    if (USE_TOON_ENCODING) {
      const toonEncoderModule = await import("../src/ax-tree/toon-encoder.js");
      const encodeNormalizedAxTreeToon =
        toonEncoderModule.encodeNormalizedAxTreeToon ??
        toonEncoderModule.default?.encodeNormalizedAxTreeToon;

      if (typeof encodeNormalizedAxTreeToon !== "function") {
        throw new Error("Unable to resolve encodeNormalizedAxTreeToon from toon-encoder module.");
      }

      normalizedAXTreeForNavigator = encodeNormalizedAxTreeToon(rawNormalizedTree);
    }

    const navigatorNormalizedTreeCharCount = JSON.stringify(normalizedAXTreeForNavigator).length;

    const navigator = createNavigatorEngine();
    const decision = await navigator.decideNextAction({
      intent: "search for mechanical keyboards",
      observation: {
        currentUrl: TARGET_URL,
        interactiveElementIndex: indexResult.elements,
        normalizedAXTree: normalizedAXTreeForNavigator
      }
    });

    validateNavigatorDecision(decision);

    const artifactPayload = {
      milestone: MILESTONE,
      url: TARGET_URL,
      intent: "search for mechanical keyboards",
      decision,
      runConfig: {
        useToonEncoding: USE_TOON_ENCODING
      },
      contextStats: {
        interactiveElementCount: indexResult.elementCount,
        indexCharCount: indexResult.indexCharCount,
        normalizedCharCount: indexResult.normalizedCharCount,
        rawNormalizedTreeCharCount,
        navigatorNormalizedTreeCharCount
      }
    };

    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(decisionArtifactPath, JSON.stringify(artifactPayload, null, 2));

    console.log(
      JSON.stringify(
        {
          ok: true,
          phase: MILESTONE,
          navigatedUrl: TARGET_URL,
          versionEndpoint,
          artifact: decisionArtifactPath,
          useToonEncoding: USE_TOON_ENCODING,
          action: decision.action,
          confidence: decision.confidence,
          target: decision.target,
          reasoning: decision.reasoning
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
