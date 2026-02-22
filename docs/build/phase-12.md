# Ghost Browser — Build Plan: Phase 12

> **Active Phase:** Phase 12 — Demo, Submission & Polish
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
| **Phase 10** | Performance Tuning & Observability     | Meets all spec performance targets. Enables CDP Performance domain metrics, benchmarks TTFB/load/memory targets, profiles AX tree normalization, and implements Gemini API rate limit queuing with exponential backoff.                                          |
| **Phase 11** | Security Hardening                     | Hardens the JS API allowlist (AST-level scanning), enforces BrowserContext lifecycle destruction, builds the cookie passthrough consent UX, and stress-tests Ghost Tab crash isolation.                                                                          |

---

## Phase 12: Demo, Submission & Polish

**Goal:** Everything needed for hackathon submission is ready.

### 12.1 Demo Video (< 4 min)

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Record a < 4 minute demonstration video                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Actions**      | Script the demo to show: (1) Natural language command bar input, (2) Ghost Tab spawning and real-time status updates, (3) Multi-step agentic task (e.g., price comparison across sites), (4) Tiered perception in action (AX tree → screenshot escalation), (5) Maker Engine generating an interactive applet, (6) Parallel Ghost Tabs, (7) Task cancellation. Include a pitch section: what problem Ghost Browser solves and what value it brings. Keep under 4 minutes. No mockups — all features working in real-time. |
| **Acceptance**   | Video is under 4 minutes. All multimodal/agentic features are demonstrated live. Problem and value proposition are clearly communicated.                                                                                                                                                                                                                                                                                                                                                                                  |
| **Req Coverage** | Hackathon submission req (Demonstration Video)                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### 12.2 Architecture Diagram

| Item             | Detail                                                                                                                                                                                                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Create a clear architecture diagram                                                                                                                                                                                                                                                                                   |
| **Actions**      | Diagram showing: three-layer architecture (Shell → CDP Orchestration → AI Engines), Ghost Tab pool, Cloud Run backend, Gemini API connection, data flow (perception → inference → action), storage layer, foreground UX components. Use a tool like Excalidraw, draw.io, or Mermaid. Export as high-resolution image. |
| **Acceptance**   | Diagram clearly shows system architecture. All major components and data flows are labeled. Suitable for inclusion in submission writeup and README.                                                                                                                                                                  |
| **Req Coverage** | Hackathon submission req (Architecture Diagram)                                                                                                                                                                                                                                                                       |

### 12.3 README with Spin-Up Instructions

| Item             | Detail                                                                                                                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Write a complete README covering setup, run, and architecture                                                                                                                                                                                                   |
| **Actions**      | README sections: Project overview + problem statement. Prerequisites (Node.js version, Electron, Google Cloud account). Setup steps: clone, `npm install`, env vars (Gemini API key, Cloud Run URL). Run: `npm start`. Architecture overview (link to diagram). |
| **Acceptance**   | A developer with no prior context can clone the repo, follow the README, and run Ghost Browser locally in under 15 minutes. Cloud deployment instructions are accurate.                                                                                         |
| **Req Coverage** | Hackathon submission req (README)                                                                                                                                                                                                                               |

### 12.4 Proof of Google Cloud Deployment

| Item             | Detail                                                                                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Document live GCP deployment                                                                                                                                                                              |
| **Actions**      | Deploy Cloud Run service to production. Capture: Cloud Run service URL (live endpoint), Cloud Logging screenshot showing task log entries, Cloud Console screenshot showing the deployed service details. |
| **Acceptance**   | Submission includes live Cloud Run URL. Cloud Logging screenshots show real task log entries. Service is accessible and processing requests during demo.                                                  |
| **Req Coverage** | Hackathon req (Google Cloud deployment proof)                                                                                                                                                             |

### 12.5 Text Description / Write-Up

| Item             | Detail                                                                                                                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Write the hackathon project description                                                                                                                                                                                                                           |
| **Actions**      | Write 500-1000 word description covering: problem statement (why current browsers aren't built for AI agents), Ghost Browser's approach (tiered perception, Ghost Tab pool, Maker Engine), how Gemini models are used (Flash/Pro routing, multimodal perception). |
| **Acceptance**   | Description is within word limits, covers all required points, and clearly differentiates Ghost Browser from general-purpose browser automation tools.                                                                                                            |
| **Req Coverage** | Hackathon submission req (Text Description)                                                                                                                                                                                                                       |

### 12.6 Bonus: Blog Post / Content

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Publish a blog post about building Ghost Browser                                                                                                                                                                                                                                                                                                                                      |
| **Actions**      | Write a blog post covering: the problem (browsers aren't built for AI agents), the solution (Ghost Browser's tiered perception architecture), how Gemini models were used (Flash for speed, Pro for accuracy), lessons learned. Include required language: "created for the purposes of entering this hackathon." Use hashtag #GeminiLiveAgentChallenge when sharing on social media. |
| **Acceptance**   | Blog post is published publicly. Contains required hackathon language. Shared with correct hashtag.                                                                                                                                                                                                                                                                                   |
| **Req Coverage** | Hackathon bonus (content publication)                                                                                                                                                                                                                                                                                                                                                 |

### 12.7 Bonus: GDG Profile

| Item             | Detail                                               |
| ---------------- | ---------------------------------------------------- |
| **Task**         | Sign up for Google Developer Group                   |
| **Actions**      | Create GDG profile. Include link in submission.      |
| **Acceptance**   | Public GDG profile link is available for submission. |
| **Req Coverage** | Hackathon bonus (GDG profile)                        |
