# Phase 3 Reference Writeup: Ghost Tab Pool, Parallelism, and Recovery

## Purpose
This document consolidates what we implemented in Phase 3 (3.1-3.7), why each decision was made, and what results we got. It is meant as a memory-safe reference for the final submission writeup.

Primary Phase 3 goal from `build-plan.md`:

- Build isolated Ghost Tab execution at pool scale with typed status reporting, queueing, resource governance, and crash recovery.

## Scope Summary
Implemented in Phase 3:

- BrowserContext partition isolation and lifecycle reset guarantees
- Warm Ghost Tab pool manager with replenishment and queue support
- Enforced Ghost Tab task state machine and transition events
- Typed IPC schema with strict inbound/outbound validation and typed routing
- Parallel scheduler with FIFO queueing and foreground priority preemption
- Per-tab resource budget monitoring with configurable enforcement
- Crash detection, retry policy, and retry-exhaustion failure reporting

Not implemented in Phase 3 (intentionally deferred):

- Advanced Navigator decomposition/checkpointing/context-window features (Phase 4)
- Network-layer interception/prefetch/cache optimization suite (Phase 5)
- UI task-feed rendering and command-surface UX (Phase 6)

## Browser-Layer Mapping (Requirements Alignment)
This is how Phase 3 work maps to `ghost_browser_requirements.docx.md` and why it matters.

- Process architecture and Ghost Tab lifecycle (`Spec §05`):
  - We implemented context isolation, pool lifecycle management, state transitions, scheduler queueing, budgets, and retries.
  - Why: this is the core runtime contract that makes concurrent autonomous execution safe.

- Storage/session isolation (`Spec §05`, isolation requirements):
  - Ghost Tabs are partitioned via dedicated BrowserContext sessions and cleared on destruction/recreate.
  - Why: prevents cross-task leakage in cookies/local/session storage/IndexedDB/cache.

- Error isolation and resilience (`Spec §03`, `Spec §05`):
  - Renderer crash signals are detected and translated into task retry/failure outcomes without cascading task failure.
  - Why: one tab failure must not kill unrelated work or foreground behavior.

- IPC contract (`Spec §05`, typed orchestration boundary):
  - We standardized typed envelopes (`NAVIGATE`, `SCREENSHOT`, `AX_TREE`, `INJECT_JS`, `INPUT_EVENT`, `TASK_RESULT`, `TASK_ERROR`, `TASK_STATUS`) with strict validation.
  - Why: prevents ad hoc string routing and makes status/error handling deterministic.

## Phase-by-Phase: How, Why, Results

### 3.1 BrowserContext Isolation
How:

- Created Ghost Tabs with unique `session.fromPartition(...)` sessions.
- Validated per-context cookies, localStorage, sessionStorage, and IndexedDB separation.
- Validated partition-scoped cache behavior and storage clear on destroy/recreate.

Why:

- Parallel agent work is unsafe without strict context and storage boundaries.

Result:

- Storage remained isolated (`A` in context one, `B` in context two) and recreated context returned empty storage.
- HTTP cache demonstrated per-context partitioning (`hitCountAfterContextOneSecondNav=1`, then `2` only after context two first nav).
- Artifact: `docs/artifacts/phase3/phase3-3.1/browsercontext-isolation-result.json`.

### 3.2 Ghost Tab Pool Manager
How:

- Added pool slots with explicit states (`COLD`, `REPLENISHING`, `AVAILABLE`, `IN_USE`).
- Warmed a minimum pool at startup and replenished asynchronously.
- Added queueing when all warm slots are in use.

Why:

- Cold-starting every task is too slow for concurrent orchestration.

Result:

- Warm minimum held at init (`available=2`), replenishment promoted cold slots, and queued lease assignment completed successfully.
- Telemetry captured warm/queued waits and warm durations (`averageWarmDurationMs=25.667`, `queuedLeaseAssignmentWaitMs=1`).
- Artifact: `docs/artifacts/phase3/phase3-3.2/ghost-tab-pool-result.json`.

### 3.3 Ghost Tab State Machine
How:

- Enforced legal transitions for `IDLE -> LOADING -> PERCEIVING -> INFERRING -> ACTING -> COMPLETE/FAILED -> IDLE`.
- Emitted transition events per state change.
- Rejected illegal transitions with structured errors.

Why:

- A formal lifecycle is required for reliable orchestration, debugging, and status feed accuracy.

Result:

- Happy path completed expected transition chain and cleanup (`cleanupCallCount=1`).
- Failure path produced structured error detail and returned to `IDLE`.
- Illegal transition guard proved active (`ACTING -> IDLE` rejected).
- Artifact: `docs/artifacts/phase3/phase3-3.3/ghost-tab-state-machine-result.json`.

### 3.4 IPC Message Schema
How:

- Added typed message schema and validation at both boundaries.
- Routed requests by typed `type` switch instead of string parsing.
- Standardized `TASK_ERROR` mapping for malformed and runtime failures.

Why:

- Typed contracts reduce orchestration fragility and make error surfaces consistent.

Result:

- All required message families validated (`validatedFixtureCount=8`).
- Malformed payloads were rejected with structured validation details.
- Typed router processed all request types and converted failures to `TASK_ERROR`.
- Artifact: `docs/artifacts/phase3/phase3-3.4/ipc-message-schema-result.json`.

### 3.5 Parallel Task Scheduling and Queue
How:

- Added scheduler on top of pool with:
  - parallel dispatch up to pool capacity
  - overflow queueing
  - foreground priority preemption
  - typed queue/state/scheduler status emission

Why:

- Concurrent automation requires deterministic queue policy and observable dispatch behavior.

Result:

- With `poolSize=6`, max in-use reached `6`; overflow task queued and dispatched when slot freed.
- Foreground preemption verified (`queuedDispatchOrder=["task-8","task-7"]` where `task-8` had foreground priority).
- Queue telemetry captured depth and wait (`maxQueueDepth=2`, average queued wait `3097ms`).
- Artifact: `docs/artifacts/phase3/phase3-3.5/parallel-task-scheduling-queue-result.json`.

### 3.6 Resource Budgets per Ghost Tab
How:

- Added per-tab budget monitor using sampled CPU and memory metrics.
- Added sustained-violation window policy and enforcement mode (`WARN_ONLY` or `KILL_TAB`).
- Emitted scheduler events for budget violations.

Why:

- Parallel tabs need guardrails against runaway tab resource consumption.

Result:

- Budget violation was detected and enforced within target window (`violationLatencyMs=3017`, `<10s` requirement satisfied).
- Violating task failed with `RESOURCE_BUDGET_KILLED`; sibling task completed unaffected.
- Artifact: `docs/artifacts/phase3/phase3-3.6/resource-budgets-result.json`.

Note:

- The smoke harness uses aggressive thresholds to force deterministic violation quickly (`memoryBudgetMb=1`, `violationWindowMs=3000`), while scheduler defaults remain configurable for normal runtime policy.

### 3.7 Crash Recovery
How:

- Subscribed to crash signals (`Target.targetCrashed` / crash-like closure errors) in scheduler execution.
- Added retry policy (`maxRetries`, default 2) with per-attempt tracking.
- Added scheduler status events (`CRASH_DETECTED`, `RETRYING`, terminal `FAILED`).

Why:

- Renderer crashes are expected at scale and must not destabilize unrelated tasks.

Result:

- Recovering task: crashed once, retried on a fresh attempt, then succeeded (`attemptsUsed=2`).
- Exhaustion task: failed after configured limit (`attemptsUsed=3`, `exhaustRetryingCount=2`, terminal `FAILED=1`).
- Sibling task remained unaffected (`attemptsUsed=1`, `SUCCEEDED` event present).
- Artifact: `docs/artifacts/phase3/phase3-3.7/crash-recovery-result.json`.

## Optimizations We Intentionally Applied in Phase 3
- Warm-slot pooling to reduce per-task cold-start latency.
- Explicit queue policy with foreground preemption instead of best-effort dispatch.
- Strict lifecycle/state enforcement to prevent invalid task flows.
- Typed status channel (`TASK_STATUS`) across queue, state, and scheduler signals.
- Attempt-level retry accounting for crash diagnostics and post-run analysis.
- Resource monitoring with configurable enforcement mode to separate detection from kill policy.

## Known Tradeoffs and Residual Risks
- Under repeated forced-crash stress, some pool slots may remain `COLD`/`REPLENISHING` at snapshot time while asynchronous re-warm is in flight; this is observable in telemetry and does not block terminal task reporting.
- Crash stress paths can generate CDP reconnect timeouts in the harness environment; scheduler now contains these without process-level failure.
- Resource-budget smoke uses intentionally strict thresholds for deterministic validation and should not be confused with production policy defaults.

## What To Highlight in Final Submission Writeup
- Phase 3 turned the single-loop agent into a true concurrent runtime with isolation guarantees.
- Reliability is policy-driven and observable: queue events, state transitions, scheduler status, resource events, and crash retry telemetry are all typed.
- Failure handling is explicit: retries are bounded, exhaustion is cleanly surfaced, and sibling work continues.
- The phase delivers execution infrastructure (pool + queue + resilience) that later UX features can consume directly without re-architecting the core runtime.

## Quick Evidence Index
- Requirements baseline: `ghost_browser_requirements.docx.md`
- Build milestones baseline: `build-plan.md`
- Phase 3 milestone notes:
  - `docs/phase3/phase3-3.1-browsercontext-isolation.md`
  - `docs/phase3/phase3-3.2-ghost-tab-pool-manager.md`
  - `docs/phase3/phase3-3.3-ghost-tab-state-machine.md`
  - `docs/phase3/phase3-3.4-ipc-message-schema.md`
  - `docs/phase3/phase3-3.5-parallel-task-scheduling-queue.md`
  - `docs/phase3/phase3-3.6-resource-budgets.md`
  - `docs/phase3/phase3-3.7-crash-recovery.md`
- Smoke artifacts:
  - `docs/artifacts/phase3/phase3-3.1/browsercontext-isolation-result.json`
  - `docs/artifacts/phase3/phase3-3.2/ghost-tab-pool-result.json`
  - `docs/artifacts/phase3/phase3-3.3/ghost-tab-state-machine-result.json`
  - `docs/artifacts/phase3/phase3-3.4/ipc-message-schema-result.json`
  - `docs/artifacts/phase3/phase3-3.5/parallel-task-scheduling-queue-result.json`
  - `docs/artifacts/phase3/phase3-3.6/resource-budgets-result.json`
  - `docs/artifacts/phase3/phase3-3.7/crash-recovery-result.json`
