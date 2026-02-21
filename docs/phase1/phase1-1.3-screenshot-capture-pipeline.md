# Phase 1.3: Screenshot Capture Pipeline

This milestone implements `captureScreenshot(options)` on top of CDP with viewport and full-page modes.

## Command

```bash
npm run cdp:smoke
```

## What It Verifies

1. Viewport capture (`mode: viewport`) returns a single `1280x900` JPEG.
2. Full-page capture (`mode: full-page`) uses scroll-and-stitch:
   - scroll step: `800px` (~11% overlap for a `900px` viewport)
   - max scroll steps: `8`
3. A capped run (`maxScrollSteps: 1`) reports `truncated: true` on long pages.
4. All outputs are returned as base64 JPEG payloads ready for model input.

## Validation Target

`https://www.lithosgraphein.com/`

## Artifacts

- `docs/artifacts/phase1-1.3/lithosgraphein-viewport.jpg`
- `docs/artifacts/phase1-1.3/lithosgraphein-full-page.jpg`
- `docs/artifacts/phase1-1.3/lithosgraphein-full-page-capped.jpg`

## Notes For Next Steps

- The screenshot API now exposes `mode`, `clip`, `quality`, and truncation metadata needed for tiered perception in Phase 2.
- This is directly reusable by AX+vision escalation logic (`Tier 2`) and scroll orchestration.
