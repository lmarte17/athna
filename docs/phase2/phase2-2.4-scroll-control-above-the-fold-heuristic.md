# Phase 2.4: Scroll Control & Above-the-Fold Heuristic

This milestone hardens scroll exploration so Tier 3 scroll decisions use explicit page position context (`scrollY`, viewport height, document height) instead of action-only heuristics.

## Command

```bash
PHASE2_SCENARIO=below-fold-footer-scroll-tier3 npm run tiered:smoke
```

## What It Verifies

1. The loop queries scroll position from the page via CDP `Runtime.evaluate` (`window.scrollY` + viewport/document metrics).
2. Tier 2 inference logs include scroll context and below-fold likelihood (`belowFold=true|false`).
3. Tier 3 scroll escalation is only allowed when there is meaningful below-fold content remaining.
4. No-progress retries near the fold boundary avoid unnecessary re-capture and can fail fast when no additional below-fold content is available.
5. Scroll steps remain capped by `maxScrollSteps` (default `8`; scenario override supported).

## Optional Controls

- `PHASE2_SCROLL_STEP_PX`
- `PHASE2_MAX_SCROLL_STEPS`
- `PHASE2_EXPECT_TIER3_SCROLL`
- `PHASE2_SCENARIO`

## Artifacts

- Per-scenario detail:
  - `docs/artifacts/phase2/phase2-2.1/scenarios/<scenario>-tiered-perception-result.json`
- Suite summary:
  - `docs/artifacts/phase2/phase2-2.1/<suite>-tiered-perception-result.json`

Each step now captures scroll evidence in:

- `history[].scrollPosition`
- `history[].targetMightBeBelowFold`

## Notes For Next Steps

- Phase 2.5 staleness detection can reuse the same step-level telemetry pattern to explain when AX re-fetches happen after actions.
- Phase 2.6 DOM extraction can use `scrollPosition` to scope extraction to current viewport before escalating to vision.
