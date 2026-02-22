# Phase 3.7: Crash Recovery

This milestone adds renderer crash recovery to parallel task execution: crashes are detected from CDP, tasks are retried on fresh attempts up to a configured retry limit, and retry exhaustion returns a clean `FAILED` outcome with crash details.

## Command

```bash
npm run crash:smoke
```

## What It Verifies

1. Renderer crash detection is wired into scheduler execution:
   - forced renderer crashes produce `CRASH_DETECTED` scheduler events.
2. Automatic retry behavior is enforced:
   - a task that crashes once retries and succeeds on a subsequent attempt.
3. Retry exhaustion behavior is deterministic:
   - a task that crashes on every attempt fails after `maxRetries + 1` total attempts.
4. Failure reporting remains structured:
   - exhausted tasks return typed failure details without hanging.
5. Crash isolation is preserved:
   - sibling tasks continue and succeed while crash/retry cycles occur.

## Artifacts

- `docs/artifacts/phase3/phase3-3.7/crash-recovery-result.json`

## Notes For Next Steps

- Phase 6.3 can surface live crash lifecycle updates (`CRASH_DETECTED`, `RETRYING`, `FAILED`) from existing task-status events.
- Phase 11.4 can build on this by adding stricter renderer crash isolation policies and user-facing incident summaries.
