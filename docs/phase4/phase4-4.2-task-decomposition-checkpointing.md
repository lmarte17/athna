# Phase 4.2: Task Decomposition & Checkpointing

This milestone adds subtask planning and checkpoint-aware recovery to the Navigator loop:

- For complex intents (> 2 implied steps), generate an ordered subtask plan.
- Track each subtask with `PENDING`, `IN_PROGRESS`, `COMPLETE`, `FAILED` status.
- Persist checkpoint metadata after each completed subtask.
- On subtask failure, retry from the current checkpointed subtask instead of restarting completed subtasks.
- Emit typed subtask status updates for the task status feed (`TASK_STATUS.kind = SUBTASK`).

## Command

```bash
npm run decomposition:smoke
```

The smoke run uses the real Electron CDP host and the real Navigator engine (no stubs/mocks).

## What It Verifies

1. Decomposition metadata is produced:
   - `result.decomposition` is present and marks complex intent decomposition.
   - `result.subtasks[]` exists with status-bearing subtask records.
2. Checkpoint object is updated across execution:
   - `result.checkpoint.lastCompletedSubtaskIndex`
   - `result.checkpoint.subtaskArtifacts[]`
3. Subtask status timeline exists and is externally observable:
   - `result.subtaskStatusTimeline[]`
   - callback-emitted timeline matches recorded result timeline.
4. Checkpoint retry path is exercised under retry-pressure scenario:
   - timeline contains `RETRY_FROM_CHECKPOINT` subtask status events.

## Artifacts

- Suite summary:
  - `docs/artifacts/phase4/phase4-4.2/task-decomposition-checkpointing-result.json`
- Per-scenario detail:
  - `docs/artifacts/phase4/phase4-4.2/scenarios/<scenario>-task-decomposition-checkpointing-result.json`

## Notes For Next Steps

- Phase 4.3 can attach structured error objects directly to subtask failure events.
- Phase 6.3 can render subtask-level progress directly from `TASK_STATUS.kind=SUBTASK` payloads.
- Future iterations can add multi-plan fallback switching and dependency-aware parallel subtask DAG execution.
