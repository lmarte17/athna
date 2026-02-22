# Ghost Browser — Build Plan: Phase 3

> **Active Phase:** Phase 3 — Ghost Tab Pool & Parallelism
> Full build plan: [build-plan.md](./build-plan.md)

---

## Other Phases at a Glance

| Phase        | Goal                                   | Summary                                                                                                                                                                                                                                                          |
| ------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 0**  | Project Scaffolding & Dev Environment  | Establishes the monorepo structure, Electron shell, and a working Gemini SDK integration spike. The output is a working Electron app that can call Gemini API — no agentic behavior yet.                                                                         |
| **Phase 1**  | Core Perception–Action Loop            | A single Ghost Tab loads a page, perceives it via the AX tree, sends perception to Gemini, receives an action, executes it via CDP, and loops. Covers CDP client setup, screenshot pipeline, AX tree extraction, Navigator Engine (Flash), and action execution. |
| **Phase 2**  | Perception Reliability & Model Routing | Handles ambiguous pages, AX-deficient pages, and scrolling correctly. Implements the three-tier perception protocol, confidence thresholding, staleness detection, and a DOM-extraction bypass layer.                                                            |
| **Phase 4**  | Navigator Engine — Advanced            | The Navigator Engine handles complex multi-step tasks via context window rolling, task decomposition with checkpointing, structured error objects, and an in-session observation cache.                                                                          |
| **Phase 5**  | Networking Optimizations               | Ghost Tabs load faster through request interception/asset filtering, connection pool isolation, predictive prefetch, structured network error handling, and per-context HTTP cache partitioning.                                                                 |
| **Phase 6**  | Command Bar & UX Layer                 | The foreground Electron window gains a polished natural-language command bar, intent classification, a real-time task status sidebar, result cards with confidence indicators, ghost tab peek view, and task cancellation.                                       |
| **Phase 7**  | Maker Engine & Applets                 | Generates interactive single-use HTML/JS/CSS applets from structured task data. Covers the applet brief schema, generation via Gemini, 3-layer output validation, sandboxed iframe execution, lifecycle management, visualization types, and data sanitization.  |
| **Phase 8**  | Storage Layer                          | Persistent local storage for task results and applets, verified session isolation, SQLite task store, applet output persistence, cookie/auth passthrough with consent UX, and SQLCipher encryption at rest.                                                      |
| **Phase 9**  | Cloud Deployment & Infrastructure      | Cloud Run Gemini API proxy, OIDC authentication, Cloud Logging for task events, auto-scaling configuration, and full Terraform IaC for reproducible deployment.                                                                                                  |
| **Phase 10** | Performance Tuning & Observability     | Meets all spec performance targets. Enables CDP Performance domain metrics, benchmarks TTFB/load/memory targets, profiles AX tree normalization, and implements Gemini API rate limit queuing with exponential backoff.                                          |
| **Phase 11** | Security Hardening                     | Hardens the JS API allowlist (AST-level scanning), enforces BrowserContext lifecycle destruction, builds the cookie passthrough consent UX, and stress-tests Ghost Tab crash isolation.                                                                          |
| **Phase 12** | Demo, Submission & Polish              | Everything needed for hackathon submission: demo video, architecture diagram, README, proof of GCP deployment, written description, and optional blog post and GDG profile.                                                                                      |

---

## Phase 3: Ghost Tab Pool & Parallelism

**Goal:** Multiple Ghost Tabs run concurrently with proper isolation, lifecycle management, and resource controls.

### 3.1 BrowserContext Isolation

| Item             | Detail                                                                                                                                                                                                                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Ensure each Ghost Tab uses a fully isolated BrowserContext                                                                                                                                                                                                                                                           |
| **Actions**      | Create each Ghost Tab as a new `BrowserContext` in Electron (via `session.fromPartition` with unique partition names). Verify isolation: cookies, localStorage, sessionStorage, IndexedDB, and HTTP cache are all separate per context. Implement context destruction that atomically clears all associated storage. |
| **Acceptance**   | Two Ghost Tabs logged into different accounts on the same site do not interfere. Destroying one context does not affect the other. No residual storage after context destruction.                                                                                                                                    |
| **Req Coverage** | Spec §05 (BrowserContext Isolation, Context Lifecycle), §07 (Session Storage Isolation)                                                                                                                                                                                                                              |

### 3.2 Ghost Tab Pool Manager

| Item             | Detail                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Implement a warm pool of pre-initialized headless BrowserWindows                                                                                                                                                                                                                                                                        |
| **Actions**      | Pool configuration: minimum 2, maximum 6 (configurable), constrained by available RAM. On startup, pre-initialize minimum pool size. When a task is assigned, pull from pool and replenish asynchronously. Track pool state: available, in-use, replenishing. Measure cold-start elimination: target ~80ms savings per task assignment. |
| **Acceptance**   | Task assignment from pool is near-instant (< 10ms). Pool replenishes in background. Pool exhaustion triggers queuing (not failure).                                                                                                                                                                                                     |
| **Req Coverage** | Spec §05 (Ghost Tab Pool)                                                                                                                                                                                                                                                                                                               |

### 3.3 Ghost Tab State Machine

| Item             | Detail                                                                                                                                                                                                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Implement the formal state machine for Ghost Tab lifecycle                                                                                                                                                                                                                                                                                |
| **Actions**      | States: `IDLE` → `LOADING` → `PERCEIVING` → `INFERRING` → `ACTING` → `COMPLETE` or `FAILED`. Transitions enforced: no action can execute in PERCEIVING state, no perception in ACTING state, etc. State changes emit events for the task status feed. FAILED state includes error detail object. COMPLETE state triggers context cleanup. |
| **Acceptance**   | State transitions are logged and observable. Invalid transitions (e.g., ACTING → IDLE) are rejected. Status feed receives state change events.                                                                                                                                                                                            |
| **Req Coverage** | Spec §05 (Ghost Tab State Machine)                                                                                                                                                                                                                                                                                                        |

### 3.4 IPC Message Schema

| Item             | Detail                                                                                                                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Define and enforce typed IPC messages between Ghost Tabs and orchestration layer                                                                                                                                                                                                            |
| **Actions**      | Define typed schema for messages: `NAVIGATE`, `SCREENSHOT`, `AX_TREE`, `INJECT_JS`, `INPUT_EVENT`, `TASK_RESULT`, `TASK_ERROR`. Implement using Electron IPC (ipcMain/ipcRenderer) with TypeScript interfaces for each message type. Validate messages at both send and receive boundaries. |
| **Acceptance**   | All Ghost Tab ↔ orchestration communication uses typed messages. Malformed messages are rejected with error details. No string parsing for routing model outputs to CDP commands.                                                                                                           |
| **Req Coverage** | Spec §05 (IPC Message Schema)                                                                                                                                                                                                                                                               |

### 3.5 Parallel Task Scheduling & Queue

| Item             | Detail                                                                                                                                                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Enable concurrent Ghost Tab execution with queuing                                                                                                                                                                                                       |
| **Actions**      | Orchestration layer accepts N concurrent tasks where N = pool size. Excess tasks enter a FIFO queue. Foreground-initiated tasks get priority override (jump to front of queue). Track queue depth and wait times. Emit queue status to task status feed. |
| **Acceptance**   | 6 tasks run concurrently with a pool of 6. 7th task queues and executes when a slot frees. Priority task preempts queue position.                                                                                                                        |
| **Req Coverage** | Spec §05 (Parallel Task Scheduling)                                                                                                                                                                                                                      |

### 3.6 Resource Budgets per Ghost Tab

| Item             | Detail                                                                                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Task**         | Enforce CPU and memory limits on each Ghost Tab                                                                                                                                                                                                                          |
| **Actions**      | Defaults: CPU 25% of one core, Memory 512MB per Ghost Tab. Monitor via Electron/Node.js process metrics. If a Ghost Tab exceeds budget for > 10 seconds, flag it. Optionally kill the tab (configurable: warn-only vs. kill). Log resource violations with task context. |
| **Acceptance**   | An infinite-scroll page that consumes excessive memory is flagged within 10s. Flagged tabs can be killed without affecting other tabs or the foreground window.                                                                                                          |
| **Req Coverage** | Spec §05 (Resource Budget per Ghost Tab)                                                                                                                                                                                                                                 |

### 3.7 Crash Recovery

| Item             | Detail                                                                                                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Handle Ghost Tab renderer crashes gracefully                                                                                                                                                                                                                                                            |
| **Actions**      | Listen for CDP `Target.targetCrashed` events. On crash: log failure details, assign a fresh Ghost Tab from pool, retry the task (up to 2 retries). After 2 failed retries, return FAILED status with crash details to the user. Ensure crash does not affect other Ghost Tabs or the foreground window. |
| **Acceptance**   | Simulated renderer crash triggers automatic retry on a fresh tab. After 2 retries, failure is reported cleanly. No cascading failures.                                                                                                                                                                  |
| **Req Coverage** | Spec §05 (Crash Recovery)                                                                                                                                                                                                                                                                               |
