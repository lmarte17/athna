# Phase 1 Reference Writeup: Foundational Perception-Action Loop

## Purpose
This document consolidates what we implemented in Phase 1 (1.1-1.8), why each decision was made, and what results we got. It is meant as a memory-safe reference for the final submission writeup.

Primary Phase 1 goal from `build-plan.md`:

- A single Ghost Tab can load a page, perceive it (AX tree), send perception to Gemini, receive an action, execute it via CDP, and loop.

## Scope Summary
Implemented in Phase 1:

- Real Electron Ghost Tab CDP control (no mocks/stubs)
- Headless rendering defaults for deterministic perception input
- Viewport and full-page screenshot pipeline
- AX tree extraction and normalization for low-token perception
- Interactive element index for fast action planning
- Gemini Flash-based navigator with typed action schema
- CDP action executor mapping actions to browser commands
- End-to-end loop orchestrator and smoke-tested run

Not implemented in Phase 1 (intentionally deferred):

- Tiered Flash/Pro routing and confidence escalation logic (Phase 2)
- Request interception/asset filtering/prefetch (Phase 5)
- Ghost Tab pool, queueing, and crash recovery (Phase 3)

## Browser-Layer Mapping (Requirements Alignment)
This is how Phase 1 work maps to `ghost_browser_requirements.docx.md` layers and why it matters.

- Rendering engine (`§02`):
  - We standardized Ghost Tab rendering (`--headless=new`, `--disable-gpu`, viewport `1280x900`, JPEG quality 80).
  - Why: stable image dimensions and lower render overhead reduce both runtime variance and model input size.

- CDP interface (`§06`):
  - We implemented control paths around `Page.navigate`, `Page.captureScreenshot`, `Accessibility.getFullAXTree`, `Runtime.evaluate`, `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`.
  - Why: these methods are the direct control surface for the perception-action loop.

- Accessibility tree (`§04`):
  - We normalized AX output and extracted an interactive-only index.
  - Why: AX-first perception is cheaper/faster than always using screenshots, and reduces token volume.

- JavaScript engine usage (`§03`):
  - We used `Runtime.evaluate` for scroll/extract/mutation-dependent waits.
  - Why: browser-native JS execution is required for reliable DOM-aware interactions and extracting structured values.

- Process architecture / Ghost Tab states (`§05`):
  - We operationalized the state progression `LOADING -> PERCEIVING -> INFERRING -> ACTING -> COMPLETE/FAILED`.
  - Why: this creates traceable, auditable execution for reliability and debugging.

- Networking (`§01`) relation in Phase 1:
  - Direct network optimizations (interception/filtering/prefetch) were not built in this phase.
  - But Phase 1 design choices still reduce network-adjacent pressure by preferring AX/tree-based reasoning and limiting screenshots to intentional capture moments.

## Phase-by-Phase: How, Why, Results

### 1.1 CDP Client Setup
How:

- Connected orchestration to a real Electron CDP host using `playwright-core`.
- Navigated to Google and captured real JPEG output.

Why:

- Establishes the non-negotiable foundation: agent decisions must execute in a real browser process via CDP.

Result:

- Successful `Page.navigate` + `Page.captureScreenshot` on live page.
- Artifact: `docs/artifacts/phase1/phase1-1.1/google-homepage.jpg`.

### 1.2 Headless Rendering Configuration
How:

- Enforced headless + GPU-disabled defaults and standardized viewport/screenshot settings.

Why:

- Deterministic perception input and lower hidden-tab overhead.
- Matches spec standards for model-friendly dimensions and quality.

Result:

- Verified `1280x900` screenshot output with JPEG quality 80 and `fromSurface: true`.
- Artifact: `docs/artifacts/phase1/phase1-1.2/google-homepage.jpg`.

### 1.3 Screenshot Capture Pipeline
How:

- Added `captureScreenshot(options)` with:
  - `viewport` mode
  - `full-page` scroll-and-stitch mode
  - `800px` scroll step
  - max step cap (`8`) and truncation signaling

Why:

- Supports both cheap default perception (viewport) and long-page fallback.
- Step cap prevents infinite-scroll runaway behavior.

Result:

- Viewport and full-page outputs validated on a scroll-heavy real site.
- Artifacts:
  - `docs/artifacts/phase1/phase1-1.3/lithosgraphein-viewport.jpg`
  - `docs/artifacts/phase1/phase1-1.3/lithosgraphein-full-page.jpg`
  - `docs/artifacts/phase1/phase1-1.3/lithosgraphein-full-page-capped.jpg`

### 1.4 AX Tree Extraction & Normalization
How:

- Called `Accessibility.getFullAXTree` after load readiness.
- Normalized to compact fields (`nodeId`, role/name/value/description/states/boundingBox).
- Pruned low-value roles and applied char/time budgets.

Why:

- Raw AX payload is too large for efficient model prompting.
- Normalization is key to AX-first cheap perception path.

Result:

- Significant tree reduction on live page:
  - raw nodes `392` -> normalized nodes `34`
  - normalized chars `7760` with truncation and budget flags recorded
- Artifact: `docs/artifacts/phase1/phase1-1.4/wikipedia-normalized-ax-tree.json`.

### 1.5 Interactive Element Index
How:

- Built a filtered, flat index for interactive roles only.
- Stored per element: `{nodeId, role, name, value, boundingBox}`.

Why:

- Gives Navigator a compact action surface before reading full tree detail.
- Reduces token and reasoning overhead in the first-pass decision.

Result:

- Index was materially smaller than normalized AX payload on test page:
  - index chars `5418` vs normalized `7898` (`0.686` ratio)
- Artifacts:
  - `docs/artifacts/phase1/phase1-1.5/allbirds-interactive-index.json`
  - `docs/artifacts/phase1/phase1-1.5/allbirds-normalized-ax-tree.json`

### 1.6 Navigator Engine (Flash)
How:

- Implemented Gemini Flash call path using intent + AX/index context.
- Enforced typed output schema:
  - `{action, target, text, confidence, reasoning}`
- Added malformed JSON retry behavior.

Why:

- Typed schema is required to safely map model output to CDP commands.
- Flash-first aligns with cost/latency goals for AX-first tasks.

Result:

- Real action returned for live task:
  - `action: CLICK`, `confidence: 1.0` on Google search input
- Artifact: `docs/artifacts/phase1/phase1-1.6/google-mechanical-keyboards-action.json`.

### 1.7 CDP Action Execution
How:

- Mapped schema actions to CDP/JS execution:
  - `CLICK` -> mouse move/press/release
  - `TYPE` -> key events (`char` + special keys)
  - `SCROLL` -> wheel + `window.scrollBy`
  - `WAIT` -> delay
  - `EXTRACT` -> `Runtime.evaluate` returning JSON
  - `DONE`/`FAILED` -> terminal states
- Waited for navigation or mutation effects before returning.

Why:

- This is the bridge from model intent to actual browser behavior.
- Post-action waiting avoids racing ahead on stale state.

Result:

- End-to-end interaction steps executed against live Google flow, including extraction.
- Artifact: `docs/artifacts/phase1/phase1-1.7/google-action-execution.json`.

### 1.8 Loop Integration
How:

- Built orchestrator loop over shared components:
  - navigate -> perceive -> infer -> act -> repeat
- Added step limit (default `20`) and state logging.

Why:

- Converts independent building blocks into a usable autonomous agent loop.
- Safety limit prevents runaway loops.

Result:

- Live run completed with `DONE`, `4` steps, expected state progression.
- Artifact: `docs/artifacts/phase1/phase1-1.8/google-loop-result.json`.

## Optimizations We Intentionally Applied in Phase 1
These are the meaningful optimization choices already in place and their rationale.

- AX-first perception before image-heavy reasoning:
  - reduces token and latency cost by not forcing screenshot inference for every step.

- Normalization + pruning + budgets on AX payload:
  - keeps model context tractable and deterministic.

- Standardized viewport (`1280x900`, DPR 1):
  - avoids random scaling effects; keeps image payload bounded.

- JPEG quality target (`80`):
  - balances visual fidelity with payload size for model input.

- Scroll-and-stitch with fixed step + overlap + hard cap:
  - captures below-fold content while controlling runaway runtime and memory.

- Action-schema contract with validation:
  - avoids brittle free-form model text parsing and reduces execution errors.

- Post-action wait for navigation/mutation:
  - improves correctness by reducing stale-perception actions.

## Toon Encoding Decision (Post-Phase 1 Validation)
We validated an optional post-normalization AX encoding layer and promoted it to the default active path.

- Toggle behavior:
  - Default: `USE_TOON_ENCODING=true`
  - Debug fallback: set `USE_TOON_ENCODING=false` to instantly revert to raw normalized AX payloads.

- Measured loop-level impact (same Google end-to-end flow, 4 steps, identical `CLICK -> TYPE -> CLICK -> DONE`, confidence unchanged at `1.0`):
  - Average navigator normalized-tree payload: `6175` -> `2375` chars (`61.5%` reduction)
  - Average full observation payload: `9778` -> `5569` chars (`43.0%` reduction)

- Why this matters for Phase 2 concurrency (`6` Ghost Tabs):
  - Per perception step across 6 tabs:
    - baseline: `9778 * 6 = 58,668` chars
    - toon-encoded: `5569 * 6 = 33,414` chars
  - Savings: `25,254` chars per concurrent perception step (~`43%` less prompt payload before any model-side compression/tokenization effects).
  - This compounds directly in multi-step loops and should materially improve cost/latency at pool scale.

## What To Highlight in Final Submission Writeup
Critical points worth carrying forward:

- We built and validated against live websites and real browser processes; no stubbed execution path.
- Phase 1 established a concrete CDP-driven control plane, not a prompt-only prototype.
- The architecture is intentionally layered: Chromium execution via CDP, AI logic in orchestration.
- AX-first design is the key early cost/performance lever.
- Phase 1 included safety controls (max scroll, max steps, terminal states) from the start.
- Performance budget breaches (e.g., AX normalization >15ms on some pages) were surfaced explicitly rather than hidden, creating a clear Phase 10 tuning target.

## Quick Evidence Index
- Requirements baseline: `ghost_browser_requirements.docx.md`
- Build milestones baseline: `build-plan.md`
- Phase implementation notes: `docs/phase1/`
- Phase artifacts: `docs/artifacts/phase1/`
