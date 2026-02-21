# Phase 1.5: Interactive Element Index

This milestone builds a fast-pass interactive index from the normalized AX tree.

## Command

```bash
npm run index:smoke
```

## What It Verifies

1. Extracts only interactive roles from normalized AX data:
   - `button`, `link`, `textbox`, `combobox`, `checkbox`, `radio`, `menuitem`, `tab`, `searchbox`, `spinbutton`, `slider`, `switch`
2. Stores the index as a flat array:
   - `{nodeId, role, name, value, boundingBox}`
3. Confirms index payload is smaller than the full normalized AX payload.

## Validation Target

`https://www.allbirds.com/products/mens-tree-runners`

## Artifacts

- `docs/artifacts/phase1-1.5/allbirds-interactive-index.json`
- `docs/artifacts/phase1-1.5/allbirds-normalized-ax-tree.json`

## Latest Validation Snapshot

- `elementCount`: `40`
- `normalizedNodeCount`: `40`
- `indexCharCount`: `5418`
- `normalizedCharCount`: `7898`
- `sizeRatio`: `0.686`
- `withinTypicalRange (20-80)`: `true`

## Notes For Next Steps

- This index is now ready to feed the Tier 1 Navigator prompt in Phase 1.6.
- Normalization timing is still above the 15ms budget on this page and is correctly flagged for later optimization work.
