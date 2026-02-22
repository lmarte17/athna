# Phase 3.6: Resource Budgets per Ghost Tab

This milestone enforces per-tab CPU and memory budgets in the parallel scheduler, emits typed violation events, and supports configurable enforcement (`WARN_ONLY` or `KILL_TAB`) without impacting unrelated tabs.

## Command

```bash
npm run resource:smoke
```

## What It Verifies

1. Per-tab budget monitoring runs during task execution:
   - CPU and memory are sampled on an interval per active Ghost Tab.
2. Sustained budget violations are detected and reported:
   - violation events are emitted on the scheduler status channel.
3. Enforcement mode can terminate only the violating Ghost Tab:
   - in `KILL_TAB` mode, the violating task fails while sibling tasks continue.
4. Violation timing meets the milestone target:
   - the violating task is flagged within 10 seconds.
5. Scheduler/pool stability is preserved:
   - no queue leak and no stuck in-use slot after enforcement.

## Artifacts

- `docs/artifacts/phase3/phase3-3.6/resource-budgets-result.json`

## Notes For Next Steps

- Phase 3.7 reuses scheduler status emission to expose crash detection and retry attempts on the same typed channel.
- Phase 6.3 can render budget violations, affected context IDs, and enforcement outcomes directly from `TASK_STATUS` scheduler events.
