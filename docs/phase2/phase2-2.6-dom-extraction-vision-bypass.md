# Phase 2.6: DOM Extraction via JS (Vision Bypass)

This milestone adds a DOM-only decision path between Tier 1 and Tier 2 to avoid unnecessary screenshot inference when visible interactive targets are unambiguous.

## Command

```bash
PHASE2_TASK_INTENT='open the English link' \
PHASE2_TASK_START_URL='https://www.wikipedia.org/' \
PHASE2_TASK_MAX_STEPS=1 \
PHASE2_AX_DEFICIENT_THRESHOLD=10000 \
PHASE2_EXPECT_DOM_BYPASS=true \
PHASE2_EXPECT_TIER2=false \
npm run tiered:smoke
```

## What It Verifies

1. Before issuing Tier 2 screenshot inference, the loop runs a JS DOM extraction via CDP `Runtime.evaluate` to collect visible interactive elements.
2. Extracted elements include:
   - `tag`
   - `role`
   - `type`
   - `text`
   - `href`
   - `inputValue`
   - `computedStyle`
   - `boundingBox`
   - visibility/interactive flags
3. A deterministic matching heuristic scores extracted elements against intent tokens.
4. If exactly one strong candidate is found, the loop emits a direct `CLICK` action and skips Tier 2 screenshot/model call.
5. Tier usage records cost savings from skipped vision calls (`estimatedVisionCostAvoidedUsd`).
6. Smoke validation checks `domBypassUsed` history against `tierUsage.domBypassResolutions`.

## Optional Controls

- `PHASE2_EXPECT_DOM_BYPASS`
- `PHASE2_EXPECT_TIER2`
- `PHASE2_TASK_INTENT`
- `PHASE2_TASK_START_URL`
- `PHASE2_AX_DEFICIENT_THRESHOLD`

## Artifacts

- Per-scenario detail:
  - `docs/artifacts/phase2/phase2-2.1/scenarios/<scenario>-tiered-perception-result.json`
- Suite summary:
  - `docs/artifacts/phase2/phase2-2.1/<suite>-tiered-perception-result.json`

Each step now includes DOM-bypass telemetry in:

- `history[].domExtractionAttempted`
- `history[].domExtractionElementCount`
- `history[].domBypassUsed`
- `history[].domBypassMatchedText`

## Notes For Next Steps

- The same extraction path can be expanded with site-specific selectors (forms, table rows, pagination) before escalating to vision.
