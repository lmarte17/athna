import { app, BrowserWindow } from "electron";

const FOREGROUND_WINDOW_SIZE = { width: 1280, height: 900 };
const GHOST_TAB_PROTOTYPE_URL = "https://example.com/";
const SMOKE_TEST_URL = "about:blank";

const isSmokeTest = app.commandLine.hasSwitch("smoke-test");

let foregroundWindow: BrowserWindow | null = null;
let ghostTabWindow: BrowserWindow | null = null;

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

async function createHeadlessGhostTab(url: string): Promise<BrowserWindow> {
  const ghostWindow = new BrowserWindow({
    ...FOREGROUND_WINDOW_SIZE,
    show: false,
    webPreferences: {
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

  foregroundWindow = await createForegroundWindow();
  foregroundWindow.on("closed", () => {
    foregroundWindow = null;
  });

  const ghostTabUrl = isSmokeTest ? SMOKE_TEST_URL : GHOST_TAB_PROTOTYPE_URL;
  ghostTabWindow = await createHeadlessGhostTab(ghostTabUrl);
  ghostTabWindow.on("closed", () => {
    ghostTabWindow = null;
  });

  if (isSmokeTest) {
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
