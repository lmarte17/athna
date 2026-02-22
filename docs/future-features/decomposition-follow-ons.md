# Future Features: Decomposition Follow-Ons

This document tracks decomposition features from the delegation paper that are intentionally deferred from Phase 4.2 v1.

## Phase 4.2 v1 Baseline (Implemented Scope)

- Sequential subtask decomposition for intents with more than two implied steps.
- Subtask status lifecycle: `PENDING`, `IN_PROGRESS`, `COMPLETE`, `FAILED`.
- Verification contract per subtask (`type` + `condition`).
- Task-local checkpoint resume (`lastCompletedSubtaskIndex` + per-subtask artifacts).
- Retry from last checkpoint without replaying completed subtasks.
- Typed task-status updates for subtask progress.

## Deferred Features for Future Iterations

### 1. Multi-Plan Decomposition with Fallback Selection

- Description: Request `primary_plan` plus one or more fallback plans from the planner model.
- Why deferred: adds planner evaluation, plan switching policy, and recovery semantics beyond v1.
- Future acceptance target: on subtask failure, switch to fallback plan from current checkpoint before task-level failure.

### 2. Dependency-Aware Parallel Subtask Graph (DAG)

- Description: represent subtasks as a DAG with `depends_on` and `execution_mode` metadata; run independent nodes concurrently.
- Why deferred: requires aggregator semantics, deterministic merge behavior, and stronger scheduler guarantees.
- Future acceptance target: independent research subtasks execute concurrently while dependency-constrained subtasks remain serialized.

### 3. Human-Handoff Workflow Orchestration

- Description: first-class delegation from Ghost Tab to user for login/CAPTCHA/irreversible actions/explicit human-review nodes.
- Why deferred: requires UX contract, pause/resume semantics, and durable handoff state.
- Future acceptance target: task pauses with actionable prompt and resumes from checkpoint after user action.

### 4. Planner-Time Perception Hints

- Description: annotate subtasks with `perception_hint` (`ax_tree_sufficient`, `visual_required`, `unknown`) to pre-route model tier.
- Why deferred: needs reliable hint calibration to avoid regressions from premature tier routing.
- Future acceptance target: reduced unnecessary Tier 1/Tier 2 escalations without loss of success rate.

### 5. Adaptive Re-Planning Policy Engine

- Description: explicit trigger matrix for re-plan decisions (verification failures, repeated low confidence, stale progress, crash retries).
- Why deferred: v1 can meet checkpoint retry goals without a full policy engine.
- Future acceptance target: deterministic trigger-to-response mapping with observable reason codes.

### 6. Durable Checkpoint Persistence Across Process Restarts

- Description: persist decomposition/checkpoints outside in-memory task state for resume after orchestrator restart or crash.
- Why deferred: introduces storage schema/versioning and recovery safety requirements.
- Future acceptance target: interrupted tasks can be resumed from last verified subtask after restart.

## Suggested Sequencing

1. Multi-plan decomposition + fallback switching.
2. Planner-time perception hints.
3. Adaptive re-planning policy engine.
4. Human-handoff workflow.
5. Dependency-aware parallel DAG execution.
6. Durable checkpoint persistence.
