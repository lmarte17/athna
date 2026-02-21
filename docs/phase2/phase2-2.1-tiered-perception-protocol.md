# Phase 2.1: Tiered Perception Protocol

This milestone adds model routing and escalation in the loop orchestrator:

- Tier 1: AX tree + interactive index on Gemini Flash.
- Tier 2: AX tree + viewport screenshot on Gemini Pro.
- Tier 3: 800px scroll fallback and retry from Tier 1.

## Command

```bash
npm run tiered:smoke
```

Default mode runs a **complex scenario suite** (not just Google) with:

1. `baseline-google-tier1`
2. `ax-deficient-webgl-tier2`
3. `below-fold-footer-scroll-tier3`

## What It Verifies

1. Tier 1 runs first when AX data is sufficient.
2. Tier 1 escalates when confidence is below threshold (`0.75` default).
3. AX-deficient pages skip directly to Tier 2 (`interactiveElementCount < 5` default).
4. Tier 2 can trigger Tier 3 fallback scroll (`800px`) before retrying.
5. Complex suite fails if no scenario reaches Tier 2 or Tier 3.
6. Tier usage telemetry and estimated cost are emitted per scenario and suite.

## Optional Scenario Controls

Use environment variables with the smoke command to force/validate paths:

- `PHASE2_SUITE` (`complex` or `baseline`; default `complex`)
- `PHASE2_SCENARIO` (run one named preset scenario)
- `PHASE2_TASK_INTENT` + `PHASE2_TASK_START_URL` (run one custom scenario)

- `PHASE2_CONFIDENCE_THRESHOLD`
- `PHASE2_AX_DEFICIENT_THRESHOLD`
- `PHASE2_SCROLL_STEP_PX`
- `PHASE2_MAX_SCROLL_STEPS`
- `PHASE2_EXPECT_TIER1`
- `PHASE2_EXPECT_TIER2`
- `PHASE2_EXPECT_AX_DEFICIENT`
- `PHASE2_EXPECT_TIER3_SCROLL`
- `PHASE2_SCENARIO`

## Artifacts

- Suite summary:
  - `docs/artifacts/phase2/phase2-2.1/<suite>-tiered-perception-result.json`
- Per-scenario detail:
  - `docs/artifacts/phase2/phase2-2.1/scenarios/<scenario>-tiered-perception-result.json`

## Notes For Next Steps

- Phase 2.2 can now enforce confidence-threshold policy using existing tier logs.
- Phase 2.3 and 2.4 can tighten AX-deficiency and scroll heuristics without changing the base tier router.
