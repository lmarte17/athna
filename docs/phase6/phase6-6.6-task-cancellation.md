# Phase 6.6: Task Cancellation

This milestone adds user-initiated task cancellation, letting users stop any QUEUED or RUNNING Ghost Tab task at any time. Partial results accumulated before cancellation are preserved and displayed in the Status Feed.

## What It Adds

- **`WorkspaceController.cancelTask(taskId)`** — marks the task `CANCELLED` immediately, freezes the partial result snapshot (`currentUrl`, `currentState`, `currentAction`, `progressLabel`), and destroys the ghost BrowserContext via `GhostContextManager.destroyContext()`. Destroying the BrowserWindow causes every in-flight CDP call to throw, which cascades through the orchestration loop and aborts the Gemini API interaction.
- **`workspace:cancel-task` IPC channel** — renderer-triggered cancel; handler returns `{ cancelled: boolean }` and emits updated state.
- **`ghostContextDestroyer` option on `WorkspaceController`** — closure pattern (matching Phase 6.5's `ghostPageCapturer`) that routes `cancelTask()` to `GhostContextManager.destroyContext(contextId, allowReplenish=true)`. Pool self-heals after every cancellation.
- **`CANCELLED` task status** — new terminal state in `WorkspaceTaskStatus`. Guards in `finalizeRuntimeTask()`, `failRuntimeTask()`, and `applyRuntimeStatusMessage()` silently discard any late orchestration events for an already-cancelled task.
- **Deferred destroy for QUEUED tasks** — if a task is cancelled before the orchestration layer assigns a ghost context, `applyRuntimeStatusMessage()` detects the CANCELLED state on the first status message, captures the `contextId`, and calls `destroyContext()` immediately.
- **Cancel buttons** — every QUEUED or RUNNING ghost chip in the second-row Ghost Strip has an inline `×` cancel button; every task item in the Status Feed has a "Cancel" button. Both buttons call `bridge.cancelTask(taskId)` and stop click propagation so the viewer or selection state is not affected.
- **Ghost Strip filtering** — CANCELLED tasks are removed from the Ghost Strip ("context row") per spec. They remain in the Status Feed with `CANCELLED` status and their partial data.
- **Viewer polling guard** — the PiP ghost viewer stops polling and takes one final screenshot when the viewed task transitions to `CANCELLED`.

## Files Changed

| File | Change |
|------|--------|
| `electron/src/workspace-types.ts` | Add `"CANCELLED"` to `WorkspaceTaskStatus`; add `cancelTask` channel to `WORKSPACE_CHANNELS` |
| `electron/src/workspace-controller.ts` | Add `ghostContextDestroyer` option + field; `handleCancelTask` IPC handler; `cancelTask()` method; CANCELLED guards in `applyRuntimeStatusMessage`, `finalizeRuntimeTask`, `failRuntimeTask` |
| `electron/src/main.ts` | Wire `ghostContextDestroyer` closure in `WorkspaceController` constructor |
| `electron/src/preload.ts` | Add `cancelTask` to local `WORKSPACE_CHANNELS`, `WorkspaceBridgeApi`, and bridge implementation |
| `electron/src/renderer/app.ts` | Add `cancelTask` to local `WorkspaceBridgeApi`; add `CANCELLED` to `COMPLETED_TASK_STATUSES`; filter CANCELLED from Ghost Strip in `renderGhostStrip()`; add cancel buttons in `renderGhostStrip()` and `renderStatusFeed()`; extend viewer polling guard in `applyState()` |
| `electron/src/renderer/styles.css` | Add `.ghost-chip-cancel`, `.status-item-cancel`, `.ghost-chip.cancelled`, `.status-item.cancelled` styles; extend `:focus` block |

## Commands

```bash
# Orchestration-level smoke test (validates pool-level context release and recovery)
npm run cancellation:smoke -w @ghost-browser/orchestration
```

```bash
# Headful variant (ghost windows visible during run)
GHOST_HEADFUL=true npm run cancellation:smoke -w @ghost-browser/orchestration
```

```bash
# Live app for manual end-to-end validation
GHOST_REMOTE_DEBUGGING_PORT=9335 npm run start -w @ghost-browser/electron
```

## What the Smoke Script Verifies

The orchestration-level smoke (`task-cancellation-smoke.mjs`) validates the pool-level contract that `WorkspaceController.cancelTask()` depends on — ghost context leases can be released early and the pool recovers:

1. **`ghostContextAcquiredForTask`** — Pool successfully leases a ghost context for the first task.
2. **`partialScreenshotCaptured`** — CDP screenshot taken before the early release is a valid JPEG ≥ 4 KB (proves work was in progress before cancellation).
3. **`earlyReleaseCompletedWithoutError`** — `lease.release()` called before the task finishes does not throw (pool tolerates early returns).
4. **`poolReplenishedAfterCancel`** — Pool reaches `available >= 2, inUse === 0` after the released slot is replenished (`autoReplenish=true`).
5. **`secondTaskRunsAfterCancel`** — A second lease is acquired, navigated, and screenshot-captured successfully after the cancellation — proves the pool is fully healthy.
6. **`poolReturnedToIdle`** — Final pool state: `inUse === 0, available >= 1, queued === 0`.

## What Manual Validation Verifies (Live Headful App)

Against a live `npm run start` session with a real task running:

1. Submitting a research task creates a Ghost chip in the second-row Ghost Strip with a `×` button and a "Cancel" entry in the Status Feed.
2. Clicking `×` on the ghost chip (or "Cancel" in the Status Feed) cancels the task within 1 second.
3. The ghost chip disappears from the Ghost Strip immediately after cancellation.
4. The task appears in the Status Feed with `CANCELLED` status, preserving the last-known URL, action, and progress label as partial result data.
5. If the PiP ghost viewer was open for the cancelled task, polling stops and the last screenshot remains visible.
6. The Ghost Tab pool replenishes (if configured with `GHOST_CONTEXT_AUTO_REPLENISH=true`) — subsequent tasks can be submitted without waiting.
7. Clicking Cancel on an already-terminal task (SUCCEEDED/FAILED) has no effect — the button is not rendered for those tasks.

## Artifacts

- `docs/artifacts/phase6/phase6-6.6/task-cancellation-result.json`
- `docs/artifacts/phase6/phase6-6.6/partial-result-screenshot.jpg`

## Architecture Note

Cancellation uses a **context-destroy-as-abort** pattern: calling `GhostContextManager.destroyContext()` closes the Electron `BrowserWindow` that hosts the ghost tab. This is the same window that the CDP client uses for all orchestration operations (navigation, AX tree extraction, screenshot capture). When the window closes, Chrome's renderer process terminates immediately, and all pending CDP calls throw a `Target closed` or connection error. These errors surface through the orchestration scheduler's crash detection path and eventually call `failRuntimeTask()` — which silently returns because the task is already in the `CANCELLED` terminal state.

This approach gives a one-shot cancellation path with no additional abort signals or cancellation tokens threaded through the orchestration stack, and stays within the 1-second acceptance window specified in the Phase 6.6 requirements.

The `ghostContextDestroyer` closure follows the identical pattern as Phase 6.5's `ghostPageCapturer`: both are optional callbacks on `WorkspaceControllerOptions`, assigned once in the constructor, and wired in `main.ts` against the live `GhostContextManager` instance. This keeps the `WorkspaceController` decoupled from the Electron layer and testable without a real `GhostContextManager`.

## Notes For Next Steps

- Phase 6.7 can add a scrollable cancellation history panel showing the partial result snapshots for all CANCELLED tasks in a context.
- The `CANCELLED` terminal state can be extended with a `cancelledAt` field and a `cancelReason` enum (`USER` vs `SYSTEM`) for richer task history.
- The deferred-destroy path in `applyRuntimeStatusMessage()` can be extended to emit a `workspace:state` update immediately after the contextId is captured, giving the UI a chance to render the ghost chip before it disappears.
