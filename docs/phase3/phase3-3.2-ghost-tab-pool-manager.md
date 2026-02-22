# Phase 3.2: Ghost Tab Pool Manager

This milestone adds a warm Ghost Tab pool manager with asynchronous replenishment and queueing under exhaustion.

## Command

```bash
npm run pool:smoke
```

## What It Verifies

1. Pool initialization warms a configurable minimum number of Ghost Tabs (default `2`).
2. Warm assignment is near-instant (`assignmentWaitMs <= 10ms` target by default).
3. After assignment, pool replenishes asynchronously toward the configured warm minimum.
4. Pool exhaustion does not fail:
   - additional tasks are queued
   - queued tasks are assigned when a lease is released
5. Pool state tracking is observable:
   - `available`
   - `inUse`
   - `replenishing`
   - `cold`
   - `queued`
6. Telemetry is emitted for warm-up cost and assignment wait times.

## Artifacts

- `docs/artifacts/phase3/phase3-3.2/ghost-tab-pool-result.json`

## Notes For Next Steps

- Phase 3.3 can attach explicit task lifecycle states on top of lease transitions.
- Phase 3.5 can extend the queue path with strict FIFO + foreground priority policy.
- Phase 3.7 can add crash replacement logic that re-warms failed slots automatically.
