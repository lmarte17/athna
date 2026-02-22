# Phase 2.3: AX-Deficient Page Detection

This milestone tightens AX-deficient routing so Tier 2 is used only when AX is truly insufficient on a loaded, visually meaningful page.

## Command

```bash
PHASE2_SCENARIO=ax-deficient-webgl-tier2 npm run tiered:smoke
```

## What It Verifies

1. AX-deficient detection requires both:
   - `interactiveElementCount < threshold` (default threshold `5`, scenario-specific override supported)
   - page-level gate from CDP signals:
     - `isLoadComplete === true`
     - `hasSignificantVisualContent === true`
2. When detected, Tier 1 Flash is bypassed and the loop routes directly to Tier 2 Vision.
3. AX-deficient escalations are logged with step-level metadata (`loadComplete`, `significantVisual`, URL, count/threshold).
4. Each AX-deficient detection is also recorded in `axDeficientPages[]` for analysis.
5. Smoke validation enforces policy consistency:
   - every `AX_DEFICIENT` escalation must map to a history step with `axDeficientDetected: true`
   - every such step must satisfy both gating signals
   - `axDeficientPages.length` must match `tierUsage.axDeficientDetections`

## Optional Controls

- `PHASE2_AX_DEFICIENT_THRESHOLD`
- `PHASE2_EXPECT_AX_DEFICIENT`
- `PHASE2_SCENARIO`

## Artifacts

- Per-scenario detail:
  - `docs/artifacts/phase2/phase2-2.1/scenarios/<scenario>-tiered-perception-result.json`
- Suite summary:
  - `docs/artifacts/phase2/phase2-2.1/<suite>-tiered-perception-result.json`

Each scenario now includes AX-deficiency evidence in:

- `history[].axDeficiencySignals`
- `axDeficientPages[]`

## Notes For Next Steps

- Phase 2.4 can build on this by deciding when Tier 3 scroll should be preferred versus repeated Tier 2 retries.
- Phase 2.5 staleness checks should reuse the same structured logging style for mutation-driven re-perception decisions.
