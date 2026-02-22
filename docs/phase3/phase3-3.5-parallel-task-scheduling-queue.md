# Phase 3.5: Parallel Task Scheduling & Queue

This milestone adds a real orchestration scheduler that runs tasks concurrently up to pool capacity, queues overflow, applies foreground priority preemption, and emits typed queue/state status messages for the task status feed.

## Command

```bash
npm run scheduler:smoke
```

## What It Verifies

1. Parallel execution capacity equals pool size:
   - with `poolSize=6`, six tasks are dispatched and run concurrently.
2. Overflow tasks queue instead of failing:
   - the 7th task is queued until a slot is released.
3. Foreground priority preempts queued background work:
   - when both are queued, a `FOREGROUND` task dispatches before an earlier `BACKGROUND` task.
4. Queue depth and wait-time telemetry are tracked and emitted:
   - queue depth is observable in status messages
   - queued tasks include non-zero assignment wait times
5. Queue/scheduler/state updates are emitted on a typed status channel:
   - queue events (`ENQUEUED`, `DISPATCHED`, `RELEASED`)
   - state transitions (`IDLE` -> ...)
   - scheduler events (`STARTED`, `SUCCEEDED`, `FAILED`)

## Artifacts

- `docs/artifacts/phase3/phase3-3.5/parallel-task-scheduling-queue-result.json`

## Notes For Next Steps

- Phase 3.6 can consume scheduler status events to correlate resource violations with queue pressure and per-task wait time.
- Phase 3.7 can reuse the same scheduler channel to publish crash retry status and retry-exhausted failures.
- Phase 6.3 can render queue depth, wait time, and dispatch order directly from typed status messages.
