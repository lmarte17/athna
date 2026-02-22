import { app, BrowserWindow } from "electron";

import { GhostContextManager } from "./ghost-context-manager.js";

const FOREGROUND_WINDOW_SIZE = { width: 1280, height: 900 };
const GHOST_TAB_PROTOTYPE_URL = "https://google.com/";
const SMOKE_TEST_URL = "about:blank";
const DEFAULT_REMOTE_DEBUGGING_PORT = "9333";
const DEFAULT_GHOST_CONTEXT_COUNT = 1;

const isSmokeTest = app.commandLine.hasSwitch("smoke-test");
const keepAlive = app.commandLine.hasSwitch("keep-alive");
const isCdpHost = app.commandLine.hasSwitch("cdp-host");
const showGhostTab = app.commandLine.hasSwitch("show-ghost-tab");

if (isCdpHost) {
  app.disableHardwareAcceleration();

  if (!app.commandLine.hasSwitch("disable-gpu")) {
    app.commandLine.appendSwitch("disable-gpu");
  }

  if (!app.commandLine.hasSwitch("remote-debugging-port")) {
    const requestedPort = process.env.GHOST_REMOTE_DEBUGGING_PORT ?? DEFAULT_REMOTE_DEBUGGING_PORT;
    app.commandLine.appendSwitch("remote-debugging-port", requestedPort);
  }
}

let foregroundWindow: BrowserWindow | null = null;
let ghostContextManager: GhostContextManager | null = null;
let isQuitting = false;
let cleanupInProgress = false;
let cleanupCompleted = false;

function getRemoteDebuggingPort(): string | null {
  const configuredPort = app.commandLine.getSwitchValue("remote-debugging-port");
  return configuredPort.length > 0 ? configuredPort : null;
}

function logHeadlessModeStatus(): void {
  const headlessMode = app.commandLine.getSwitchValue("headless");

  if (headlessMode === "new") {
    console.info("[electron] Chromium launched with --headless=new.");
    return;
  }

  console.info(
    "[electron] Running in standard mode. Pass --headless=new to validate Chromium headless mode."
  );
}

function parsePositiveIntegerEnv(name: string, defaultValue: number): number {
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

function parseBooleanEnv(name: string, defaultValue: boolean): boolean {
  const rawValue = process.env[name];
  if (!rawValue || !rawValue.trim()) {
    return defaultValue;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`${name} must be a boolean-like value. Received: ${rawValue}`);
}

function buildGhostContextBootstrapUrl(baseUrl: string, contextId: string): string {
  if (baseUrl.startsWith("about:blank")) {
    return `about:blank#ghost-context=${contextId}`;
  }

  try {
    const parsed = new URL(baseUrl);
    parsed.hash = `ghost-context=${contextId}`;
    return parsed.toString();
  } catch {
    return `${baseUrl}#ghost-context=${contextId}`;
  }
}

async function createForegroundWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    ...FOREGROUND_WINDOW_SIZE,
    show: !isSmokeTest,
    title: "Ghost Browser"
  });

  await window.loadURL("about:blank");
  return window;
}

async function bootstrap(): Promise<void> {
  logHeadlessModeStatus();

  if (!isCdpHost) {
    foregroundWindow = await createForegroundWindow();
    foregroundWindow.on("closed", () => {
      foregroundWindow = null;
    });
  }

  const ghostTabUrl = isCdpHost || isSmokeTest ? SMOKE_TEST_URL : GHOST_TAB_PROTOTYPE_URL;
  const ghostContextCount = parsePositiveIntegerEnv(
    "GHOST_CONTEXT_COUNT",
    DEFAULT_GHOST_CONTEXT_COUNT
  );
  const autoReplenish = parseBooleanEnv("GHOST_CONTEXT_AUTO_REPLENISH", false);

  ghostContextManager = new GhostContextManager({
    contextCount: ghostContextCount,
    autoReplenish,
    defaultSize: FOREGROUND_WINDOW_SIZE,
    showGhostTab,
    initialUrlForContext: (contextId) => buildGhostContextBootstrapUrl(ghostTabUrl, contextId),
    logger: (line) => console.info(line)
  });
  await ghostContextManager.initialize();

  if (isCdpHost) {
    const remoteDebugPort = getRemoteDebuggingPort();
    if (remoteDebugPort) {
      console.info(`[electron] CDP host listening on http://127.0.0.1:${remoteDebugPort}/json/version`);
    }
    const contextSummaries = ghostContextManager.listContexts();
    console.info(
      `[electron] Ghost contexts ready count=${contextSummaries.length} autoReplenish=${autoReplenish}`
    );
  }

  if (isSmokeTest && !keepAlive) {
    app.quit();
  }
}

app.whenReady().then(() => {
  void bootstrap().catch((error: unknown) => {
    console.error("[electron] Bootstrap failed.", error);
    app.exit(1);
  });
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void bootstrap().catch((error: unknown) => {
      console.error("[electron] Bootstrap failed on activate.", error);
      app.exit(1);
    });
  }
});

app.on("window-all-closed", () => {
  if (isCdpHost && keepAlive && !isQuitting) {
    return;
  }
  app.quit();
});

app.on("before-quit", (event) => {
  isQuitting = true;

  if (cleanupCompleted || cleanupInProgress || !ghostContextManager) {
    return;
  }

  cleanupInProgress = true;
  event.preventDefault();

  void ghostContextManager
    .shutdown()
    .catch((error: unknown) => {
      console.error("[electron] Ghost context shutdown failed.", error);
    })
    .finally(() => {
      cleanupInProgress = false;
      cleanupCompleted = true;
      ghostContextManager = null;
      app.quit();
    });
});
