# Phase 4.3: Error Handling - Structured Error Objects

This milestone routes orchestration failures to the Navigator as structured objects instead of relying on error-page screenshots:

- Navigation HTTP failures are captured as structured network errors (`status`, `url`, `retryable`).
- Runtime/CDP/timeout failures in perception/action paths are converted into structured error objects.
- Navigator receives `structuredError` in observation payload and returns a recovery/failure decision.
- Retryable structured errors apply a policy fallback to non-`FAILED` recovery action when needed.
- Task results now include a `structuredErrors[]` timeline with navigator decisions for each structured error event.

## Command

```bash
npm run structured-error:smoke
```

The smoke run uses a real Electron CDP host, real Navigator engine, and a local HTTP fixture server (no stubs/mocks).

## What It Verifies

1. HTTP 404 becomes a structured network error:
   - `type=NETWORK`, `status=404`, `retryable=false`.
   - event source is `NAVIGATION`.
2. HTTP 503 becomes a structured retryable network error:
   - `type=NETWORK`, `status=503`, `retryable=true`.
   - event source is `NAVIGATION`.
3. JS runtime failures are caught and structured:
   - `type=RUNTIME`, `status=null`, `retryable=false`.
   - event source is `PERCEPTION`.
4. Navigator receives structured error context:
   - each structured error event records a non-null `navigatorDecision`.
   - Tier 2 screenshot inference is not used in these structured-error scenarios (`tier2Calls=0`).

## Artifacts

- Suite summary:
  - `docs/artifacts/phase4/phase4-4.3/structured-error-objects-result.json`
- Per-scenario detail:
  - `docs/artifacts/phase4/phase4-4.3/scenarios/<scenario>-structured-error-objects-result.json`

## Notes For Next Steps

- Phase 4.4 can include structured-error-aware cache invalidation when retries are attempted.
- Phase 6.3 can surface `structuredErrors[]` directly in the task status UI with retryability indicators.
