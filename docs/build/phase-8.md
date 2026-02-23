# Ghost Browser — Build Plan: Phase 8

> **Active Phase:** Phase 8 — Storage Layer
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
| **Phase 6**  | Command Bar & UX Layer                 | Foreground UI adopts a dual-row workspace: top-row user context tabs and per-context Ghost Tab rows, with natural-language command bar, context switching, live status, read-only Ghost visibility, and cancellation.                                            |
| **Phase 7**  | Maker Engine & Applets                 | Generates interactive single-use HTML/JS/CSS applets from structured task data, scoped to the active top-tab context. Covers the applet brief schema, generation via Gemini, 3-layer output validation, sandboxed iframe execution, lifecycle management, visualization types, and data sanitization. |
| **Phase 9**  | Cloud Deployment & Infrastructure      | Cloud Run Gemini API proxy, OIDC authentication, Cloud Logging for task and context events, auto-scaling configuration, and full Terraform IaC for reproducible deployment.                                                                                       |
| **Phase 10** | Performance Tuning & Observability     | Meets all spec performance targets and measures multi-context UX overhead. Enables CDP Performance domain metrics, benchmarks TTFB/load/memory targets, profiles AX tree normalization, and implements Gemini API rate limit queuing with exponential backoff.   |
| **Phase 11** | Security Hardening                     | Hardens the JS API allowlist (AST-level scanning), enforces BrowserContext lifecycle destruction across context switches, builds the cookie passthrough consent UX, and stress-tests Ghost Tab crash isolation.                                                    |
| **Phase 12** | Demo, Submission & Polish              | Everything needed for hackathon submission: demo video, architecture diagram, README, proof of GCP deployment, written description, and optional blog post and GDG profile.                                                                                      |

---

## Phase 8: Storage Layer

**Goal:** Persistent local storage for context-scoped task results, applets, and secure cookie handling.

### 8.1 Session Storage Isolation

| Item             | Detail                                                                                                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Verify and enforce complete browser storage isolation per Ghost Tab                                                                                                                                                         |
| **Actions**      | Confirm that BrowserContext isolation (Phase 3.1) covers all browser storage types: cookies, localStorage, sessionStorage, IndexedDB, HTTP cache. Add integration tests that verify isolation across concurrent Ghost Tabs and across different top-tab context groups during context switching. |
| **Acceptance**   | Two Ghost Tabs on the same domain have completely independent storage. Switching top tabs does not leak storage between context groups. Context destruction clears all storage atomically.                                  |
| **Req Coverage** | Spec §07 (Session Storage Isolation)                                                                                                                                                                                        |

### 8.2 Task Result Store (SQLite)

| Item             | Detail                                                                                                                                                                                                                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Implement persistent storage for completed task results                                                                                                                                                                                                                                                                                      |
| **Actions**      | Install `better-sqlite3`. Create schema: `tasks(task_id TEXT PRIMARY KEY, context_id TEXT, top_tab_id TEXT, timestamp INTEGER, intent TEXT, status TEXT, result_json TEXT, source_urls TEXT)`. Store results on task completion. Provide query API for the foreground UI to display past results by active context and global history. Provide query API for the Maker Engine to access multi-task aggregated data within a context. |
| **Acceptance**   | Completed task results persist across app restarts. Past results are queryable by context_id, intent, status, and timestamp. Maker Engine can aggregate data from multiple completed tasks without crossing context boundaries unless explicitly requested. |
| **Req Coverage** | Spec §07 (Task Result Store)                                                                                                                                                                                                                                                                                                                 |

### 8.3 Applet Output Persistence

| Item             | Detail                                                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Task**         | Persist generated applets for re-opening without re-generation                                                                                                                                               |
| **Actions**      | Store validated applet HTML strings in the task result store, associated with source `task_id` and `context_id`. Maximum 50 stored applets (LRU eviction). Provide "re-open applet" functionality from past task results in the owning context, with explicit duplicate-to-current-context control when needed. |
| **Acceptance**   | User can re-open a previously generated applet without re-running the agent or calling the Maker Engine. Re-open defaults to the owning context and does not leak data into other contexts unless user explicitly duplicates it. Oldest applets are evicted when the 50-applet limit is reached. |
| **Req Coverage** | Spec §07 (Applet Output Persistence)                                                                                                                                                                         |

### 8.4 Cookie / Auth Passthrough

| Item             | Detail                                                                                                                                                                                                                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Enable authenticated Ghost Tab tasks by cloning foreground cookies                                                                                                                                                                                                                                                                 |
| **Actions**      | Implement API to clone cookies from the foreground BrowserContext to a Ghost Tab BrowserContext for a specific domain and active top-tab context only. Require explicit user permission per domain (permission dialog in the foreground UI). Only clone cookies for the requested domain and context — no cross-domain or cross-context cookie leakage. Log all cookie passthrough events with context metadata. |
| **Acceptance**   | User grants permission for amazon.com in Context A. Ghost Tab in Context A can access the user's authenticated Amazon session. Cookies for other domains or contexts are not cloned. Permission is required each time (not remembered — per the spec's security intent).                                                         |
| **Req Coverage** | Spec §07 (Cookie / Auth Passthrough)                                                                                                                                                                                                                                                                                               |

### 8.5 Storage Encryption (SQLCipher)

| Item             | Detail                                                                                                                                                                                                                                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Encrypt the task result SQLite database at rest                                                                                                                                                                                                                                                                              |
| **Actions**      | Replace `better-sqlite3` with `@journeyapps/sqlcipher` (or equivalent SQLCipher binding). Derive encryption key from a user-specific local credential (e.g., Electron's `safeStorage` API for OS-level keychain integration). Encrypt the database on creation. Verify that the database file is unreadable without the key. |
| **Acceptance**   | Task result database is encrypted at rest. Opening the raw database file without the key fails. Normal read/write operations work transparently with the key.                                                                                                                                                                |
| **Req Coverage** | Spec §07 (Storage Encryption)                                                                                                                                                                                                                                                                                                |
