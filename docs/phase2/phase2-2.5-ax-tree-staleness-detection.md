# Phase 2.5: AX Tree Staleness Detection

This milestone adds structured post-action DOM mutation analysis and refetches AX perception data only when stale.

## Command

```bash
PHASE2_SCENARIO=ax-deficient-webgl-tier2 npm run tiered:smoke
```

## What It Verifies

1. After each action, the loop waits on post-action settle signals (navigation and DOM mutation observation window).
2. DOM mutation analysis tracks structured metrics:
   - `addedOrRemovedNodeCount`
   - `interactiveRoleMutationCount`
   - `childListMutationCount`
   - `attributeMutationCount`
3. Mutation significance is classified with this rule:
   - significant when `addedOrRemovedNodeCount >= 3` OR `interactiveRoleMutationCount > 0`
4. AX perception is refetched on the next step only when required:
   - initial step (`INITIAL`)
   - navigation/URL change (`NAVIGATION`)
   - significant DOM mutation (`SIGNIFICANT_DOM_MUTATION`)
   - scroll action (`SCROLL_ACTION`)
5. If none of the above apply, the previous AX perception snapshot is reused (`refetchReason=NONE`).
6. Smoke validation enforces refetch-policy consistency across step history.

## Optional Controls

- `PHASE2_SCENARIO`
- `PHASE2_MAX_NO_PROGRESS_STEPS`
- `PHASE2_MAX_SCROLL_STEPS`

## Artifacts

- Per-scenario detail:
  - `docs/artifacts/phase2/phase2-2.1/scenarios/<scenario>-tiered-perception-result.json`
- Suite summary:
  - `docs/artifacts/phase2/phase2-2.1/<suite>-tiered-perception-result.json`

Each step now contains staleness telemetry in:

- `history[].axTreeRefetched`
- `history[].axTreeRefetchReason`
- `history[].postActionSignificantDomMutationObserved`
- `history[].postActionMutationSummary`

## Notes For Next Steps

- Phase 2.6 can use the same refetch policy and only run DOM extraction scripts when the snapshot is fresh enough for decision-making.
