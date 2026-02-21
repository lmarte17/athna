# Phase 1.1: CDP Client Setup

This milestone validates that orchestration can control a real Electron Ghost Tab through CDP.

## Command

```bash
npm run cdp:smoke
```

## What It Does

1. Starts Electron in CDP host mode (`--cdp-host`) with a hidden/offscreen Ghost Tab and remote debugging enabled.
2. Connects to Electron's CDP endpoint with `playwright-core`.
3. Navigates a real Ghost Tab to `https://www.google.com`.
4. Waits for `Page.loadEventFired`.
5. Captures a real JPEG screenshot via CDP `Page.captureScreenshot`.
6. Writes the artifact to:

`docs/artifacts/phase1-1.1/google-homepage.jpg`

## Acceptance Mapping

- `Page.navigate` executes via CDP and page load completes.
- `Page.captureScreenshot` returns a non-empty JPEG payload.
- Screenshot artifact is persisted to disk.

## Notes For Next Steps

- The reusable CDP client lives at `orchestration/src/cdp/client.ts`.
- This client is the foundation for Phase 1.2+ (`AX tree extraction`, `action execution`, and the loop orchestrator).
