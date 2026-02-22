# Phase 4.1: Context Window Management

This milestone adds bounded context history for Navigator calls:

- Keep only the most recent 5 action/observation pairs in the live prompt window.
- Summarize older history into a compact 2-3 sentence summary.
- Estimate prompt token usage per Navigator call and emit alert telemetry when the configured threshold is exceeded.

## Command

```bash
npm run context-window:smoke
```

The smoke run defaults to a visible browser (`GHOST_HEADFUL=true`) so you can watch the flow.

## What It Verifies

1. Rolling window is capped:
   - `contextRecentPairCount` never exceeds 5.
2. Older history is summarized:
   - once step history exceeds 5 entries, `contextSummaryIncluded=true` and summary character count is non-zero.
3. Prompt token budgets are tracked:
   - per-step `tier1EstimatedPromptTokens` / `tier2EstimatedPromptTokens` are recorded.
4. Alert plumbing exists for overflow risk:
   - `contextWindow.tokenAlerts[]` is emitted when estimated prompt tokens exceed threshold.
5. Scenario coverage includes flight-search style flows:
   - default scenario targets `aa.com` with March 2026 round-trip dates.
   - optional suite can include `delta.com`.

## Optional Scenario Controls

- `PHASE4_SUITE=aa` (default), `PHASE4_SUITE=aa+delta`, or `PHASE4_SUITE=music`
- `PHASE4_SCENARIO=<scenario-name>`
- `PHASE4_TASK_INTENT` + `PHASE4_TASK_START_URL` (custom scenario)
- `PHASE4_TASK_MAX_STEPS`
- `PHASE4_CONFIDENCE_THRESHOLD`
- `PHASE4_AX_DEFICIENT_THRESHOLD`
- `PHASE4_SCROLL_STEP_PX`
- `PHASE4_MAX_SCROLL_STEPS`
- `PHASE4_MAX_NO_PROGRESS_STEPS`
- `GHOST_HEADFUL=true|false` (default `true` for this smoke script)

## Artifacts

- Suite summary:
  - `docs/artifacts/phase4/phase4-4.1/context-window-management-result.json`
- Per-scenario detail:
  - `docs/artifacts/phase4/phase4-4.1/scenarios/<scenario>-context-window-result.json`

Each scenario payload includes loop history with context-window and prompt-budget fields, plus aggregate `contextWindow` metrics.

## Notes For Next Steps

- Phase 4.2 can reuse the summary context object to feed subtask checkpointing with compact task memory.
- Phase 4.4 can connect observation cache hit/miss events into the same context telemetry for cost and latency tracking.
