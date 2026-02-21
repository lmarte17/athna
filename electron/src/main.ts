import { app, BrowserWindow } from "electron";

const FOREGROUND_WINDOW_SIZE = { width: 1280, height: 900 };
const GHOST_TAB_PROTOTYPE_URL = "https://google.com/";
const SMOKE_TEST_URL = "about:blank";
const DEFAULT_REMOTE_DEBUGGING_PORT = "9333";

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
let ghostTabWindow: BrowserWindow | null = null;

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

async function createForegroundWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    ...FOREGROUND_WINDOW_SIZE,
    show: !isSmokeTest,
    title: "Ghost Browser"
  });

  await window.loadURL("about:blank");
  return window;
}

async function createGhostTab(url: string): Promise<BrowserWindow> {
  const ghostWindow = new BrowserWindow({
    ...FOREGROUND_WINDOW_SIZE,
    show: showGhostTab,
    webPreferences: showGhostTab
      ? undefined
      : {
          offscreen: true
        }
  });

  ghostWindow.webContents.on("did-finish-load", () => {
    console.info(`[ghost-tab] Navigated to ${ghostWindow.webContents.getURL()}`);
  });

  ghostWindow.webContents.on("did-fail-load", (...args) => {
    const [, errorCode, errorDescription, validatedURL] = args;
    console.error(
      `[ghost-tab] Failed to load ${validatedURL}: (${String(errorCode)}) ${String(errorDescription)}`
    );
  });

  await ghostWindow.loadURL(url);
  return ghostWindow;
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
  ghostTabWindow = await createGhostTab(ghostTabUrl);
  ghostTabWindow.on("closed", () => {
    ghostTabWindow = null;
  });

  if (isCdpHost) {
    const remoteDebugPort = getRemoteDebuggingPort();
    if (remoteDebugPort) {
      console.info(`[electron] CDP host listening on http://127.0.0.1:${remoteDebugPort}/json/version`);
    }
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
  app.quit();
});
