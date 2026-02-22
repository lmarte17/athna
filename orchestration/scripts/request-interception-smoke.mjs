import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REMOTE_DEBUGGING_PORT = 9333;
const POLL_INTERVAL_MS = 100;
const STARTUP_TIMEOUT_MS = 20_000;
const WAIT_TIMEOUT_MS = 8_000;
const DEFAULT_RUN_COUNT = 3;
const MILESTONE = "5.1";
const MIN_EXPECTED_LOAD_REDUCTION_RATIO = 0.4;

const IMAGE_RESPONSE_DELAY_MS = 140;
const FONT_RESPONSE_DELAY_MS = 160;
const MEDIA_RESPONSE_DELAY_MS = 180;
const STYLESHEET_RESPONSE_DELAY_MS = 15;
const API_RESPONSE_DELAY_MS = 20;

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6fQAAAAASUVORK5CYII=";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const artifactDirectory = path.join(repositoryRoot, "docs", "artifacts", "phase5", "phase5-5.1");
const artifactPath = path.join(artifactDirectory, "request-interception-result.json");

const tinyImageBuffer = Buffer.from(TINY_PNG_BASE64, "base64");
const fontBuffer = Buffer.alloc(120_000, 7);
const mediaBuffer = Buffer.alloc(180_000, 19);

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

function classifyRequestKind(pathname) {
  if (pathname === "/media-heavy") {
    return "DOCUMENT";
  }
  if (pathname === "/api/data") {
    return "API";
  }
  if (pathname.startsWith("/assets/image-")) {
    return "IMAGE";
  }
  if (pathname === "/assets/styles.css") {
    return "STYLESHEET";
  }
  if (pathname === "/assets/font.woff2") {
    return "FONT";
  }
  if (pathname === "/assets/video.mp4") {
    return "MEDIA";
  }
  if (pathname === "/favicon.ico") {
    return "FAVICON";
  }

  return "OTHER";
}

function respondAfter(response, delayMs, payload) {
  setTimeout(() => {
    response.writeHead(payload.statusCode, payload.headers);
    response.end(payload.body);
  }, delayMs);
}

function createImageMarkup(runId) {
  const fragments = [];
  for (let index = 0; index < 24; index += 1) {
    const marker = index === 0 ? "primary" : `image-${index + 1}`;
    fragments.push(
      `<img data-phase51-image="${marker}" loading="eager" decoding="sync" width="320" height="200" src="/assets/image-${index + 1}.png?run=${encodeURIComponent(runId)}&asset=${index + 1}" alt="fixture-${index + 1}" />`
    );
  }

  return fragments.join("\n");
}

function createHarnessState() {
  return {
    requestLog: []
  };
}

async function startHarnessServer() {
  const state = createHarnessState();

  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = requestUrl.pathname;
    const runId = requestUrl.searchParams.get("run") ?? "none";
    const requestKind = classifyRequestKind(pathname);

    state.requestLog.push({
      runId,
      requestKind,
      pathname,
      timestamp: new Date().toISOString()
    });

    if (pathname === "/media-heavy") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store"
      });

      response.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Phase 5.1 Request Interception Harness</title>
    <link rel="stylesheet" href="/assets/styles.css?run=${encodeURIComponent(runId)}" />
    <script>
      window.__phase51Run = ${JSON.stringify(runId)};
      window.__phase51ApiPayload = null;
      window.__phase51ApiError = null;
      fetch('/api/data?run=' + encodeURIComponent(window.__phase51Run))
        .then((response) => response.json())
        .then((payload) => {
          window.__phase51ApiPayload = payload;
        })
        .catch((error) => {
          window.__phase51ApiError = String(error && error.message ? error.message : error);
        });
    </script>
  </head>
  <body>
    <h1>Phase 5.1 Request Interception Harness</h1>
    <video data-phase51-video preload="auto" muted playsinline width="320" height="180" src="/assets/video.mp4?run=${encodeURIComponent(runId)}"></video>
    <section>${createImageMarkup(runId)}</section>
  </body>
</html>`);
      return;
    }

    if (pathname === "/api/data") {
      respondAfter(response, API_RESPONSE_DELAY_MS, {
        statusCode: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store"
        },
        body: JSON.stringify({ ok: true, runId, source: "phase5.1-harness" })
      });
      return;
    }

    if (pathname === "/assets/styles.css") {
      respondAfter(response, STYLESHEET_RESPONSE_DELAY_MS, {
        statusCode: 200,
        headers: {
          "content-type": "text/css; charset=utf-8",
          "cache-control": "no-store"
        },
        body: `@font-face {
  font-family: "Phase51Fixture";
  src: url("/assets/font.woff2?run=${encodeURIComponent(runId)}") format("woff2");
}
body {
  font-family: "Phase51Fixture", sans-serif;
  background: linear-gradient(135deg, #f6f8fa 0%, #eef4ff 100%);
}
img {
  margin: 4px;
  border: 1px solid #ccd3e0;
}`
      });
      return;
    }

    if (pathname === "/assets/font.woff2") {
      respondAfter(response, FONT_RESPONSE_DELAY_MS, {
        statusCode: 200,
        headers: {
          "content-type": "font/woff2",
          "cache-control": "no-store"
        },
        body: fontBuffer
      });
      return;
    }

    if (pathname.startsWith("/assets/image-")) {
      respondAfter(response, IMAGE_RESPONSE_DELAY_MS, {
        statusCode: 200,
        headers: {
          "content-type": "image/png",
          "cache-control": "no-store"
        },
        body: tinyImageBuffer
      });
      return;
    }

    if (pathname === "/assets/video.mp4") {
      respondAfter(response, MEDIA_RESPONSE_DELAY_MS, {
        statusCode: 200,
        headers: {
          "content-type": "video/mp4",
          "cache-control": "no-store"
        },
        body: mediaBuffer
      });
      return;
    }

    if (pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }

    response.writeHead(404, {
      "content-type": "text/plain; charset=utf-8"
    });
    response.end("not-found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to resolve harness server address.");
  }

  return {
    server,
    state,
    origin: `http://127.0.0.1:${address.port}`
  };
}

async function stopHarnessServer(server) {
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

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function median(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  return sorted[mid];
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

async function evaluateExpression(cdpClient, expression) {
  const execution = await cdpClient.executeAction({
    action: "EXTRACT",
    target: null,
    text: expression
  });

  if (execution.status !== "acted") {
    throw new Error(`Expected EXTRACT action status=acted, got ${execution.status}`);
  }

  return execution.extractedData;
}

async function waitForApiResult(cdpClient, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await evaluateExpression(
      cdpClient,
      `(() => ({ payload: window.__phase51ApiPayload ?? null, error: window.__phase51ApiError ?? null }))();`
    );

    if (result?.payload || result?.error) {
      return result;
    }

    await sleep(50);
  }

  return null;
}

async function waitForPrimaryImageWidth(cdpClient, timeoutMs) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const imageState = await evaluateExpression(
      cdpClient,
      `(() => {
        const image = document.querySelector('img[data-phase51-image="primary"]');
        if (!(image instanceof HTMLImageElement)) {
          return null;
        }
        return {
          complete: image.complete,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight
        };
      })();`
    );

    if (imageState && Number(imageState.naturalWidth) > 0) {
      return imageState;
    }

    await sleep(50);
  }

  return null;
}

async function runScenario(input) {
  const { cdpClient, origin, mode, label, runCount } = input;
  const runs = [];

  for (let index = 0; index < runCount; index += 1) {
    const runId = `${label}-${index + 1}-${Date.now()}`;
    const url = `${origin}/media-heavy?run=${encodeURIComponent(runId)}`;

    await cdpClient.setRequestInterceptionMode(mode);
    cdpClient.resetRequestInterceptionMetrics();

    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    await cdpClient.navigate(url);
    const durationMs = Date.now() - startMs;
    const apiResult = await waitForApiResult(cdpClient, WAIT_TIMEOUT_MS);
    const metrics = cdpClient.getRequestInterceptionMetrics();

    runs.push({
      runId,
      startedAt,
      durationMs,
      apiResult,
      metrics
    });
  }

  const durations = runs.map((run) => run.durationMs);

  return {
    label,
    mode,
    runCount,
    medianDurationMs: median(durations),
    minDurationMs: Math.min(...durations),
    maxDurationMs: Math.max(...durations),
    runs
  };
}

function summarizeRequestsByRun(requestLog) {
  const byRun = new Map();

  for (const entry of requestLog) {
    if (!byRun.has(entry.runId)) {
      byRun.set(entry.runId, {
        total: 0,
        byKind: {}
      });
    }

    const current = byRun.get(entry.runId);
    current.total += 1;
    current.byKind[entry.requestKind] = (current.byKind[entry.requestKind] ?? 0) + 1;
  }

  return Object.fromEntries([...byRun.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

async function runVisualRenderPassValidation(cdpClient, origin) {
  const runId = `visual-pass-${Date.now()}`;
  const url = `${origin}/media-heavy?run=${encodeURIComponent(runId)}`;

  await cdpClient.setRequestInterceptionMode("AGENT_FAST");
  cdpClient.resetRequestInterceptionMetrics();

  await cdpClient.navigate(url);

  const preImageState = await evaluateExpression(
    cdpClient,
    `(() => {
      const image = document.querySelector('img[data-phase51-image="primary"]');
      if (!(image instanceof HTMLImageElement)) {
        return null;
      }
      return {
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight
      };
    })();`
  );

  const screenshot = await cdpClient.withVisualRenderPass(async () => {
    return cdpClient.captureScreenshot({ mode: "viewport" });
  });

  const postImageState = await waitForPrimaryImageWidth(cdpClient, WAIT_TIMEOUT_MS);
  const apiResult = await waitForApiResult(cdpClient, WAIT_TIMEOUT_MS);
  const metrics = cdpClient.getRequestInterceptionMetrics();

  return {
    runId,
    screenshot: {
      mode: screenshot.mode,
      width: screenshot.width,
      height: screenshot.height,
      base64Length: screenshot.base64.length
    },
    preImageState,
    postImageState,
    apiResult,
    metrics
  };
}

async function main() {
  const runCount = parseIntegerEnv("PHASE5_INTERCEPT_RUN_COUNT", DEFAULT_RUN_COUNT);
  const remoteDebuggingPort = parseRemoteDebuggingPort();
  const versionEndpoint = `http://127.0.0.1:${remoteDebuggingPort}/json/version`;
  const electronHost = startElectronCdpHost(remoteDebuggingPort);
  const harness = await startHarnessServer();

  let cdpClient = null;

  try {
    const wsEndpoint = await waitForWebSocketEndpoint(versionEndpoint, STARTUP_TIMEOUT_MS);
    const { connectToGhostTabCdp } = await import("../dist/index.js");
    cdpClient = await connectToGhostTabCdp({ endpointURL: wsEndpoint });

    const baseline = await runScenario({
      cdpClient,
      origin: harness.origin,
      mode: "VISUAL_RENDER",
      label: "baseline-visual",
      runCount
    });
    const filtered = await runScenario({
      cdpClient,
      origin: harness.origin,
      mode: "AGENT_FAST",
      label: "agent-fast",
      runCount
    });
    const visualPass = await runVisualRenderPassValidation(cdpClient, harness.origin);

    const loadReductionRatio =
      baseline.medianDurationMs > 0
        ? (baseline.medianDurationMs - filtered.medianDurationMs) / baseline.medianDurationMs
        : 0;

    assertCondition(
      loadReductionRatio >= MIN_EXPECTED_LOAD_REDUCTION_RATIO,
      `Expected >= ${(MIN_EXPECTED_LOAD_REDUCTION_RATIO * 100).toFixed(0)}% load reduction. baselineMedian=${baseline.medianDurationMs}ms filteredMedian=${filtered.medianDurationMs}ms reduction=${(loadReductionRatio * 100).toFixed(1)}%`
    );

    for (const run of baseline.runs) {
      assertCondition(
        run.metrics.lifetime.blockedRequests === 0,
        `[${run.runId}] baseline visual mode should not block requests.`
      );
      assertCondition(
        Boolean(run.apiResult?.payload?.ok),
        `[${run.runId}] baseline visual mode should keep API fetch available.`
      );
    }

    for (const run of filtered.runs) {
      assertCondition(
        run.metrics.lifetime.blockedRequests > 0,
        `[${run.runId}] AGENT_FAST mode should block at least one request.`
      );
      assertCondition(
        run.metrics.lifetime.classificationCounts.JSON_API > 0,
        `[${run.runId}] expected JSON API request classification count > 0.`
      );
      assertCondition(
        Boolean(run.apiResult?.payload?.ok),
        `[${run.runId}] AGENT_FAST mode should not block API fetches.`
      );
    }

    assertCondition(
      visualPass.screenshot.width > 0 && visualPass.screenshot.height > 0,
      "Visual render pass screenshot dimensions are invalid."
    );
    assertCondition(
      visualPass.screenshot.base64Length > 0,
      "Visual render pass screenshot payload is empty."
    );
    assertCondition(
      Number(visualPass.postImageState?.naturalWidth ?? 0) > 0,
      "Visual render pass should reload blocked images before capture."
    );
    assertCondition(
      visualPass.metrics.visualRenderPassCount === 1,
      `Expected exactly one visual render pass, got ${visualPass.metrics.visualRenderPassCount}.`
    );
    assertCondition(
      Boolean(visualPass.apiResult?.payload?.ok),
      "Visual render pass scenario should keep API fetch available."
    );

    const requestsByRun = summarizeRequestsByRun(harness.state.requestLog);

    const result = {
      ok: true,
      phase: MILESTONE,
      harnessOrigin: harness.origin,
      runCount,
      threshold: {
        minExpectedLoadReductionRatio: MIN_EXPECTED_LOAD_REDUCTION_RATIO,
        observedLoadReductionRatio: round3(loadReductionRatio)
      },
      baseline,
      filtered,
      visualPass,
      requestsByRun,
      timestamp: new Date().toISOString()
    };

    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(artifactPath, `${JSON.stringify(result, null, 2)}\n`);

    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (cdpClient) {
      await cdpClient.close().catch(() => {});
    }

    await stopHarnessServer(harness.server).catch(() => {});
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
