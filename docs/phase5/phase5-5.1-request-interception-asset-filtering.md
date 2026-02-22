# Phase 5.1: Request Interception & Asset Filtering

This milestone adds request interception to Ghost Tabs with two runtime modes:

- `AGENT_FAST` (default): block `Image`, `Font`, and `Media` requests to reduce load time.
- `VISUAL_RENDER`: allow assets for screenshot-quality render passes.

It also adds per-tab request classification/metrics so the orchestration layer can observe request mix (`DOCUMENT_HTML`, `JSON_API`, `STATIC_ASSET`, `OTHER`) and validate interception effects.

## Command

```bash
npm run request-interception:smoke
```

The smoke run uses a real Electron CDP host and a local media-heavy fixture server (no mocks).

## What It Verifies

1. Asset filtering reduces Ghost Tab load time in `AGENT_FAST` mode:
   - median load time improves by at least 40% versus `VISUAL_RENDER` baseline on the same fixture.
2. Blocking policy is applied to the expected resource classes:
   - blocked requests are recorded for media-heavy assets in `AGENT_FAST`.
   - baseline `VISUAL_RENDER` run records zero blocked requests.
3. API traffic remains available while assets are filtered:
   - JSON fetch endpoint remains reachable in both baseline and filtered runs.
4. Tier-2-style visual pass can temporarily re-enable assets:
   - `withVisualRenderPass(...)` captures a valid viewport screenshot.
   - blocked images are re-requested and loaded for the visual pass.
5. Interception metrics are emitted for observability:
   - mode, blocked resource counts, classification counts, and per-run request telemetry are persisted.

## Artifacts

- `docs/artifacts/phase5/phase5-5.1/request-interception-result.json`

## Runtime Toggles

- `GHOST_REQUEST_INTERCEPTION_ENABLED` (default `true`)
- `GHOST_REQUEST_INTERCEPTION_INITIAL_MODE` (`AGENT_FAST`, `VISUAL_RENDER`, `DISABLED`)
- `GHOST_REQUEST_INTERCEPTION_BLOCK_STYLESHEETS` (default `false`)
- `GHOST_REQUEST_INTERCEPTION_BLOCKLIST` (comma-separated resource types)
- `GHOST_REQUEST_INTERCEPTION_VISUAL_SETTLE_MS` (default `250`)

## Notes For Next Steps

- Phase 5.2 can reuse this interception telemetry when validating connection isolation behavior.
- Phase 5.3 can consume request classification history to bias prefetch decisions toward likely navigation/API targets.
- Phase 5.4 can extend interception telemetry with network failure classification for structured error routing.
