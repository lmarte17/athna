# Phase 4 Reference Writeup: Navigator Engine Advanced

## Purpose
This document consolidates what we implemented in Phase 4 (4.1-4.4), why each decision was made, and what results we got. It is meant as a memory-safe reference for the final submission writeup.

Primary Phase 4 goal from `build-plan.md`:

- The Navigator Engine handles complex multi-step tasks, maintains bounded context windows, routes structured errors, and reuses observations inside a task session.

## Scope Summary
Implemented in Phase 4:

- Rolling context window management (last 5 action/observation pairs + archived summary)
- Prompt-budget estimation and token-alert telemetry in Navigator call paths
- Sequential task decomposition (v1) with runtime subtask status tracking
- Checkpoint-aware subtask retry behavior (retry current subtask, do not restart completed subtasks)
- Structured error object routing (`NETWORK`, `RUNTIME`, `CDP`, `TIMEOUT`) to Navigator decisions
- Retryable structured-error fallback policy (avoid immediate terminal failure)
- In-task observation cache (perception + decision + tier-2 screenshot) with task-local TTL

Not implemented in Phase 4 (intentionally deferred):

- Parallel subtask DAG execution, dependency-aware planning, and multi-plan fallback switching
- Human-handoff orchestration for decomposition failures
- Network interception/prefetch/cache partition policy stack (Phase 5)
- Phase 6 UI rendering of subtask/status/error timelines

## Browser-Layer Mapping (Requirements Alignment)
This is how Phase 4 work maps to `ghost_browser_requirements.docx.md` and why it matters.

- Context and long-horizon planning behavior (`Spec §08.1`):
  - Added rolling memory with summarization and token budgeting.
  - Added decomposition and checkpoint semantics for multi-step intents.
  - Why: keeps prompts bounded and execution state explicit during long tasks.

- Error handling and isolation (`Spec §01`, `Spec §03`, `Spec §08.1`):
  - Converted navigation/perception/action failures into structured objects routed back through Navigator.
  - Why: deterministic error contracts are safer and easier to recover from than ad hoc error-page interpretation.

- Observation reuse (`Spec §07`):
  - Added in-memory, per-task observation cache with TTL and invalidation hooks.
  - Why: reduces redundant AX extraction and repeated model inference on stable, same-URL steps.

## Phase-by-Phase: How, Why, Results

### 4.1 Context Window Management
How:

- Added `NavigatorContextWindowManager` with:
  - `recentPairLimit=5` default
  - deterministic archived summary generation (char-budgeted)
  - prompt-budget recording and token-alert thresholding.
- Wired context snapshots and budget telemetry into loop history and aggregate task result metrics.

Why:

- Long-running tasks need bounded prompt size, while still preserving outcome-relevant history.

Result:

- Context window cap held at 5 recent pairs in suite-level metrics.
- Archived summarization was exercised (`summaryRefreshCount=3`, `maxSummarizedPairCount=2` in the 4.1 suite summary).
- Prompt token estimates stayed bounded (`maxEstimatedPromptTokens=3112`, `tokenAlertCount=0` in the latest 4.1 summary).
- Artifact:
  - `docs/artifacts/phase4/phase4-4.1/context-window-management-result.json`

### 4.2 Task Decomposition & Checkpointing
How:

- Added heuristic decomposition (`generatedBy=HEURISTIC_V1`) that estimates implied step count and emits ordered subtasks.
- Added runtime subtask statuses (`PENDING`, `IN_PROGRESS`, `COMPLETE`, `FAILED`) and checkpoint state:
  - `lastCompletedSubtaskIndex`
  - `currentSubtaskAttempt`
  - `subtaskArtifacts[]`.
- Implemented retry-from-checkpoint behavior for current failed subtask only.
- Emitted subtask timeline events and aligned payload shape with typed `TASK_STATUS.kind=SUBTASK`.

Why:

- Multi-step intents require explicit plan state and recovery semantics to avoid full-task restart churn.

Result:

- Both smoke scenarios produced decomposed plans (`isDecomposed=true`, `impliedStepCount=8`, `totalSubtasks=5`).
- Retry path was exercised (`retryFromCheckpointEvents=1` and `2` in the two scenarios).
- Callback timeline parity checks passed against recorded `subtaskStatusTimeline`.
- Artifact:
  - `docs/artifacts/phase4/phase4-4.2/task-decomposition-checkpointing-result.json`

### 4.3 Structured Error Objects
How:

- Added structured error conversion at orchestration boundaries and routed those objects into Navigator observation payloads.
- Added structured error event timeline with:
  - source (`NAVIGATION`, `PERCEPTION`, `ACTION`, `UNHANDLED_EXCEPTION`)
  - normalized error payload
  - Navigator decision and decision source.
- Added retryable fallback policy to prevent immediate terminal failure when a retryable structured error maps to `FAILED`.

Why:

- Structured error objects make error reasoning deterministic and policy-driven.

Result:

- HTTP 404 mapped to `NETWORK` / `status=404` / `retryable=false` with `NAVIGATION` source.
- HTTP 503 mapped to `NETWORK` / `status=503` / `retryable=true`; Navigator returned `WAIT` in the validated run.
- Runtime fixture fault mapped to `RUNTIME` / `status=null` with `PERCEPTION` source.
- Structured-error scenarios avoided tier-2 perception path (`tier2Calls=0` assertion in smoke).
- Artifact:
  - `docs/artifacts/phase4/phase4-4.3/structured-error-objects-result.json`

### 4.4 Observation Cache
How:

- Added task-local in-memory observation cache manager with TTL (default `60000ms`) and metrics.
- Cached units:
  - perception payload (AX index/tree encoding/deficiency signals/scroll snapshot/AX hash)
  - decision payload keyed by `tier|escalationReason`
  - tier-2 screenshot payload.
- Integrated cache checks before AX extraction and model inference; added invalidation on navigation/significant mutation/scroll-driven refetch triggers.
- Exposed cache telemetry in step history and aggregate result (`observationCache` metrics).

Why:

- Repeated same-URL steps in stable flows should not pay repeated perception + inference costs.

Result:

- Within-task reuse scenario showed strong cache reuse:
  - `stepsTaken=6`
  - `navigatorCallCount=1`
  - `perceptionCacheHits=5`
  - `decisionCacheHits=5`
  - `cacheReuseWithoutRefetch=5`.
- New-task reset scenario confirmed task-local cache scope:
  - first step starts cold (`firstStepPerceptionCacheHit=false`, `firstStepDecisionCacheHit=false`).
- Artifact:
  - `docs/artifacts/phase4/phase4-4.4/observation-cache-result.json`

## Optimizations We Intentionally Applied in Phase 4
- Deterministic archived-summary generation to avoid extra model calls for context compression.
- Prompt token budgeting and alert plumbing at inference boundaries to bound context growth risk.
- Sequential decomposition/checkpoint v1 as a constrained, reliable baseline before DAG complexity.
- Structured error normalization with retryable fallback policy instead of raw failure-page interpretation.
- Observation-level cache reuse keyed by tier/escalation to reduce redundant model inference.
- Per-step and aggregate telemetry for context, decomposition, structured errors, and cache behavior.

## Known Tradeoffs and Residual Risks
- Decomposition is currently heuristic (`HEURISTIC_V1`), so clause quality may vary by intent phrasing.
- Current v1 decomposition is sequential only; no dependency graph scheduling yet.
- 4.x smoke scenarios frequently end in `FAILED`/`MAX_STEPS` by design while still validating control-plane behavior (policy, telemetry, and recovery contracts).
- Observation cache is URL-scoped in v1; very dynamic pages may need richer cache keys in future iterations.
- Structured-error recovery remains policy-constrained and may require task-type-specific retries in later phases.

## What To Highlight in Final Submission Writeup
- Phase 4 turned the Navigator from a short-loop actuator into a stateful execution controller with bounded memory and explicit progress semantics.
- Context control, decomposition checkpoints, structured errors, and observation caching are integrated, not isolated features.
- The work is instrumented end-to-end: each major policy has concrete step-level and aggregate telemetry.
- The implementation prioritizes deterministic control contracts first, with richer planning/parallelism deferred intentionally.

## Quick Evidence Index
- Requirements baseline: `ghost_browser_requirements.docx.md`
- Build milestones baseline: `build-plan.md`
- Phase 4 milestone notes:
  - `docs/phase4/phase4-4.1-context-window-management.md`
  - `docs/phase4/phase4-4.2-task-decomposition-checkpointing.md`
  - `docs/phase4/phase4-4.3-structured-error-objects.md`
  - `docs/phase4/phase4-4.4-observation-cache.md`
- Smoke artifacts:
  - `docs/artifacts/phase4/phase4-4.1/context-window-management-result.json`
  - `docs/artifacts/phase4/phase4-4.2/task-decomposition-checkpointing-result.json`
  - `docs/artifacts/phase4/phase4-4.3/structured-error-objects-result.json`
  - `docs/artifacts/phase4/phase4-4.4/observation-cache-result.json`
