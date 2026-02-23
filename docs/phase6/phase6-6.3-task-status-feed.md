# Phase 6.3: Task Status Feed

This milestone adds a context-scoped task status UX for the foreground shell:

- A second-row Ghost strip beneath top tabs.
- A collapsible right sidebar status feed.
- Context switching between top tabs swaps visible Ghost strip and task feed content.
- Inactive context tabs display background task badges (running/completed).
- IPC state broadcasts from main process are capped at 2Hz.

## Commands

```bash
HOME=/tmp/athna-smoke-home npm run smoke -w @ghost-browser/electron
```

```bash
HOME=/tmp/athna-smoke-home GHOST_REMOTE_DEBUGGING_PORT=9334 npm run smoke:headless -w @ghost-browser/electron
```

```bash
GHOST_REMOTE_DEBUGGING_PORT=9335 npm run start -w @ghost-browser/electron
```

The 6.3 artifact run is executed against the live headful app via CDP and real workspace IPC/task routing (no stubs/mocks).

## What It Verifies

1. Second-row Ghost strip is present under top tabs.
2. Sidebar status feed is present and shows task entries.
3. Context switching scopes both sidebar feed and Ghost strip to the active top-tab context.
4. Inactive top tabs show background badges for running/completed Ghost tasks.
5. Sidebar is collapsible and re-expandable.
6. IPC status event rate is capped at 2Hz (max two state events observed in any rolling one-second window during rapid tab switching).

## Artifacts

- `docs/artifacts/phase6/phase6-6.3/task-status-feed-result.json`
- `docs/artifacts/phase6/phase6-6.3/task-status-feed-live-validation-result.json`
- `docs/artifacts/phase6/phase6-6.3/status-feed-start.png`
- `docs/artifacts/phase6/phase6-6.3/status-feed-context-switch.png`
- `docs/artifacts/phase6/phase6-6.3/status-feed-live-running.png`

## Live Runtime Follow-up

- Electron now autoloads workspace env files (`.env`, `.env.local`) so live Navigator auth is available without manual export per shell.
- Scheduler pool sizing now derives from `GHOST_CONTEXT_COUNT`, preventing `ctx-2` timeout errors when running a single ghost context.
- Navigator Pro model resolution now prefers `GEMINI_PRO_MODEL` before `GEMINI_VISION_MODEL`, avoiding JSON-mode failures from image-only model selection.

## Notes For Next Steps

- Phase 6.4 can extend sidebar rows into structured result cards with confidence display.
- Phase 6.5 can map Ghost-strip chips to read-only Ghost Tab visibility panes without changing context scoping semantics.
