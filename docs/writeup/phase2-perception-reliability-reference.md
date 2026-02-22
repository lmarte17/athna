# Phase 2 Reference Writeup: Perception Reliability & Model Routing

## Purpose
This document consolidates what we implemented in Phase 2 (2.1-2.6), why each decision was made, and what results we got. It is meant as a memory-safe reference for the final submission writeup.

Primary Phase 2 goal from `build-plan.md`:

- The agent handles ambiguous pages, AX-deficient pages, and scrolling correctly, with cost-aware routing between Flash-first AX perception and screenshot-based vision fallback.

## Scope Summary
Implemented in Phase 2:

- Tiered perception router (Tier 1 AX -> Tier 2 Vision -> Tier 3 Scroll retry)
- Confidence-threshold enforcement (`0.75` default) with structured escalation telemetry
- AX-deficient page detection with page-readiness gating
- Above-the-fold and scroll-position heuristic for controlled exploration
- AX tree staleness detection with mutation-significance policy and conditional AX refetch
- DOM extraction via `Runtime.evaluate` as a vision-bypass optimization layer

Not implemented in Phase 2 (intentionally deferred):

- Ghost Tab pooling, queueing, and crash recovery (Phase 3)
- Network interception/prefetch/cache partition optimizations (Phase 5)
- Advanced task decomposition/checkpointing and long-horizon context caching (Phase 4)

## Browser-Layer Mapping (Requirements Alignment)
This is how Phase 2 work maps to `ghost_browser_requirements.docx.md` and why it matters.

- Perception decisioning (`Spec §04`):
  - We implemented the tiered decision matrix and escalation reasons (`LOW_CONFIDENCE`, `AX_DEFICIENT`, `NO_PROGRESS`, `UNSAFE_ACTION`, `RETRY_AFTER_SCROLL`).
  - Why: this is the core reliability layer for ambiguous or low-signal pages.

- Model routing (`Spec §08.1`):
  - Tier 1 uses Flash for AX-first low-cost perception; Tier 2 uses vision-enabled inference on viewport screenshots.
  - Why: keeps the common path cheap and fast while preserving a robust fallback.

- Scroll and fold awareness (`Spec §02`, `Spec §04`):
  - We added `window.scrollY`/viewport/document metrics and below-fold gating before repeated screenshot escalation.
  - Why: avoids blind scrolling and unnecessary vision calls when no new content remains.

- JS execution and DOM extraction (`Spec §03`, `Spec §06`):
  - We used `Runtime.evaluate` for AX-deficiency signals, scroll position snapshots, mutation observation, and DOM interactive extraction.
  - Why: browser-native JS is required for low-latency, structured fallback data.

- AX freshness policy (`Spec §04`):
  - We now refetch AX only on explicit triggers (`INITIAL`, `NAVIGATION`, `URL_CHANGED`, `SIGNIFICANT_DOM_MUTATION`, `SCROLL_ACTION`).
  - Why: prevents stale perceptions while avoiding redundant AX extraction work.

## Phase-by-Phase: How, Why, Results

### 2.1 Tiered Perception Protocol
How:

- Added explicit tier routing and tier usage accounting to the orchestrator.
- Implemented default complex smoke scenarios covering Tier 1, Tier 2, and Tier 3 paths.

Why:

- A single-model loop is not reliable on AX-deficient, visually complex, or below-fold tasks.

Result:

- Tier routing and escalation paths are captured per step and in suite-level aggregates.
- Artifacts:
  - `docs/artifacts/phase2/phase2-2.1/complex-suite-tiered-perception-result.json`
  - `docs/artifacts/phase2/phase2-2.1/scenarios/*.json`

### 2.2 Confidence Threshold & Escalation
How:

- Enforced threshold policy: Tier 1 actions are only executable when `confidence >= 0.75` (default).
- Added structured escalation events containing step, reason, URL, trigger/resolution confidence, and resolved tier.
- Escalated unsafe Tier 1 `FAILED` actions and low-confidence actions to Tier 2.

Why:

- Prevents low-confidence actions from executing directly against the page.
- Makes routing decisions auditable and testable.

Result:

- Smoke validation now fails on threshold policy violations or missing/inconsistent escalation telemetry.
- Escalation counters are emitted in `tierUsage` and event details in `escalations[]`.

### 2.3 AX-Deficient Page Detection
How:

- Added AX-deficiency gating that requires both:
  - low interactive count (`interactiveElementCount < threshold`)
  - page-level readiness signals (`isLoadComplete` and `hasSignificantVisualContent`)
- Added `axDeficientPages[]` evidence entries and per-step deficiency signals.

Why:

- Reduces false positives on early/incomplete page states and avoids unnecessary Tier 2 jumps.

Result:

- AX-deficient pages route directly to Tier 2 only when the page is loaded and visually meaningful.
- Evidence is preserved in both `history[].axDeficiencySignals` and `axDeficientPages[]`.

### 2.4 Scroll Control & Above-the-Fold Heuristic
How:

- Added scroll-position snapshots (`scrollY`, viewport/document height, remaining scroll, top/bottom flags).
- Added below-fold likelihood checks before repeated Tier 2 retries.
- Added fail-fast behavior when no-progress repeats and below-fold content is exhausted.

Why:

- Keeps exploration intentional and prevents wasteful screenshot loops near end-of-page boundaries.

Result:

- Tier 3 scroll behavior is constrained by page-position context and max-scroll policy.
- Step history now records `scrollPosition` and `targetMightBeBelowFold`.

### 2.5 AX Tree Staleness Detection
How:

- Upgraded post-action mutation analysis to structured metrics:
  - `addedOrRemovedNodeCount`
  - `interactiveRoleMutationCount`
  - `childListMutationCount`
  - `attributeMutationCount`
- Classified mutations as significant when:
  - `addedOrRemovedNodeCount >= 3`, or
  - `interactiveRoleMutationCount > 0`
- Added AX refetch reasoning and conditional reuse of prior AX perception snapshots.

Why:

- Re-fetching AX on every step is expensive; never refetching risks stale decisions.

Result:

- AX refetch is now policy-driven and observable through:
  - `history[].axTreeRefetched`
  - `history[].axTreeRefetchReason`
  - `history[].postActionMutationSummary`

### 2.6 DOM Extraction via JS (Vision Bypass)
How:

- Inserted a DOM-only bypass stage between escalation and Tier 2 screenshot capture.
- Extracted visible interactive elements via `Runtime.evaluate` with:
  - `tag`, `role`, `type`, `text`, `href`, `inputValue`, `computedStyle`, `boundingBox`
- Scored extracted candidates against normalized intent tokens; if unambiguous, emitted deterministic `CLICK` and skipped Tier 2.
- Added bypass telemetry and cost-avoidance metrics:
  - `domBypassResolutions`
  - `estimatedVisionCostAvoidedUsd`

Why:

- Many pages are AX-ambiguous but still DOM-legible without requiring a screenshot/model-vision call.

Result:

- Targeted validation run succeeded with true DOM bypass:
  - Tier 2 calls: `0`
  - DOM bypass resolutions: `1`
  - Estimated vision cost avoided: `0.003` USD
- Artifacts and logs include `history[].domBypassUsed` and related DOM extraction fields.

## Optimizations We Intentionally Applied in Phase 2
- Flash-first with explicit escalation instead of defaulting to vision on every step.
- AX-deficiency gating tied to page readiness signals to reduce false positives.
- Scroll/fold-aware retry policy to avoid blind re-capture loops.
- Mutation-significance thresholding to avoid unnecessary AX refetch churn.
- DOM extraction bypass to cut Tier 2 calls when target selection is deterministic.
- Structured telemetry everywhere (`history`, `escalations`, `tierUsage`) to support policy validation and cost analysis.

## Known Tradeoffs and Residual Risks
- Current DOM-bypass scorer is lexical and deterministic; it may miss semantically equivalent labels.
- AX-deficiency thresholds are global defaults and may need site-family tuning.
- Tier 2 still depends on screenshot inference quality when both AX and DOM bypass are ambiguous.
- Some scenarios can terminate at `MAX_STEPS` despite correct escalation behavior; this is currently expected for stress-style smoke cases.

## What To Highlight in Final Submission Writeup
- Phase 2 converted the Phase 1 loop into a policy-governed routing system, not just a best-effort heuristic chain.
- Reliability work focused on explicit decision contracts and measurable escalation telemetry.
- Cost was treated as a first-class dimension with observable tier usage and avoided-vision accounting.
- DOM extraction bypass demonstrates a concrete optimization layer between AX and vision.
- AX staleness logic now balances freshness and performance with explicit refetch reasons.

## Quick Evidence Index
- Requirements baseline: `ghost_browser_requirements.docx.md`
- Build milestones baseline: `build-plan.md`
- Phase 2 milestone notes:
  - `docs/phase2/phase2-2.1-tiered-perception-protocol.md`
  - `docs/phase2/phase2-2.2-confidence-threshold-escalation.md`
  - `docs/phase2/phase2-2.3-ax-deficient-page-detection.md`
  - `docs/phase2/phase2-2.4-scroll-control-above-the-fold-heuristic.md`
  - `docs/phase2/phase2-2.5-ax-tree-staleness-detection.md`
  - `docs/phase2/phase2-2.6-dom-extraction-vision-bypass.md`
- Smoke artifacts:
  - `docs/artifacts/phase2/phase2-2.1/complex-suite-tiered-perception-result.json`
  - `docs/artifacts/phase2/phase2-2.1/scenarios/*.json`
