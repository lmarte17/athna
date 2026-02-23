# Ghost Browser — Build Plan: Phase 9

> **Active Phase:** Phase 9 — Cloud Deployment & Infrastructure
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
| **Phase 8**  | Storage Layer                          | Persistent local storage for context-scoped task results and applets, verified session isolation, SQLite task store, applet output persistence, cookie/auth passthrough with consent UX, and SQLCipher encryption at rest.                                        |
| **Phase 10** | Performance Tuning & Observability     | Meets all spec performance targets and measures multi-context UX overhead. Enables CDP Performance domain metrics, benchmarks TTFB/load/memory targets, profiles AX tree normalization, and implements Gemini API rate limit queuing with exponential backoff.   |
| **Phase 11** | Security Hardening                     | Hardens the JS API allowlist (AST-level scanning), enforces BrowserContext lifecycle destruction across context switches, builds the cookie passthrough consent UX, and stress-tests Ghost Tab crash isolation.                                                    |
| **Phase 12** | Demo, Submission & Polish              | Everything needed for hackathon submission: demo video, architecture diagram, README, proof of GCP deployment, written description, and optional blog post and GDG profile.                                                                                      |

---

## Phase 9: Cloud Deployment & Infrastructure

**Goal:** The Cloud Run backend is live, proxying Gemini API calls, logging task + context events, and deployed via IaC.

### 9.1 Cloud Run Backend — Gemini API Proxy

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Build and deploy a Cloud Run service that proxies all Gemini API calls                                                                                                                                                                                                                                                                                                |
| **Actions**      | Create a Node.js (or Python) service that: accepts inference requests from the local Electron app, forwards them to the Gemini API with server-side API key management, returns responses to the client. Include context metadata passthrough (`context_id`, `top_tab_id`, `ghost_tab_id`) for observability and prioritization. Handle rate limiting with exponential backoff. Request logging (see 9.3). Centralized API key management — key is never exposed in the Electron app binary. |
| **Acceptance**   | Local Electron app sends inference requests (with context metadata) to Cloud Run endpoint. Cloud Run forwards to Gemini API and returns results. API key is only on the server side. Rate limiting works correctly under load.                                                                                                                                       |
| **Req Coverage** | Spec §10 (Gemini API Proxy), Hackathon req (Google Cloud service)                                                                                                                                                                                                                                                                                                     |

### 9.2 Authentication (Google Identity Platform)

| Item             | Detail                                                                                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Secure the Cloud Run service with OIDC authentication                                                                                                                                                                                   |
| **Actions**      | Configure Google Identity Platform for user authentication. Local Electron app authenticates on startup using Google Sign-In. Cloud Run service validates OIDC tokens on every request. Unauthenticated requests are rejected with 401. |
| **Acceptance**   | Only authenticated Electron clients can call the Cloud Run service. Invalid tokens are rejected. Token refresh works correctly.                                                                                                         |
| **Req Coverage** | Spec §10 (Authentication)                                                                                                                                                                                                               |

### 9.3 Task Logging (Cloud Logging)

| Item             | Detail                                                                                                                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Task**         | Log all task events to Google Cloud Logging                                                                                                                                                                                                                                    |
| **Actions**      | Cloud Run service logs to Cloud Logging. Each log entry includes: `task_id`, `context_id`, `top_tab_id`, `ghost_tab_id`, `user_id` (hashed), `timestamp`, `model_used` (Flash/Pro), `action_type`, `tier_used`, `confidence`, `status`, and `context_switch_event` when applicable. Structured log format for easy querying. Log retention per Cloud Logging defaults. |
| **Acceptance**   | Task/context events are visible in Cloud Logging console. Logs are queryable by task_id, context_id, model_used, tier_used. Tiered perception effectiveness and context-switch behavior are measurable from logs.                                                                              |
| **Req Coverage** | Spec §10 (Task Logging), Hackathon req (proof of GCP deployment)                                                                                                                                                                                                               |

### 9.4 Scaling Configuration

| Item             | Detail                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Configure Cloud Run auto-scaling                                                                                                                                    |
| **Actions**      | Set min-instances: 1 (prevents cold start). Max-instances: 10. Concurrency: 80 requests per instance. Configure appropriate CPU and memory allocation per instance. Validate scaling under multi-context activity (active context + background contexts) and ensure active-context requests can be prioritized when queue pressure rises. |
| **Acceptance**   | Service handles concurrent requests up to configured limits. Cold start is avoided with min-instances: 1. Scaling behavior is observed under simulated multi-context load with active-context prioritization preserved.                                                                              |
| **Req Coverage** | Spec §10 (Scaling)                                                                                                                                                  |

### 9.5 Infrastructure-as-Code (Terraform)

| Item             | Detail                                                                                                                                                                                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Define all cloud infrastructure in Terraform                                                                                                                                                                                                                                                               |
| **Actions**      | Create Terraform configuration in `terraform/` directory: Cloud Run service definition, IAM bindings, Cloud Logging configuration (including context-aware log fields/queries), Google Identity Platform setup (if applicable), container registry. Include `terraform plan` and `terraform apply` instructions in README. Commit to public repository. |
| **Acceptance**   | `terraform apply` provisions the full backend from scratch. Configuration is version-controlled. Context-aware logging/monitoring resources are included. Teardown via `terraform destroy` works cleanly.                                                                                                 |
| **Req Coverage** | Spec §10 (IaC), Hackathon bonus (automated cloud deployment)                                                                                                                                                                                                                                               |
