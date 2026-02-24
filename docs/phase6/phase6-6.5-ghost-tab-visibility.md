# Phase 6.5: Ghost Tab Visibility (Read-Only)

This milestone adds a read-only picture-in-picture (PiP) panel that lets users inspect the current visual state of any Ghost Tab agent without interacting with it.

## What It Adds

- **`GhostContextManager.captureGhostPage(contextId)`** — Electron-level method that calls `webContents.capturePage()` on the offscreen ghost BrowserWindow and returns a base64 PNG string.
- **`workspace:get-task-screenshot` IPC channel** — on-demand pull channel; renderer sends `taskId`, main process resolves the task's `ghostContextId` and calls `captureGhostPage()`.
- **Ghost Viewer panel** — fixed PiP overlay (bottom-right) that appears when a Ghost chip in the second-row Ghost Strip is clicked.
  - Header shows task short ID and intent.
  - Body shows the latest screenshot as a non-interactive `<img>` (`pointer-events: none`).
  - Close button (×) dismisses the panel.
- **Polling** — renderer polls at ~2 Hz while the task is RUNNING/QUEUED; stops on task completion and takes one final frame.
- **Context isolation** — viewer closes automatically when the user switches to a workspace tab whose context does not own the viewed task.

## Files Changed

| File | Change |
|------|--------|
| `electron/src/ghost-context-manager.ts` | Add `captureGhostPage()` method |
| `electron/src/workspace-controller.ts` | Add `ghostContextId` field, `getTaskGhostContextId()`, `ghostPageCapturer` option, IPC handler |
| `electron/src/workspace-types.ts` | Add `getTaskScreenshot` channel constant |
| `electron/src/main.ts` | Pass `ghostPageCapturer` closure to WorkspaceController |
| `electron/src/preload.ts` | Add `getTaskScreenshot` to bridge API |
| `electron/src/renderer/index.html` | Add ghost viewer panel HTML |
| `electron/src/renderer/app.ts` | Add viewer open/close/poll/refresh logic |
| `electron/src/renderer/styles.css` | Add PiP viewer styles |

## Commands

```bash
# Orchestration-level smoke test (validates ghost context screenshot capture & isolation)
npm run ghost-visibility:smoke -w @ghost-browser/orchestration
```

```bash
# Headful variant (ghost windows visible during run)
GHOST_HEADFUL=true npm run ghost-visibility:smoke -w @ghost-browser/orchestration
```

```bash
# Live app for manual end-to-end validation
GHOST_REMOTE_DEBUGGING_PORT=9335 npm run start -w @ghost-browser/electron
```

## What the Smoke Script Verifies

The orchestration-level smoke (`ghost-tab-visibility-smoke.mjs`) validates the foundational capability that Phase 6.5 is built on — ghost contexts can render content and be captured as independent screenshots:

1. **`ghostContextScreenshotCapture`** — CDP screenshot call returns non-empty base64 data.
2. **`screenshotIsValidJpeg`** — Buffer starts with JPEG SOI marker (`0xFF 0xD8 0xFF`).
3. **`screenshotDimensionsMatch`** — Width × height matches the ghost window size (1280 × 900).
4. **`screenshotIsNonTrivial`** — Rendered buffer exceeds a 4 KB floor (page has real visual content).
5. **`multipleContextsIsolated`** — Two ghost tabs navigated to visually distinct data-URL pages produce different screenshot data.
6. **`poolReturnedToIdle`** — Pool returns to a fully idle state after both leases are released.

## What Manual Validation Verifies (Live Headful App)

Against a live `npm run start` session with a real task running:

1. Clicking a Ghost chip in the second-row Ghost Strip opens the PiP viewer in the bottom-right corner.
2. The viewer shows a screenshot of the ghost tab's current page.
3. The screenshot updates at roughly 2 Hz while the task is RUNNING.
4. Switching workspace tabs closes the viewer if the task belongs to a different context.
5. Closing the viewer via `×` stops polling.
6. The ghost tab cannot receive keyboard or mouse input — the `<img>` element has `pointer-events: none`.
7. After the task completes, polling stops and the final screenshot remains visible.

## Artifacts

- `docs/artifacts/phase6/phase6-6.5/ghost-tab-visibility-result.json`
- `docs/artifacts/phase6/phase6-6.5/ghost-context-1-screenshot.jpg`
- `docs/artifacts/phase6/phase6-6.5/ghost-context-2-screenshot.jpg`

## Architecture Note

`captureGhostPage()` uses Electron's `webContents.capturePage()` rather than CDP's `Page.captureScreenshot`. For OSR (offscreen rendering) windows — which is what ghost BrowserWindows are — `capturePage()` forces a fresh frame render and returns the current surface. The orchestration-layer CDP screenshots confirm the same rendered content is reachable by both paths.

## Notes For Next Steps

- Phase 6.6 can extend the PiP viewer with a scrollable screenshot history (last N captures).
- Phase 6.7 can add a "Jump to step" control that replays the observation log alongside screenshots.
- The `ghostContextId` stored on `ManagedWorkspaceTask` can also be used to stream accessibility-tree snapshots alongside screenshots for richer task inspection UIs.
