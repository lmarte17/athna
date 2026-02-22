# Ghost Browser — Build Plan: Phase 10

> **Active Phase:** Phase 10 — Performance Tuning & Observability
> Full build plan: [build-plan.md](./build-plan.md)

---

## Other Phases at a Glance

| Phase        | Goal                                   | Summary                                                                                                                                                                                                                                                          |
| ------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 0**  | Project Scaffolding & Dev Environment  | Establishes the monorepo structure, Electron shell, and a working Gemini SDK integration spike. The output is a working Electron app that can call Gemini API — no agentic behavior yet.                                                                         |
| **Phase 1**  | Core Perception–Action Loop            | A single Ghost Tab loads a page, perceives it via the AX tree, sends perception to Gemini, receives an action, executes it via CDP, and loops. Covers CDP client setup, screenshot pipeline, AX tree extraction, Navigator Engine (Flash), and action execution. |
| **Phase 2**  | Perception Reliability & Model Routing | Handles ambiguous pages, AX-deficient pages, and scrolling correctly. Implements the three-tier perception protocol, confidence thresholding, staleness detection, and a DOM-extraction bypass layer.                                                            |
| **Phase 3**  | Ghost Tab Pool & Parallelism           | Multiple Ghost Tabs run concurrently with full BrowserContext isolation, a warm pool manager, a formal state machine, typed IPC messages, parallel task scheduling, resource budgets, and crash recovery.                                                        |
| **Phase 4**  | Navigator Engine — Advanced            | The Navigator Engine handles complex multi-step tasks via context window rolling, task decomposition with checkpointing, structured error objects, and an in-session observation cache.                                                                          |
| **Phase 5**  | Networking Optimizations               | Ghost Tabs load faster through request interception/asset filtering, connection pool isolation, predictive prefetch, structured network error handling, and per-context HTTP cache partitioning.                                                                 |
| **Phase 6**  | Command Bar & UX Layer                 | The foreground Electron window gains a polished natural-language command bar, intent classification, a real-time task status sidebar, result cards with confidence indicators, ghost tab peek view, and task cancellation.                                       |
| **Phase 7**  | Maker Engine & Applets                 | Generates interactive single-use HTML/JS/CSS applets from structured task data. Covers the applet brief schema, generation via Gemini, 3-layer output validation, sandboxed iframe execution, lifecycle management, visualization types, and data sanitization.  |
| **Phase 8**  | Storage Layer                          | Persistent local storage for task results and applets, verified session isolation, SQLite task store, applet output persistence, cookie/auth passthrough with consent UX, and SQLCipher encryption at rest.                                                      |
| **Phase 9**  | Cloud Deployment & Infrastructure      | Cloud Run Gemini API proxy, OIDC authentication, Cloud Logging for task events, auto-scaling configuration, and full Terraform IaC for reproducible deployment.                                                                                                  |
| **Phase 11** | Security Hardening                     | Hardens the JS API allowlist (AST-level scanning), enforces BrowserContext lifecycle destruction, builds the cookie passthrough consent UX, and stress-tests Ghost Tab crash isolation.                                                                          |
| **Phase 12** | Demo, Submission & Polish              | Everything needed for hackathon submission: demo video, architecture diagram, README, proof of GCP deployment, written description, and optional blog post and GDG profile.                                                                                      |

---

## Phase 10: Performance Tuning & Observability

**Goal:** Meet all performance targets defined in the spec. Instrument the system for ongoing monitoring.

### 10.1 Render Timing Observability

| Item             | Detail                                                                                                                                                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Enable CDP Performance domain metrics on all Ghost Tabs                                                                                                                                                                                                     |
| **Actions**      | Enable `Performance.enable()` on every Ghost Tab after creation. After each navigation, collect `Performance.getMetrics()`: `LayoutCount`, `RecalcStyleCount`, `PaintCount`, `ScriptDuration`, `TaskDuration`. Log per-navigation for performance analysis. |
| **Acceptance**   | Performance metrics are collected for every Ghost Tab navigation. Metrics are logged and queryable for tuning decisions.                                                                                                                                    |
| **Req Coverage** | Spec §02 (Render Timing Observability), §06 (`Performance.getMetrics`)                                                                                                                                                                                      |

### 10.2 Performance Target Validation

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Task**         | Measure and validate against all spec-defined performance targets                                                                                                                                                                                                                                                                                                                                                                                      |
| **Actions**      | Benchmark the following and compare to targets: TTFB (Ghost Tab, assets blocked) < 800ms on broadband for e-commerce pages. Prefetch TTFB reduction: 150-300ms on predicted navigations. Asset-blocked load time: ≥ 40% reduction vs. full load. Ghost Tab memory: ~60MB (down from ~120MB with GPU). Tier 1 resolution rate: target 80%+ of navigations. Pool cold-start elimination: ~80ms savings. Document results and areas needing optimization. |
| **Acceptance**   | Performance targets are measured. Results are documented. Any missed targets have documented remediation plans.                                                                                                                                                                                                                                                                                                                                        |
| **Req Coverage** | Spec §01 (Performance Targets), §02 (Viewport & Screenshot Standards), §04 (Tiered Perception cost targets)                                                                                                                                                                                                                                                                                                                                            |

### 10.3 AX Tree Normalization Performance

| Item             | Detail                                                                                                                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Profile and optimize AX tree normalization                                                                                                                                                                           |
| **Actions**      | Profile normalization on large AX trees (500+ nodes). If normalization exceeds 15ms synchronous, consider moving to a Worker thread. Benchmark across 20 representative sites. Optimize pruning algorithm if needed. |
| **Acceptance**   | Normalization completes in < 15ms for 95% of pages. Worker thread fallback is available if needed.                                                                                                                   |
| **Req Coverage** | Spec Appendix (AX Tree Normalization Performance open question)                                                                                                                                                      |

### 10.4 Rate Limit Handling (Gemini API)

| Item             | Detail                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Implement request queuing with exponential backoff for Gemini API rate limits                                                                                                                                                                                                                                                          |
| **Actions**      | Design a request queue in the Cloud Run proxy. Under parallel Ghost Tab usage (6 concurrent tabs, ~2 model calls per navigation step = 12 RPM potential burst), implement: per-model rate tracking, exponential backoff on 429 responses, request prioritization (foreground > background). Log rate limit hits for capacity planning. |
| **Acceptance**   | Parallel Ghost Tab usage does not cause unhandled rate limit errors. Backoff is smooth and transparent to the user. Rate limit events are logged.                                                                                                                                                                                      |
| **Req Coverage** | Spec Appendix (Rate Limit Handling open question)                                                                                                                                                                                                                                                                                      |
