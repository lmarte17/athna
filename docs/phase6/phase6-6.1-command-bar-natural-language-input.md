# Phase 6.1: Command Bar - Natural Language Input

This milestone implements the Start Page command bar and top-row context-tab shell with live dispatch behavior in Electron:

- Start Page default tab and mirrored command bar in top chrome.
- Free-text + URL input handling.
- Optional mode override dropdown (`AUTO`, `BROWSE`, `DO`, `MAKE`, `RESEARCH`).
- Auto-clear input after successful submit.
- Command focus path validation (`Cmd/Ctrl+L`) and top-bar focus handoff.

## Commands

```bash
HOME=/tmp/athna-smoke-home npm run smoke -w @ghost-browser/electron
```

```bash
GHOST_REMOTE_DEBUGGING_PORT=9335 npm run start -w @ghost-browser/electron
```

The artifact run uses the live headful app via CDP and real workspace IPC (no stubs/mocks).

## What It Verifies

1. Start Page is the default top-tab context on launch.
2. Command bar is mirrored between Start Page and top chrome.
3. Start Page placeholder guidance text is present.
4. URL input (for example `amazon.com`) dispatches as `NAVIGATE` and routes to foreground navigation.
5. Input fields auto-clear after accepted submit.
6. Command bar remains accessible after navigation leaves Start Page.
7. Explicit mode override is respected during dispatch.
8. Command focus is restored to top command input via tab-creation flow and `Cmd/Ctrl+L` shortcut flow.

## Artifacts

- `docs/artifacts/phase6/phase6-6.1/command-bar-ux-result.json`
- `docs/artifacts/phase6/phase6-6.1/start-page-initial.png`
- `docs/artifacts/phase6/phase6-6.1/after-url-submit.png`

## Notes For Next Steps

- Phase 6.2 consumes this command payload and mode override surface for intent routing.
- Phase 6.3 can reuse the same top-shell/state channel for context-scoped task updates.
