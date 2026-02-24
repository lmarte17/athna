#!/usr/bin/env node

import { chromium } from "playwright-core";

const remotePort = process.env.GHOST_REMOTE_DEBUGGING_PORT ?? "9335";
const endpoint = `http://127.0.0.1:${remotePort}`;
const timeoutMs = 30_000;

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitForCondition(page, predicateBody, timeout = timeoutMs, interval = 300, ...args) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const ok = await page.evaluate(predicateBody, ...args);
    if (ok) {
      return true;
    }
    await page.waitForTimeout(interval);
  }
  return false;
}

async function getRendererPage(browser) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (page.url().startsWith("file://") && page.url().includes("/renderer/index.html")) {
        return page;
      }
    }
  }
  throw new Error("Foreground renderer page not found. Start electron app before running this smoke.");
}

async function run() {
  const browser = await chromium.connectOverCDP(endpoint);

  try {
    const rendererPage = await getRendererPage(browser);

    await rendererPage.evaluate(async () => {
      const state = await window.workspaceBridge.getState();
      const activeContext = state.tabs.find((tab) => tab.id === state.activeTabId);
      if (!activeContext || activeContext.kind !== "WEB") {
        await window.workspaceBridge.createTab();
      }
    });

    const dispatch = await rendererPage.evaluate(async () => {
      const result = await window.workspaceBridge.submitCommand({
        text: "research the best electric kettles under 60 dollars",
        mode: "RESEARCH",
        source: "TOP_BAR"
      });
      return result.dispatch;
    });

    assertCondition(Boolean(dispatch?.taskId), "Expected research dispatch to return task id.");

    const ghostTabReady = await waitForCondition(
      rendererPage,
      () => {
        return window.workspaceBridge
          .getState()
          .then((state) => {
            const activeGhost = state.activeGhostTabId
              ? state.ghostTabs.find((ghostTab) => ghostTab.ghostTabId === state.activeGhostTabId)
              : null;
            const anyGhost = state.ghostTabs[0] ?? null;
            const candidate = activeGhost ?? anyGhost;
            return Boolean(candidate && candidate.ghostContextId);
          })
          .catch(() => false);
      },
      15_000
    );
    assertCondition(ghostTabReady, "No live-capable ghost tab became available.");

    const selectedGhost = await rendererPage.evaluate(async () => {
      const state = await window.workspaceBridge.getState();
      const firstGhost = state.ghostTabs[0] ?? null;
      if (!firstGhost) {
        return null;
      }
      await window.workspaceBridge.switchGhostTab(firstGhost.ghostTabId);
      const after = await window.workspaceBridge.getState();
      return {
        ghostTabId: firstGhost.ghostTabId,
        taskId: firstGhost.taskId,
        contextId: firstGhost.ghostContextId,
        activeTabId: after.activeTabId,
        activeSurface: after.activeSurface
      };
    });

    assertCondition(Boolean(selectedGhost?.ghostTabId), "Failed to select a ghost tab.");

    const ghostSurfaceReached = await waitForCondition(
      rendererPage,
      (ghostTabId) => {
        return window.workspaceBridge
          .getState()
          .then((state) => state.activeGhostTabId === ghostTabId && state.activeSurface === "GHOST")
          .catch(() => false);
      },
      10_000,
      250,
      selectedGhost.ghostTabId
    );
    assertCondition(ghostSurfaceReached, "Switching to ghost tab did not activate GHOST surface.");

    const ghostContextTargetFound = await waitForCondition(
      rendererPage,
      (expectedContextId) => {
        return window.workspaceBridge
          .getState()
          .then((state) => {
            const ghost = state.ghostTabs.find((entry) => entry.ghostContextId === expectedContextId);
            return Boolean(ghost);
          })
          .catch(() => false);
      },
      8_000,
      250,
      selectedGhost.contextId
    );
    assertCondition(ghostContextTargetFound, "Active ghost context disappeared unexpectedly.");

    const restoreContext = await rendererPage.evaluate(async () => {
      const state = await window.workspaceBridge.getState();
      await window.workspaceBridge.switchTab(state.activeTabId);
      return window.workspaceBridge.getState();
    });

    assertCondition(restoreContext.activeSurface === "CONTEXT", "Top tab switch should restore CONTEXT surface.");

    const result = {
      endpoint,
      taskId: selectedGhost.taskId,
      checks: {
        ghostSurfaceReached,
        ghostContextId: selectedGhost.contextId,
        restoredContextSurface: restoreContext.activeSurface === "CONTEXT"
      }
    };

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(`[ghost-live-view-smoke] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
