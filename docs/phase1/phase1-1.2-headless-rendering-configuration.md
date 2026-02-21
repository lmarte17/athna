# Phase 1.2: Headless Rendering Configuration

This milestone configures Ghost Tab rendering defaults for predictable, low-overhead perception input.

## Status

This configuration is now exercised as part of the newer Phase 1.3 smoke run.

## What It Verifies

1. Electron CDP host runs with `--headless=new`, disables hardware acceleration, and applies `--disable-gpu`.
2. Orchestration applies CDP viewport metrics:
   - width: `1280`
   - height: `900`
   - deviceScaleFactor: `1`
3. Screenshot defaults are enforced via CDP:
   - format: `jpeg`
   - quality: `80`
   - fromSurface: `true`
4. Captured screenshot dimensions are validated as exactly `1280x900`.

## Artifact

`docs/artifacts/phase1-1.2/google-homepage.jpg`

## Notes For Next Steps

- Rendering defaults are now centralized in `orchestration/src/cdp/client.ts`.
- The same client can be extended in Phase 1.3 for clip regions and full-page capture modes.
