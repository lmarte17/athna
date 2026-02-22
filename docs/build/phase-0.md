# Ghost Browser — Build Plan: Phase 0

> **Active Phase:** Phase 0 — Project Scaffolding & Dev Environment
> Full build plan: [build-plan.md](./build-plan.md)

---

## Other Phases at a Glance

| Phase        | Goal                                   | Summary                                                                                                                                                                                                                                                          |
| ------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 1**  | Core Perception–Action Loop            | A single Ghost Tab loads a page, perceives it via the AX tree, sends perception to Gemini, receives an action, executes it via CDP, and loops. Covers CDP client setup, screenshot pipeline, AX tree extraction, Navigator Engine (Flash), and action execution. |
| **Phase 2**  | Perception Reliability & Model Routing | Handles ambiguous pages, AX-deficient pages, and scrolling correctly. Implements the three-tier perception protocol, confidence thresholding, staleness detection, and a DOM-extraction bypass layer.                                                            |
| **Phase 3**  | Ghost Tab Pool & Parallelism           | Multiple Ghost Tabs run concurrently with full BrowserContext isolation, a warm pool manager, a formal state machine, typed IPC messages, parallel task scheduling, resource budgets, and crash recovery.                                                        |
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

## Phase 0: Project Scaffolding & Dev Environment

**Goal:** A working Electron app that opens a window and can call the Gemini API. Nothing agentic yet — just plumbing.

### 0.1 Repository & Toolchain Setup

| Item           | Detail                                                                                                                                                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**       | Initialize the public Git repo with monorepo structure                                                                                                                                                                                                                              |
| **Actions**    | Create repo with directories: `electron/` (shell), `orchestration/` (CDP + AI glue), `cloud/` (Cloud Run service), `terraform/` (IaC), `docs/` (diagrams, writeup). Add `.gitignore`, `package.json` at root with workspace config. Install dev deps: TypeScript, ESLint, Prettier. |
| **Acceptance** | `npm install` succeeds. Linting and type-check pass on empty project. CI stub (GitHub Actions) runs.                                                                                                                                                                                |

### 0.2 Electron Shell Bootstrap

| Item             | Detail                                                                                                                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Create a minimal Electron app with one BrowserWindow                                                                                                                                                                                                            |
| **Actions**      | Set up `electron/main.ts` with a single foreground BrowserWindow loading a blank HTML page. Verify `BrowserWindow` can be created in headless mode (`show: false`) for Ghost Tab prototyping. Confirm Electron version supports `--headless=new` flag behavior. |
| **Acceptance**   | `npm start` opens an Electron window. A second headless BrowserWindow can be spawned programmatically and navigated to a URL.                                                                                                                                   |
| **Req Coverage** | Spec §01 (Shell Layer), §05 (Process Architecture — foundational)                                                                                                                                                                                               |

### 0.3 Gemini SDK Integration Spike

| Item             | Detail                                                                                                                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Task**         | Prove round-trip communication with the Gemini API using `@google/genai` SDK                                                                                                                                                                                                   |
| **Actions**      | Install `@google/genai`. Write a minimal Node.js script that sends a text prompt to Gemini Flash and prints the response. Test with a vision-capable model by sending a base64 JPEG screenshot and a text prompt asking to describe it. Verify structured JSON output parsing. |
| **Acceptance**   | Script returns valid Gemini responses for both text-only and multimodal (text+image) prompts. Response parsing extracts structured data.                                                                                                                                       |
| **Req Coverage** | Spec §08 (AI Engine Layer — foundational), Hackathon req (Gemini model + GenAI SDK)                                                                                                                                                                                            |
