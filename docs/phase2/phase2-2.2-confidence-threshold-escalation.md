# Phase 2.2: Confidence Threshold & Escalation

This milestone hardens confidence-based routing policy and adds explicit escalation telemetry.

## Command

```bash
npm run tiered:smoke
```

## What It Verifies

1. Tier 1 actions are only executable when `confidence >= threshold` (`0.75` default).
2. Tier 1 low-confidence decisions trigger Tier 2 screenshot escalation.
3. No-progress streaks also trigger Tier 2 escalation before hard loop abort.
4. Tier 1 `FAILED` decisions are treated as unsafe and escalated to Tier 2.
5. Every escalation is captured as a structured event with:
   - step
   - escalation reason
   - source/target tier
   - URL at escalation
   - confidence metadata
   - resolved tier/confidence
6. Smoke validation fails if any Tier 1 action is executed below threshold.
7. Smoke validation fails if escalation telemetry is missing or inconsistent.

## Optional Controls

- `PHASE2_CONFIDENCE_THRESHOLD`
- `PHASE2_EXPECT_LOW_CONFIDENCE_ESCALATION`
- `PHASE2_MAX_NO_PROGRESS_STEPS` (loop guard to abort repeated no-progress actions)

## Artifacts

- Suite summary:
  - `docs/artifacts/phase2/phase2-2.1/<suite>-tiered-perception-result.json`
- Per-scenario detail:
  - `docs/artifacts/phase2/phase2-2.1/scenarios/<scenario>-tiered-perception-result.json`

Each scenario result now includes an `escalations` array and tier counters including:

- `tierUsage.lowConfidenceEscalations`
- `tierUsage.noProgressEscalations`
- `tierUsage.unsafeActionEscalations`
