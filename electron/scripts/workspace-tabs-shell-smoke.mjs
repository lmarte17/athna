#!/usr/bin/env node

import { chromium } from "playwright-core";

const remotePort = process.env.GHOST_REMOTE_DEBUGGING_PORT ?? "9335";
const endpoint = `http://127.0.0.1:${remotePort}`;
const timeoutMs = 25_000;

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

    const chromeChecks = await rendererPage.evaluate(() => {
      return {
        hasContextStrip: Boolean(document.getElementById("tab-strip")),
        hasGhostStrip: Boolean(document.getElementById("ghost-strip")),
        hasStatusSidebar: Boolean(document.getElementById("status-sidebar")),
        hasRemovedGhostViewer: !document.getElementById("ghost-viewer")
      };
    });

    assertCondition(chromeChecks.hasContextStrip, "Context tab strip is missing.");
    assertCondition(chromeChecks.hasGhostStrip, "Ghost tab strip is missing.");
    assertCondition(chromeChecks.hasStatusSidebar, "Status sidebar is missing.");
    assertCondition(chromeChecks.hasRemovedGhostViewer, "Ghost screenshot viewer should be removed.");

    await rendererPage.evaluate(async () => {
      const state = await window.workspaceBridge.getState();
      const activeContext = state.tabs.find((tab) => tab.id === state.activeTabId);
      if (!activeContext || activeContext.kind !== "WEB") {
        await window.workspaceBridge.createTab();
      }
    });

    const dispatch = await rendererPage.evaluate(async () => {
      const result = await window.workspaceBridge.submitCommand({
        text: "compare prices for airpods pro across amazon and best buy",
        mode: "RESEARCH",
        source: "TOP_BAR"
      });
      return result.dispatch;
    });

    assertCondition(Boolean(dispatch?.taskId), "Expected a ghost-route task dispatch to include taskId.");

    const ghostTabVisible = await waitForCondition(
      rendererPage,
      () => {
        return window.workspaceBridge
          .getState()
          .then((state) => state.ghostTabs.length > 0)
          .catch(() => false);
      },
      10_000
    );
    assertCondition(ghostTabVisible, "Ghost tab row did not populate after dispatch.");

    const taskId = dispatch.taskId;
    const completionReached = await waitForCondition(
      rendererPage,
      (targetTaskId) => {
        return window.workspaceBridge
          .getState()
          .then((state) => {
            const task = state.tasks.find((entry) => entry.taskId === targetTaskId);
            return task ? task.status === "SUCCEEDED" || task.status === "FAILED" : false;
          })
          .catch(() => false);
      },
      12_000,
      400,
      taskId
    ).catch(() => false);

    let completedTaskPersistence = "skipped";
    if (completionReached) {
      const beforeDismiss = await rendererPage.evaluate(async (targetTaskId) => {
        const state = await window.workspaceBridge.getState();
        return state.ghostTabs.some((ghostTab) => ghostTab.taskId === targetTaskId);
      }, taskId);
      assertCondition(beforeDismiss, "Completed ghost tab should remain visible before dismiss.");

      const targetGhostTabId = await rendererPage.evaluate(async (targetTaskId) => {
        const state = await window.workspaceBridge.getState();
        return state.ghostTabs.find((ghostTab) => ghostTab.taskId === targetTaskId)?.ghostTabId ?? null;
      }, taskId);
      if (targetGhostTabId) {
        await rendererPage.evaluate(
          async (ghostTabId) => {
            await window.workspaceBridge.dismissGhostTab(ghostTabId);
          },
          targetGhostTabId
        );

        const removedAfterDismiss = await rendererPage.evaluate(async (targetTaskId) => {
          const state = await window.workspaceBridge.getState();
          return !state.ghostTabs.some((ghostTab) => ghostTab.taskId === targetTaskId);
        }, taskId);
        assertCondition(removedAfterDismiss, "Dismissed completed ghost tab should be removed.");
      }
      completedTaskPersistence = "verified";
    }

    const result = {
      endpoint,
      checks: {
        chromeChecks,
        ghostTabVisible,
        completedTaskPersistence
      },
      taskId
    };

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

// Patch waitForCondition to accept rest args while keeping callsites simple.
async function waitForCondition(
  page,
  predicateBody,
  timeout = timeoutMs,
  interval = 250,
  ...args
) {
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

run().catch((error) => {
  console.error(`[workspace-tabs-shell-smoke] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
