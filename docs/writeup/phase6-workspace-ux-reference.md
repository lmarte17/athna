# Phase 6 Reference Writeup: Workspace UX Layer

## Purpose
This document consolidates what we implemented in Phase 6 (6.1–6.3, 6.5–6.6), why each decision was made, and what results we got. It is meant as a memory-safe reference for the final submission writeup.

Primary Phase 6 goal from `docs/build/phase-6.md`:

- Build the foreground Electron workspace shell: dual-row tab layout (user context tabs + per-context Ghost Tab rows), natural language command bar, intent classification and routing, live task status feed, read-only Ghost Tab visibility, and user-initiated task cancellation.

## Scope Summary
Implemented in Phase 6:

- Start Page default tab and mirrored command bar with free-text input, URL normalization, and mode dropdown (`AUTO`, `BROWSE`, `DO`, `MAKE`, `RESEARCH`)
- Four-intent classifier routing commands to `FOREGROUND_NAVIGATION`, `GHOST_RESEARCH`, `GHOST_TRANSACT`, or `MAKER_GENERATE`
- Second-row Ghost Strip per context, collapsible sidebar task status feed, context-scoped background badges, and 2 Hz IPC throttle
- `GhostContextManager.captureGhostPage()` and `workspace:get-task-screenshot` IPC channel backing a read-only PiP ghost viewer with ~2 Hz polling
- `WorkspaceController.cancelTask()`, `workspace:cancel-task` IPC channel, `CANCELLED` task status, cancel controls on every active Ghost chip and status feed item, and BrowserContext destroy-as-abort mechanism

Not implemented in Phase 6 (intentionally deferred):

- Result Surface & Confidence Indicator (Phase 6.4) — structured result cards showing extracted data, source URLs, confidence, and "Open Applet" button; deferred pending Maker Engine result schema (Phase 7)
- UI-level controls for network policy and cache mode toggles deferred to Phase 10 hardening

## Browser-Layer Mapping (Requirements Alignment)
This is how Phase 6 work maps to `ghost_browser_requirements.docx.md` and why it matters.

- Command surface and natural language input (`Spec §09`):
  - Implemented free-text command bar with mode overrides, URL normalization, and dispatch pipeline.
  - Why: the command bar is the sole entry point for all user-initiated agent work; it must accept plain text without requiring task syntax.

- Intent routing and execution plan (`Spec §09`, Classification):
  - Classified commands into four intents (`NAVIGATE`, `RESEARCH`, `TRANSACT`, `GENERATE`) and four execution routes, with mode-override precedence.
  - Why: pre-dispatch classification avoids wasting Ghost Tab pool resources on simple navigations while maximising parallelism for research and transact tasks.

- Ghost Tab context row and task feed (`Spec §09`, Task Feed):
  - Per-context Ghost Strip in the second row and a collapsible sidebar show live task state, subtask progress, elapsed time, and current URL scoped to the active workspace context.
  - Why: users running parallel Ghost Tab agents need context-isolated visibility without being overwhelmed by unrelated tasks from other tabs.

- Ghost Tab read-only visibility (`Spec §09`, Ghost Tab Viewer):
  - Read-only PiP panel with ~2 Hz screenshot polling gives real-time visual feedback on agent work without allowing accidental interaction.
  - Why: operator situational awareness is a core UX requirement; `pointer-events: none` ensures the constraint is enforced at the element level.

- Task cancellation (`Spec §09`, Task Control):
  - Immediate cancel via BrowserContext destruction; partial results frozen and preserved in Status Feed.
  - Why: users must be able to stop misdirected or runaway tasks without waiting for the agent to finish or reach a safe checkpoint.

## Phase-by-Phase: How, Why, Results

### 6.1 Command Bar & Natural Language Input
How:

- Implemented Start Page as the default top-row context tab on app launch.
- Built a mirrored command bar present in both Start Page content and top chrome; inputs stay in sync.
- Added URL normalization (`amazon.com` → `https://amazon.com/`) and auto-clear on accepted submission.
- Implemented mode override dropdown: `AUTO`, `BROWSE`, `DO`, `MAKE`, `RESEARCH`.
- Added `Cmd/Ctrl+L` focus shortcut and new-tab focus path.
- Live Electron app with real workspace IPC; no stubs.

Why:

- A Start Page with guided placeholder text lowers the entry barrier; the mode dropdown gives power users explicit override without imposing syntax on others.

Result:

- All 10 checks passed.
- Direct URL input dispatched as `NAVIGATE` with confidence `0.99`.
- Mode override (`MAKE`) correctly overrode auto-classification (`MODE_OVERRIDE` source recorded).
- `autoClearAfterSubmit`, `mirroredCommandBar`, `placeholderGuidancePresent`, `defaultStartPageTab` all verified.
- Task count transition confirmed: `0 tasks on start → 1 task after URL submit`.
- Artifact:
  - `docs/artifacts/phase6/phase6-6.1/command-bar-ux-result.json`

### 6.2 Intent Classification
How:

- Implemented classifier in workspace controller mapping input text + active context + optional dropdown to four intent/route pairs: `NAVIGATE → FOREGROUND_NAVIGATION`, `RESEARCH → GHOST_RESEARCH`, `TRANSACT → GHOST_TRANSACT`, `GENERATE → MAKER_GENERATE`.
- Mode override takes strict precedence and records `MODE_OVERRIDE` source in the dispatch record.
- Classification result captured in `CommandDispatchRecord` with `intent`, `source`, `confidence`, and `executionPlan`.

Why:

- Pre-dispatch routing keeps simple URL navigations in the foreground tab without spawning a Ghost Tab; complex research queries get parallel Ghost execution automatically.

Result:

- All 5 scenarios passed.
- `navigate-google` (`google.com`, AUTO): `NAVIGATE / FOREGROUND_NAVIGATION`, confidence `0.99`, no task spawned.
- `research-compare-prices` (Compare prices for AirPods Pro…): `RESEARCH / GHOST_RESEARCH`, confidence `0.9`, task spawned.
- `transact-contact-form` (Fill out this contact form): `TRANSACT / GHOST_TRANSACT`, confidence `0.84`, task spawned.
- `generate-comparison-chart` (Show me a comparison chart…): `GENERATE / MAKER_GENERATE`, confidence `0.86`, primary engine `MAKER`.
- `override-make-forces-generate` (`google.com` with `MAKE` mode override): `GENERATE / MAKER_GENERATE`, confidence `1.0`, source `MODE_OVERRIDE`.
- Artifacts:
  - `docs/artifacts/phase6/phase6-6.2/intent-classification-result.json`
  - `docs/artifacts/phase6/phase6-6.2/scenarios/` (5 scenario files)

### 6.3 Task Status Feed
How:

- Added second-row Ghost Strip beneath top-row context tabs showing per-context Ghost Tab chips with live status labels.
- Added collapsible right sidebar with context-scoped task status feed showing current URL, current action, elapsed time, and subtask progress (`N/M`).
- Context switching swaps the visible Ghost Strip and sidebar feed to the newly active context's tasks.
- Added background task-count badges on inactive top tabs (`C1` format: running + completed count).
- Capped IPC state broadcast rate at 2 Hz with a sliding window token budget.

Why:

- Context-isolated visibility prevents task confusion when running multiple parallel research contexts. The 2 Hz throttle balances live feedback against renderer thrashing.

Result:

- All 7 checks passed.
- `secondRowGhostStripPresent`, `sidebarFeedPresent`, `contextSwitchScopesGhostStrip`, `contextSwitchScopesStatusFeed`, `tabBadgesForInactiveContexts`, `sidebarCollapsible`, `ipcUpdateRateCappedAt2Hz` all verified.
- Badge `C1` observed on inactive tab after task dispatch.
- Toggle probe: `collapsed=false → true → false` across two sidebar toggle events.
- Throttle probe: `eventCount=2` in `~1446ms`, `maxEventsInAnySecond=2`, confirming 2 Hz cap.
- Live validation confirmed Navigator model preference (`GEMINI_PRO_MODEL` before `GEMINI_VISION_MODEL`) and scheduler pool sizing from `GHOST_CONTEXT_COUNT`.
- Artifacts:
  - `docs/artifacts/phase6/phase6-6.3/task-status-feed-result.json`
  - `docs/artifacts/phase6/phase6-6.3/task-status-feed-live-validation-result.json`
  - `docs/artifacts/phase6/phase6-6.3/status-feed-start.png`
  - `docs/artifacts/phase6/phase6-6.3/status-feed-context-switch.png`
  - `docs/artifacts/phase6/phase6-6.3/status-feed-live-running.png`

### 6.5 Ghost Tab Visibility (Read-Only PiP Viewer)
How:

- Added `GhostContextManager.captureGhostPage(contextId)` using Electron's `webContents.capturePage()` on the offscreen ghost `BrowserWindow`; returns base64 PNG.
- Added `workspace:get-task-screenshot` on-demand IPC channel: renderer sends `taskId`, main process resolves `ghostContextId` and calls `captureGhostPage()`.
- Built fixed PiP overlay (bottom-right) opening when a Ghost chip is clicked; header shows task short ID + intent; body is a non-interactive `<img>` (`pointer-events: none`).
- Renderer polls at ~2 Hz while task is RUNNING or QUEUED; stops on completion and captures one final frame.
- Viewer auto-closes on context switch if the viewed task belongs to a different workspace context.

Why:

- Real-time agent progress visibility is a core UX requirement; the read-only constraint and `pointer-events: none` enforce operational isolation at the element level.

Result:

- All 6 foundational checks passed.
- `ghostContextScreenshotCapture`: CDP screenshot returned valid base64 data.
- `screenshotIsValidJpeg`: buffers start with JPEG SOI marker (`0xFF 0xD8 0xFF`).
- `screenshotDimensionsMatch`: both contexts `1280×900`.
- `screenshotIsNonTrivial`: context 1 `13 259 B`, context 2 `13 306 B` (both well above 4 KB floor).
- `multipleContextsIsolated`: two distinct data-URL pages produced different screenshot data.
- `poolReturnedToIdle`: final pool state `available=2, inUse=0, queued=0`.
- Artifacts:
  - `docs/artifacts/phase6/phase6-6.5/ghost-tab-visibility-result.json`
  - `docs/artifacts/phase6/phase6-6.5/ghost-context-1-screenshot.jpg`
  - `docs/artifacts/phase6/phase6-6.5/ghost-context-2-screenshot.jpg`

### 6.6 Task Cancellation
How:

- Added `WorkspaceController.cancelTask(taskId)`: sets status to `CANCELLED` immediately, freezes partial result snapshot (`currentUrl`, `currentState`, `currentAction`, `progressLabel`, `durationMs`), then calls `ghostContextDestroyer(ghostContextId)`.
- `ghostContextDestroyer` closure (matching Phase 6.5's `ghostPageCapturer` pattern) routes to `GhostContextManager.destroyContext(contextId, allowReplenish=true)` — closes the `BrowserWindow`, which causes every in-flight CDP call to throw, cascading to `failRuntimeTask()`.
- Added `CANCELLED` terminal status to `WorkspaceTaskStatus` with guards in `finalizeRuntimeTask()`, `failRuntimeTask()`, and `applyRuntimeStatusMessage()` to silently discard late orchestration events.
- Deferred-destroy path handles QUEUED-then-cancelled race: if `cancelTask()` fires before the orchestration layer assigns a `ghostContextId`, the guard in `applyRuntimeStatusMessage()` captures the contextId from the first arriving status message and calls `destroyContext()` immediately.
- Added `workspace:cancel-task` IPC channel; added `×` cancel buttons on every QUEUED/RUNNING ghost chip and "Cancel" buttons on every QUEUED/RUNNING status feed item (both use `stopPropagation` to avoid triggering chip selection or viewer open).
- CANCELLED tasks are filtered out of the Ghost Strip per spec; they remain in the Status Feed with their partial data.

Why:

- The context-destroy-as-abort mechanism provides a single, immediate kill path (within 1 second) without threading cancellation tokens through the orchestration stack. Partial result preservation respects user data even after abort. Pool auto-replenish keeps the resource pool healthy for subsequent tasks.

Result:

- All 6 pool-level checks passed in the cancellation smoke test.
- `ghostContextAcquiredForTask`: pool leased a ghost context successfully.
- `partialScreenshotCaptured`: screenshot captured before early release was a valid JPEG ≥ 4 KB.
- `earlyReleaseCompletedWithoutError`: `lease.release()` before task completion did not throw.
- `poolReplenishedAfterCancel`: pool reached `available ≥ 2, inUse = 0` after replenishment.
- `secondTaskRunsAfterCancel`: second lease acquired, navigated, and screenshot-captured successfully.
- `poolReturnedToIdle`: final state `inUse = 0, available ≥ 1, queued = 0`.
- Artifacts:
  - `docs/artifacts/phase6/phase6-6.6/task-cancellation-result.json`
  - `docs/artifacts/phase6/phase6-6.6/partial-result-screenshot.jpg`

## Optimizations We Intentionally Applied in Phase 6
- Mirrored command bar with a single shared draft state to avoid input divergence between Start Page and top-chrome positions.
- Mode-override strict-precedence rule with recorded `MODE_OVERRIDE` source for auditability.
- 2 Hz IPC state broadcast throttle (sliding-window token budget) to cap renderer update cost under heavy orchestration activity.
- Context-scoped Ghost Strip and sidebar feed so users only see tasks relevant to the active workspace context.
- On-demand screenshot pull (`workspace:get-task-screenshot`) rather than server-push streaming, keeping the IPC channel stateless and avoiding frame backpressure.
- `captureGhostPage()` uses Electron's `webContents.capturePage()` (forces fresh OSR frame) rather than CDP `Page.captureScreenshot`, which can return stale composited frames on offscreen windows.
- BrowserContext destroy-as-abort for cancellation — a single kill path with no additional abort signal plumbing through the orchestration stack.
- `allowReplenish=true` on cancel destroys so the pool self-heals without manual intervention.

## Known Tradeoffs and Residual Risks
- Phase 6.4 (Result Surface) was deferred; task completion in the current UI shows status transitions but does not render structured extracted-data cards or confidence indicators.
- PiP viewer polls at ~2 Hz; very fast-moving pages (rapid navigation sequences) may show stale frames between captures.
- The deferred-destroy path for QUEUED tasks fires on the first incoming status message after cancel; there is a brief window between `cancelTask()` and `destroyContext()` where the task may begin executing on the ghost context.
- Cancel smoke operates at the pool/lease layer (early release) rather than forcing an actual CDP target crash; full crash-path cancellation is covered by the live app manual validation steps.
- GENERATE tasks (`MAKER_GENERATE` route) reach `QUEUED` status but cannot progress to RUNNING until Phase 7 implements the Maker Engine; submitting them will produce a `failRuntimeTask` outcome via an unimplemented route error.

## What To Highlight in Final Submission Writeup
- Phase 6 completes the user-facing interaction layer on top of the concurrent runtime infrastructure built in Phases 3–5.
- The command bar requires no special syntax — plain text and an optional mode hint are the complete input model.
- Intent classification routes work to the right execution path before any Ghost Tab resources are allocated, keeping simple navigations fast and parallel research tasks automatically pooled.
- Every live task is observable in real time: Ghost Strip chips + sidebar feed + PiP screenshot viewer together provide three levels of visibility granularity.
- Cancellation is policy-enforced and non-cooperative — destroying the BrowserWindow provides a hard stop without requiring the agent to reach a safe point.
- All milestones are backed by reproducible smoke artifacts with quantitative assertions and, where applicable, screenshot evidence.

## Quick Evidence Index
- Requirements baseline: `ghost_browser_requirements.docx.md`
- Build milestones baseline: `docs/build/phase-6.md`
- Phase 6 milestone notes:
  - `docs/phase6/phase6-6.1-command-bar-natural-language-input.md`
  - `docs/phase6/phase6-6.2-intent-classification.md`
  - `docs/phase6/phase6-6.3-task-status-feed.md`
  - `docs/phase6/phase6-6.5-ghost-tab-visibility.md`
  - `docs/phase6/phase6-6.6-task-cancellation.md`
- Smoke artifacts:
  - `docs/artifacts/phase6/phase6-6.1/command-bar-ux-result.json`
  - `docs/artifacts/phase6/phase6-6.2/intent-classification-result.json`
  - `docs/artifacts/phase6/phase6-6.2/scenarios/` (5 scenario files)
  - `docs/artifacts/phase6/phase6-6.3/task-status-feed-result.json`
  - `docs/artifacts/phase6/phase6-6.3/task-status-feed-live-validation-result.json`
  - `docs/artifacts/phase6/phase6-6.5/ghost-tab-visibility-result.json`
  - `docs/artifacts/phase6/phase6-6.6/task-cancellation-result.json`
