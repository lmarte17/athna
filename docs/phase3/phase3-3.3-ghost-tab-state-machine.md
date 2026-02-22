# Phase 3.3: Ghost Tab State Machine

This milestone formalizes Ghost Tab task lifecycle transitions with strict state enforcement and structured state-change events.

## Command

```bash
npm run state:smoke
```

## What It Verifies

1. The task lifecycle follows the formal transition graph:
   - `IDLE -> LOADING -> PERCEIVING -> INFERRING -> ACTING -> COMPLETE -> IDLE`
2. Invalid transitions are rejected:
   - Example: `ACTING -> IDLE` is rejected unless the task first enters `COMPLETE` or `FAILED`.
3. Runtime failures move to `FAILED` with a structured error detail object.
4. Every state change emits an observable transition event suitable for status-feed consumption.
5. Terminal states trigger cleanup and return to `IDLE`.

## Artifacts

- `docs/artifacts/phase3/phase3-3.3/ghost-tab-state-machine-result.json`

## Notes For Next Steps

- Phase 3.4 can map these transition events directly to typed IPC status messages.
- Phase 3.5 can layer queue wait/dispatch events over the same task lifecycle stream.
- Phase 3.7 crash handling can route renderer crashes into `FAILED` and then recycle to `IDLE`.
