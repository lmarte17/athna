import path from "node:path";

import { app, BrowserWindow, type BrowserWindowConstructorOptions } from "electron";

import { GhostContextManager } from "./ghost-context-manager.js";
import { WorkspaceController } from "./workspace-controller.js";

const FOREGROUND_WINDOW_SIZE = { width: 1280, height: 900 };
const GHOST_TAB_PROTOTYPE_URL = "https://google.com/";
const SMOKE_TEST_URL = "about:blank";
const DEFAULT_REMOTE_DEBUGGING_PORT = "9333";
const DEFAULT_GHOST_CONTEXT_COUNT = 1;
const FOREGROUND_SHELL_HTML_PATH = path.resolve(__dirname, "..", "src", "renderer", "index.html");
const PRELOAD_SCRIPT_PATH = path.resolve(__dirname, "preload.js");
const ROOT_ENV_PATH = path.resolve(__dirname, "..", "..", ".env");
const ROOT_ENV_LOCAL_PATH = path.resolve(__dirname, "..", "..", ".env.local");

loadWorkspaceEnvFile(ROOT_ENV_PATH);
loadWorkspaceEnvFile(ROOT_ENV_LOCAL_PATH);

const isSmokeTest = app.commandLine.hasSwitch("smoke-test");
const keepAlive = app.commandLine.hasSwitch("keep-alive");
const isCdpHost = app.commandLine.hasSwitch("cdp-host");
const showGhostTab = app.commandLine.hasSwitch("show-ghost-tab");

if (!app.commandLine.hasSwitch("remote-debugging-port")) {
  const requestedPort = process.env.GHOST_REMOTE_DEBUGGING_PORT ?? DEFAULT_REMOTE_DEBUGGING_PORT;
  app.commandLine.appendSwitch("remote-debugging-port", requestedPort);
}

if (isCdpHost) {
  app.disableHardwareAcceleration();

  if (!app.commandLine.hasSwitch("disable-gpu")) {
    app.commandLine.appendSwitch("disable-gpu");
  }
}

let foregroundWindow: BrowserWindow | null = null;
let ghostContextManager: GhostContextManager | null = null;
let workspaceController: WorkspaceController | null = null;
let isQuitting = false;
let cleanupInProgress = false;
let cleanupCompleted = false;

function loadWorkspaceEnvFile(filePath: string): void {
  const loadEnvFile =
    (process as NodeJS.Process & { loadEnvFile?: (path?: string) => void }).loadEnvFile ?? null;
  if (!loadEnvFile) {
    return;
  }

  try {
    loadEnvFile(filePath);
  } catch (error) {
    const errorWithCode = error as NodeJS.ErrnoException;
    if (errorWithCode.code !== "ENOENT") {
      console.warn(
        `[electron] Failed to load env file ${filePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

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

function createForegroundWindow(): BrowserWindow {
  const windowOptions: BrowserWindowConstructorOptions = {
    ...FOREGROUND_WINDOW_SIZE,
    show: !isSmokeTest,
    title: "Ghost Browser"
  };

  if (!isSmokeTest) {
    windowOptions.webPreferences = {
      preload: PRELOAD_SCRIPT_PATH,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    };
  }

  return new BrowserWindow(windowOptions);
}

async function bootstrap(): Promise<void> {
  logHeadlessModeStatus();

  if (!isCdpHost) {
    foregroundWindow = createForegroundWindow();

    if (!isSmokeTest) {
      const remoteDebuggingPort = getRemoteDebuggingPort() ?? DEFAULT_REMOTE_DEBUGGING_PORT;
      workspaceController = new WorkspaceController({
        window: foregroundWindow,
        remoteDebuggingPort,
        ghostPageCapturer: async (contextId) =>
          ghostContextManager?.captureGhostPage(contextId) ?? null,
        ghostContextViewResolver: (contextId) =>
          ghostContextManager?.getContextView(contextId) ?? null,
        ghostContextDestroyer: async (contextId) => {
          if (ghostContextManager) {
            await ghostContextManager.destroyContext(contextId, true);
          }
        },
        logger: (line) => console.info(line)
      });
      workspaceController.initialize();
      await foregroundWindow.loadFile(FOREGROUND_SHELL_HTML_PATH);
      workspaceController.emitState();
    } else {
      await foregroundWindow.loadURL(SMOKE_TEST_URL);
    }

    foregroundWindow.on("closed", () => {
      const latestController = workspaceController;
      workspaceController = null;
      if (latestController) {
        void latestController.shutdown().catch((error: unknown) => {
          console.error("[electron] Workspace shutdown failed on window close.", error);
        });
      }
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

  if (cleanupCompleted || cleanupInProgress) {
    return;
  }

  cleanupInProgress = true;
  event.preventDefault();

  const cleanupTasks: Promise<unknown>[] = [];
  const latestWorkspaceController = workspaceController;
  const latestGhostContextManager = ghostContextManager;
  workspaceController = null;
  ghostContextManager = null;

  if (latestWorkspaceController) {
    cleanupTasks.push(
      latestWorkspaceController.shutdown().catch((error: unknown) => {
        console.error("[electron] Workspace shutdown failed.", error);
      })
    );
  }

  if (latestGhostContextManager) {
    cleanupTasks.push(
      latestGhostContextManager.shutdown().catch((error: unknown) => {
        console.error("[electron] Ghost context shutdown failed.", error);
      })
    );
  }

  void Promise.allSettled(cleanupTasks).finally(() => {
    cleanupInProgress = false;
    cleanupCompleted = true;
    app.quit();
  });
});
