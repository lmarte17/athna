# Phase 6.2: Intent Classification

This milestone adds pre-dispatch intent routing in the workspace controller with real execution plans:

- `NAVIGATE` -> `FOREGROUND_NAVIGATION`
- `RESEARCH` -> `GHOST_RESEARCH`
- `TRANSACT` -> `GHOST_TRANSACT`
- `GENERATE` -> `MAKER_GENERATE`

Classification uses command text plus optional mode override. Override takes precedence and is recorded as `MODE_OVERRIDE` source.

## Commands

```bash
HOME=/tmp/athna-smoke-home npm run smoke -w @ghost-browser/electron
```

```bash
GHOST_REMOTE_DEBUGGING_PORT=9335 npm run start -w @ghost-browser/electron
```

The artifact run executes classification through the live workspace IPC submit path (no stubs/mocks).

## What It Verifies

1. `google.com` maps to `NAVIGATE` and foreground route.
2. Multi-site comparison text maps to `RESEARCH` and ghost-research route.
3. Form/checkout language maps to `TRANSACT` and ghost-transact route.
4. Visualization/app request language maps to `GENERATE` and maker route.
5. Mode override can force classification source to `MODE_OVERRIDE` (for example `MAKE -> GENERATE`).

## Artifacts

- Suite summary:
  - `docs/artifacts/phase6/phase6-6.2/intent-classification-result.json`
- Per-scenario detail:
  - `docs/artifacts/phase6/phase6-6.2/scenarios/navigate-google-intent-classification-result.json`
  - `docs/artifacts/phase6/phase6-6.2/scenarios/research-compare-prices-intent-classification-result.json`
  - `docs/artifacts/phase6/phase6-6.2/scenarios/transact-contact-form-intent-classification-result.json`
  - `docs/artifacts/phase6/phase6-6.2/scenarios/generate-comparison-chart-intent-classification-result.json`
  - `docs/artifacts/phase6/phase6-6.2/scenarios/override-make-forces-generate-intent-classification-result.json`

## Notes For Next Steps

- Phase 6.3 can render task feed rows directly from `route`, `intent`, and `taskId` emitted by this classifier path.
- Phase 7 can plug Maker generation on top of existing `GENERATE` route semantics.
