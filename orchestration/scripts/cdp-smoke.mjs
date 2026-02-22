import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REMOTE_DEBUGGING_PORT = 9333;
const POLL_INTERVAL_MS = 250;
const STARTUP_TIMEOUT_MS = 20_000;
const TARGET_URL = "https://www.lithosgraphein.com/";
const EXPECTED_WIDTH = 1280;
const EXPECTED_HEIGHT = 900;
const MILESTONE = "1.3";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const artifactDirectory = path.join(repositoryRoot, "docs", "artifacts", "phase1-1.3");
const viewportScreenshotPath = path.join(artifactDirectory, "lithosgraphein-viewport.jpg");
const fullPageScreenshotPath = path.join(artifactDirectory, "lithosgraphein-full-page.jpg");
const cappedFullPageScreenshotPath = path.join(artifactDirectory, "lithosgraphein-full-page-capped.jpg");

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

function assertJpegBuffer(buffer) {
  if (buffer.length < 4) {
    throw new Error("Screenshot buffer is too small to be a valid JPEG.");
  }

  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error("Screenshot buffer does not start with JPEG magic bytes (FF D8).");
  }

  if (buffer[buffer.length - 2] !== 0xff || buffer[buffer.length - 1] !== 0xd9) {
    throw new Error("Screenshot buffer does not end with JPEG magic bytes (FF D9).");
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
    const viewportScreenshot = await cdpClient.captureScreenshot({
      mode: "viewport",
      quality: 80,
      fromSurface: true
    });
    const fullPageScreenshot = await cdpClient.captureScreenshot({
      mode: "full-page",
      quality: 80,
      fromSurface: true
    });
    const cappedFullPageScreenshot = await cdpClient.captureScreenshot({
      mode: "full-page",
      quality: 80,
      fromSurface: true,
      maxScrollSteps: 1
    });

    const viewportBuffer = Buffer.from(viewportScreenshot.base64, "base64");
    const fullPageBuffer = Buffer.from(fullPageScreenshot.base64, "base64");
    const cappedFullPageBuffer = Buffer.from(cappedFullPageScreenshot.base64, "base64");

    assertJpegBuffer(viewportBuffer);
    assertJpegBuffer(fullPageBuffer);
    assertJpegBuffer(cappedFullPageBuffer);

    if (viewportScreenshot.width !== EXPECTED_WIDTH || viewportScreenshot.height !== EXPECTED_HEIGHT) {
      throw new Error(
        `Expected viewport screenshot dimensions ${EXPECTED_WIDTH}x${EXPECTED_HEIGHT}, got ${viewportScreenshot.width}x${viewportScreenshot.height}`
      );
    }

    if (fullPageScreenshot.height <= viewportScreenshot.height) {
      throw new Error(
        `Expected full-page screenshot to be taller than viewport (${viewportScreenshot.height}px), got ${fullPageScreenshot.height}px`
      );
    }

    if (fullPageScreenshot.scrollSteps > 8) {
      throw new Error(`Full-page screenshot exceeded max scroll steps: ${fullPageScreenshot.scrollSteps}`);
    }

    if (cappedFullPageScreenshot.scrollSteps > 1) {
      throw new Error(
        `Capped full-page screenshot exceeded maxScrollSteps=1 (actual=${cappedFullPageScreenshot.scrollSteps}).`
      );
    }

    if (fullPageScreenshot.scrollSteps > 1 && !cappedFullPageScreenshot.truncated) {
      throw new Error(
        "Expected capped full-page screenshot to report truncated=true when the page requires more than one scroll step."
      );
    }

    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(viewportScreenshotPath, viewportBuffer);
    await writeFile(fullPageScreenshotPath, fullPageBuffer);
    await writeFile(cappedFullPageScreenshotPath, cappedFullPageBuffer);

    console.log(
      JSON.stringify(
        {
          ok: true,
          phase: MILESTONE,
          navigatedUrl: TARGET_URL,
          versionEndpoint,
          artifacts: {
            viewport: viewportScreenshotPath,
            fullPage: fullPageScreenshotPath,
            fullPageCapped: cappedFullPageScreenshotPath
          },
          viewportResult: {
            bytes: viewportBuffer.length,
            width: viewportScreenshot.width,
            height: viewportScreenshot.height,
            mode: viewportScreenshot.mode
          },
          fullPageResult: {
            bytes: fullPageBuffer.length,
            width: fullPageScreenshot.width,
            height: fullPageScreenshot.height,
            mode: fullPageScreenshot.mode,
            scrollSteps: fullPageScreenshot.scrollSteps,
            capturedSegments: fullPageScreenshot.capturedSegments,
            truncated: fullPageScreenshot.truncated
          },
          cappedFullPageResult: {
            bytes: cappedFullPageBuffer.length,
            width: cappedFullPageScreenshot.width,
            height: cappedFullPageScreenshot.height,
            mode: cappedFullPageScreenshot.mode,
            scrollSteps: cappedFullPageScreenshot.scrollSteps,
            capturedSegments: cappedFullPageScreenshot.capturedSegments,
            truncated: cappedFullPageScreenshot.truncated
          },
          viewport: cdpClient.getViewport()
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
