import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REMOTE_DEBUGGING_PORT = 9333;
const POLL_INTERVAL_MS = 250;
const STARTUP_TIMEOUT_MS = 20_000;
const TARGET_URL = "https://www.google.com/";
const MILESTONE = "1.7";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const artifactDirectory = path.join(repositoryRoot, "docs", "artifacts", "phase1-1.7");
const executionArtifactPath = path.join(artifactDirectory, "google-action-execution.json");

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

function findSearchTarget(elements) {
  const prioritized = elements
    .filter((entry) => entry.boundingBox)
    .filter((entry) => {
      if (entry.role === "searchbox") return true;
      if (entry.role === "textbox" && entry.name && entry.name.toLowerCase().includes("search")) {
        return true;
      }
      return false;
    });

  if (prioritized.length === 0) {
    return null;
  }

  const box = prioritized[0].boundingBox;
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  };
}

function validateExecutionSummary(summary) {
  if (!summary.click || summary.click.status !== "acted") {
    throw new Error("CLICK action did not execute successfully.");
  }

  if (!summary.type || summary.type.status !== "acted") {
    throw new Error("TYPE action did not execute successfully.");
  }

  if (!summary.scroll || summary.scroll.status !== "acted") {
    throw new Error("SCROLL action did not execute successfully.");
  }

  if (!summary.extract || summary.extract.status !== "acted") {
    throw new Error("EXTRACT action did not execute successfully.");
  }

  if (!summary.done || summary.done.status !== "done") {
    throw new Error("DONE action did not return done status.");
  }

  const extracted = summary.extract.extractedData;
  if (!extracted || typeof extracted !== "object") {
    throw new Error("EXTRACT did not return structured data.");
  }

  const queryValue = String(extracted.query ?? "").toLowerCase();
  if (!queryValue.includes("mechanical keyboards")) {
    throw new Error(`Expected extracted query to include "mechanical keyboards", got: ${queryValue}`);
  }
}

async function main() {
  const remoteDebuggingPort = parseRemoteDebuggingPort();
  const versionEndpoint = `http://127.0.0.1:${remoteDebuggingPort}/json/version`;
  const electronHost = startElectronCdpHost(remoteDebuggingPort);

  let cdpClient = null;

  try {
    const wsEndpoint = await waitForWebSocketEndpoint(versionEndpoint, STARTUP_TIMEOUT_MS);
    const { connectToGhostTabCdp } = await import("../dist/index.js");
    cdpClient = await connectToGhostTabCdp({ endpointURL: wsEndpoint });

    await cdpClient.navigate(TARGET_URL);
    const indexResult = await cdpClient.extractInteractiveElementIndex({
      includeBoundingBoxes: true,
      charBudget: 8_000
    });

    let searchTarget = findSearchTarget(indexResult.elements);
    if (!searchTarget) {
      const fallbackTargetResult = await cdpClient.executeAction({
        action: "EXTRACT",
        target: null,
        text: `(() => {
          const el = document.querySelector('textarea[name="q"], input[name="q"], [role="searchbox"]');
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })();`
      });

      if (!fallbackTargetResult.extractedData) {
        throw new Error("Unable to locate search input target from AX index or DOM fallback.");
      }

      const targetCandidate = fallbackTargetResult.extractedData;
      if (
        typeof targetCandidate !== "object" ||
        targetCandidate === null ||
        typeof targetCandidate.x !== "number" ||
        typeof targetCandidate.y !== "number"
      ) {
        throw new Error("Fallback target extraction did not return numeric coordinates.");
      }

      searchTarget = {
        x: targetCandidate.x,
        y: targetCandidate.y
      };
    }

    const clickResult = await cdpClient.executeAction({
      action: "CLICK",
      target: searchTarget,
      text: null
    });
    const typeResult = await cdpClient.executeAction({
      action: "TYPE",
      target: null,
      text: "mechanical keyboards[Enter]"
    });
    const scrollResult = await cdpClient.executeAction({
      action: "SCROLL",
      target: null,
      text: "800"
    });
    const extractResult = await cdpClient.executeAction({
      action: "EXTRACT",
      target: null,
      text: `(() => ({
        title: document.title,
        url: window.location.href,
        query: (document.querySelector('textarea[name="q"], input[name="q"]')?.value ?? null),
        scrollY: window.scrollY
      }))();`
    });
    const doneResult = await cdpClient.executeAction({
      action: "DONE",
      target: null,
      text: "action sequence complete"
    });

    const summary = {
      click: clickResult,
      type: typeResult,
      scroll: scrollResult,
      extract: extractResult,
      done: doneResult
    };

    validateExecutionSummary(summary);

    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(
      executionArtifactPath,
      JSON.stringify(
        {
          milestone: MILESTONE,
          targetUrl: TARGET_URL,
          searchTarget,
          summary
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
          navigatedUrl: TARGET_URL,
          versionEndpoint,
          artifact: executionArtifactPath,
          finalUrl: doneResult.currentUrl,
          extracted: extractResult.extractedData
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
