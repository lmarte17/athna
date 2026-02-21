# Phase 1.4: Accessibility Tree Extraction & Normalization

This milestone adds AX extraction on loaded pages and normalizes CDP output into compact JSON for model input.

## Command

```bash
npm run ax:smoke
```

## What It Verifies

1. Calls `Accessibility.getFullAXTree` after page load and DOM readiness.
2. Normalizes output to only:
   - `nodeId`
   - `role`
   - `name`
   - `value`
   - `description`
   - `states[]`
   - `boundingBox`
3. Prunes irrelevant roles:
   - `generic`, `none`, `presentation`, `InlineTextBox`
4. Applies size budgeting with `charBudget: 8000`, preserving interactive nodes first.
5. Measures normalization runtime and flags when over `15ms`.

## Validation Target

`https://www.wikipedia.org/`

## Artifact

`docs/artifacts/phase1-1.4/wikipedia-normalized-ax-tree.json`

## Latest Validation Snapshot

- `rawNodeCount`: `392`
- `normalizedNodeCount`: `34`
- `interactiveNodeCount`: `34`
- `normalizedCharCount`: `7760`
- `normalizationDurationMs`: `50`
- `exceededCharBudget`: `true`
- `exceededNormalizationTimeBudget`: `true`
- `truncated`: `true`

## Notes For Next Steps

- The extraction API is now available from the shared CDP client for Phase 1.5 interactive indexing.
- Normalization is correctly flagged as over the 15ms budget on this page; this aligns with the Phase 10 optimization follow-up.
