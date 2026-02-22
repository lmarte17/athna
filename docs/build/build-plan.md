# Ghost Browser — Detailed Build Plan

> **Intent-First Agentic Browser · Engineering Execution Plan**
>
> Covers all requirements from the Ghost Browser Technical Specification v1.0.
> Organized in incremental phases — each phase produces a testable, demoable milestone.

---

## Table of Contents

- [Phase 0: Project Scaffolding & Dev Environment](#phase-0-project-scaffolding--dev-environment)
  - [0.1 Repository & Toolchain Setup](#01-repository--toolchain-setup)
  - [0.2 Electron Shell Bootstrap](#02-electron-shell-bootstrap)
  - [0.3 Gemini SDK Integration Spike](#03-gemini-sdk-integration-spike)
- [Phase 1: Core Perception–Action Loop](#phase-1-core-perceptionaction-loop)
  - [1.1 CDP Client Setup](#11-cdp-client-setup)
  - [1.2 Headless Rendering Configuration](#12-headless-rendering-configuration)
  - [1.3 Screenshot Capture Pipeline](#13-screenshot-capture-pipeline)
  - [1.4 Accessibility Tree Extraction & Normalization](#14-accessibility-tree-extraction--normalization)
  - [1.5 Interactive Element Index](#15-interactive-element-index)
  - [1.6 Navigator Engine — Single-Model (Flash)](#16-navigator-engine--single-model-flash)
  - [1.7 CDP Action Execution](#17-cdp-action-execution)
  - [1.8 Loop Integration & Manual Testing](#18-loop-integration--manual-testing)
- [Phase 2: Perception Reliability & Model Routing](#phase-2-perception-reliability--model-routing)
  - [2.1 Tiered Perception Protocol](#21-tiered-perception-protocol)
  - [2.2 Confidence Threshold & Escalation](#22-confidence-threshold--escalation)
  - [2.3 AX-Deficient Page Detection](#23-ax-deficient-page-detection)
  - [2.4 Scroll Control & Above-the-Fold Heuristic](#24-scroll-control--above-the-fold-heuristic)
  - [2.5 AX Tree Staleness Detection](#25-ax-tree-staleness-detection)
  - [2.6 DOM Extraction via JS (Vision Bypass)](#26-dom-extraction-via-js-vision-bypass)
- [Phase 3: Ghost Tab Pool & Parallelism](#phase-3-ghost-tab-pool--parallelism)
  - [3.1 BrowserContext Isolation](#31-browsercontext-isolation)
  - [3.2 Ghost Tab Pool Manager](#32-ghost-tab-pool-manager)
  - [3.3 Ghost Tab State Machine](#33-ghost-tab-state-machine)
  - [3.4 IPC Message Schema](#34-ipc-message-schema)
  - [3.5 Parallel Task Scheduling & Queue](#35-parallel-task-scheduling--queue)
  - [3.6 Resource Budgets per Ghost Tab](#36-resource-budgets-per-ghost-tab)
  - [3.7 Crash Recovery](#37-crash-recovery)
- [Phase 4: Navigator Engine — Advanced](#phase-4-navigator-engine--advanced)
  - [4.1 Context Window Management](#41-context-window-management)
  - [4.2 Task Decomposition & Checkpointing](#42-task-decomposition--checkpointing)
  - [4.3 Error Handling — Structured Error Objects](#43-error-handling--structured-error-objects)
  - [4.4 Observation Cache](#44-observation-cache)
- [Phase 5: Networking Optimizations](#phase-5-networking-optimizations)
  - [5.1 Request Interception & Asset Filtering](#51-request-interception--asset-filtering)
  - [5.2 Connection Pool Isolation](#52-connection-pool-isolation)
  - [5.3 Predictive Prefetch](#53-predictive-prefetch)
  - [5.4 Network Error Handling (Structured)](#54-network-error-handling-structured)
  - [5.5 HTTP Cache Partitioning](#55-http-cache-partitioning)
- [Phase 6: Command Bar & UX Layer](#phase-6-command-bar--ux-layer)
  - [6.1 Command Bar — Natural Language Input](#61-command-bar--natural-language-input)
  - [6.2 Intent Classification](#62-intent-classification)
  - [6.3 Task Status Feed](#63-task-status-feed)
  - [6.4 Result Surface & Confidence Indicator](#64-result-surface--confidence-indicator)
  - [6.5 Ghost Tab Visibility (Read-Only)](#65-ghost-tab-visibility-read-only)
  - [6.6 Task Cancellation](#66-task-cancellation)
- [Phase 7: Maker Engine & Applets](#phase-7-maker-engine--applets)
  - [7.1 Applet Brief Schema](#71-applet-brief-schema)
  - [7.2 Maker Engine — Applet Generation](#72-maker-engine--applet-generation)
  - [7.3 Applet Output Validation (3-Layer)](#73-applet-output-validation-3-layer)
  - [7.4 Applet Sandbox — iframe Isolation & CSP](#74-applet-sandbox--iframe-isolation--csp)
  - [7.5 Applet Lifecycle Management](#75-applet-lifecycle-management)
  - [7.6 Visualization Types](#76-visualization-types)
  - [7.7 Data Injection & Sanitization](#77-data-injection--sanitization)
- [Phase 8: Storage Layer](#phase-8-storage-layer)
  - [8.1 Session Storage Isolation](#81-session-storage-isolation)
  - [8.2 Task Result Store (SQLite)](#82-task-result-store-sqlite)
  - [8.3 Applet Output Persistence](#83-applet-output-persistence)
  - [8.4 Cookie / Auth Passthrough](#84-cookie--auth-passthrough)
  - [8.5 Storage Encryption (SQLCipher)](#85-storage-encryption-sqlcipher)
- [Phase 9: Cloud Deployment & Infrastructure](#phase-9-cloud-deployment--infrastructure)
  - [9.1 Cloud Run Backend — Gemini API Proxy](#91-cloud-run-backend--gemini-api-proxy)
  - [9.2 Authentication (Google Identity Platform)](#92-authentication-google-identity-platform)
  - [9.3 Task Logging (Cloud Logging)](#93-task-logging-cloud-logging)
  - [9.4 Scaling Configuration](#94-scaling-configuration)
  - [9.5 Infrastructure-as-Code (Terraform)](#95-infrastructure-as-code-terraform)
- [Phase 10: Performance Tuning & Observability](#phase-10-performance-tuning--observability)
  - [10.1 Render Timing Observability](#101-render-timing-observability)
  - [10.2 Performance Target Validation](#102-performance-target-validation)
  - [10.3 AX Tree Normalization Performance](#103-ax-tree-normalization-performance)
  - [10.4 Rate Limit Handling (Gemini API)](#104-rate-limit-handling-gemini-api)
- [Phase 11: Security Hardening](#phase-11-security-hardening)
  - [11.1 Applet JS API Allowlist Enforcement](#111-applet-js-api-allowlist-enforcement)
  - [11.2 BrowserContext Lifecycle Enforcement](#112-browsercontext-lifecycle-enforcement)
  - [11.3 Cookie Passthrough Consent UX](#113-cookie-passthrough-consent-ux)
  - [11.4 Error Isolation (Renderer Crashes)](#114-error-isolation-renderer-crashes)
- [Phase 12: Demo, Submission & Polish](#phase-12-demo-submission--polish)
  - [12.1 Demo Video (< 4 min)](#121-demo-video--4-min)
  - [12.2 Architecture Diagram](#122-architecture-diagram)
  - [12.3 README with Spin-Up Instructions](#123-readme-with-spin-up-instructions)
  - [12.4 Proof of Google Cloud Deployment](#124-proof-of-google-cloud-deployment)
  - [12.5 Text Description / Write-Up](#125-text-description--write-up)
  - [12.6 Bonus: Blog Post / Content](#126-bonus-blog-post--content)
  - [12.7 Bonus: GDG Profile](#127-bonus-gdg-profile)
- [Appendix A: Requirements Traceability Matrix](#appendix-a-requirements-traceability-matrix)
- [Appendix B: Open Questions & Decisions](#appendix-b-open-questions--decisions)

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

---

## Phase 1: Core Perception–Action Loop

**Goal:** A single Ghost Tab can load a page, perceive it (AX tree), send perception to Gemini, receive an action, execute it via CDP, and loop. This is the foundational agent loop.

### 1.1 CDP Client Setup

| Item             | Detail                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Connect `playwright-core` (or `puppeteer-core`) to the headless Electron BrowserWindow via CDP                                                                                                                                                                                                                                         |
| **Actions**      | Install `playwright-core` (no browser download). Launch a headless BrowserWindow from Electron's main process. Obtain the CDP WebSocket endpoint. Connect playwright-core to it. Verify `Page.navigate` works — navigate to a known URL (e.g., `https://www.google.com`). Verify `Page.captureScreenshot` returns a valid JPEG buffer. |
| **Acceptance**   | Navigating to a URL completes with `loadEventFired`. Screenshot saved to disk matches the expected page.                                                                                                                                                                                                                               |
| **Req Coverage** | Spec §06 (`Page.navigate`, `Page.captureScreenshot`), Spec §02 (Headless Rendering — partial)                                                                                                                                                                                                                                          |

### 1.2 Headless Rendering Configuration

| Item             | Detail                                                                                                                                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Configure Ghost Tab headless rendering per spec: disable GPU compositing, set viewport, configure screenshot params                                                                                                                                                                                                             |
| **Actions**      | Set headless BrowserWindow flags: `--headless=new`, `--disable-gpu`, offscreen rendering enabled. Set default viewport to **1280×900** at device scale factor 1.0. Configure `Page.captureScreenshot` defaults: format JPEG, quality 80, `fromSurface: true`. Verify viewport-only screenshot output dimensions match 1280×900. |
| **Acceptance**   | Ghost Tab runs without GPU process. Screenshots are 1280×900 JPEG at ~80 quality. Memory per Ghost Tab is measurably lower than a full-render window.                                                                                                                                                                           |
| **Req Coverage** | Spec §02 (Headless Rendering Mode, Viewport Configuration, Screenshot Capture)                                                                                                                                                                                                                                                  |

### 1.3 Screenshot Capture Pipeline

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Build the screenshot utility with configurable clip region, quality, and full-page support                                                                                                                                                                                                                                                                                                     |
| **Actions**      | Implement `captureScreenshot(options)` function wrapping CDP `Page.captureScreenshot`. Support modes: `viewport` (default) and `full-page` (scroll-and-stitch). Full-page mode scrolls in 800px steps with 11% overlap, captures each viewport, and stitches vertically. Cap full-page at 8 scroll steps (abort + flag if exceeded). Return screenshot as base64 string ready for model input. |
| **Acceptance**   | Viewport screenshot returns a single 1280×900 image. Full-page screenshot on a long page returns a stitched image spanning multiple viewport heights. Infinite-scroll pages abort after 8 steps with an appropriate flag.                                                                                                                                                                      |
| **Req Coverage** | Spec §02 (Screenshot Capture, Full-page scroll step, Max scroll steps, Above-the-Fold Heuristic — partial)                                                                                                                                                                                                                                                                                     |

### 1.4 Accessibility Tree Extraction & Normalization

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Extract and normalize the AX tree from any loaded page                                                                                                                                                                                                                                                                                                                                                                          |
| **Actions**      | Call CDP `Accessibility.getFullAXTree` after `loadEventFired + DOMContentLoaded`. Implement normalization that prunes the raw tree: retain only `nodeId`, `role`, `name`, `value`, `description`, `states[]`, `boundingBox`. Remove irrelevant roles: `generic`, `none`, `presentation`, `InlineTextBox`, etc. Target: raw tree of 50K+ chars → normalized JSON < 8,000 characters. Measure normalization time; flag if > 15ms. |
| **Acceptance**   | Normalized AX tree for amazon.com product page fits within ~8K chars. All interactive elements (buttons, links, inputs) are preserved with bounding boxes. Pruned roles do not appear in output.                                                                                                                                                                                                                                |
| **Req Coverage** | Spec §04 (AX Tree Extraction, AX Tree Normalization)                                                                                                                                                                                                                                                                                                                                                                            |

### 1.5 Interactive Element Index

| Item             | Detail                                                                                                                                                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Task**         | Build a filtered index of only interactive elements from the normalized AX tree                                                                                                                                                                                                                              |
| **Actions**      | From the normalized tree, extract elements with roles: `button`, `link`, `textbox`, `combobox`, `checkbox`, `radio`, `menuitem`, `tab`, `searchbox`, `spinbutton`, `slider`, `switch`. Store as flat array: `{nodeId, role, name, value, boundingBox}`. This is the "fast-pass" input for Tier 1 perception. |
| **Acceptance**   | Interactive element index for a typical e-commerce page contains 20-80 elements. Index is a fraction of the full normalized tree size.                                                                                                                                                                       |
| **Req Coverage** | Spec §04 (Interactive Element Index)                                                                                                                                                                                                                                                                         |

### 1.6 Navigator Engine — Single-Model (Flash)

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Implement the first version of the Navigator Engine using Gemini Flash only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Actions**      | Design the system prompt for the Navigator Engine. It receives: (1) the user's intent, (2) the normalized AX tree or interactive element index, and (3) optional previous actions/observations. It must return a response conforming to the **typed action schema**: <code>{action: CLICK &#124; TYPE &#124; SCROLL &#124; WAIT &#124; EXTRACT &#124; DONE &#124; FAILED, target: {x, y} &#124; null, text: string &#124; null, confidence: 0.0-1.0, reasoning: string}</code>. Use Gemini Flash for all calls in this phase. Parse the structured JSON response and validate against the schema. Handle malformed responses with a retry (max 1 retry). |
| **Acceptance**   | Given an AX tree from Google's homepage and intent "search for mechanical keyboards", the engine returns `{action: CLICK, target: {x, y}, confidence: 0.9+}` pointing to the search box. Subsequent calls with updated AX trees produce TYPE and CLICK actions to complete the search flow.                                                                                                                                                                                                                                                                                                                                                              |
| **Req Coverage** | Spec §08.1 (Navigator Engine — Action Schema, Model Routing — Flash only for now)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### 1.7 CDP Action Execution

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Task**         | Translate Navigator Engine action outputs into CDP commands                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Actions**      | Implement action executor that maps the action schema to CDP calls: `CLICK` → `Input.dispatchMouseEvent` (mousemove to target, then mousedown + mouseup at `{x, y}`). `TYPE` → `Input.dispatchKeyEvent` (type: char for each character in `text`, plus special keys Enter/Tab/Escape via keyDown/keyUp). `SCROLL` → `Input.dispatchMouseEvent` (scroll) or `Runtime.evaluate(window.scrollBy(...))`. `WAIT` → setTimeout/delay. `EXTRACT` → `Runtime.evaluate` to extract target data. `DONE` → signal task completion. `FAILED` → signal task failure. All actions must wait for any resulting navigation or DOM update before returning. |
| **Acceptance**   | CLICK on a search box focuses the element. TYPE fills in text. SCROLL moves the viewport. EXTRACT returns structured data from the page. Full loop: navigate → perceive → act → repeat until DONE.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Req Coverage** | Spec §06 (`Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, `Runtime.evaluate`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### 1.8 Loop Integration & Manual Testing

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Wire the full perception-action loop together and test end-to-end                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Actions**      | Build the loop orchestrator: (1) navigate to starting URL, (2) wait for load, (3) extract AX tree, (4) send to Navigator Engine, (5) execute returned action, (6) detect page state change, (7) repeat from step 3 until DONE/FAILED or max steps reached. Set max steps per task to 20 (safety limit). Add console logging at each step: intent, action taken, confidence, current URL. Test against 3 representative sites: Google Search, Amazon product search, Wikipedia navigation. |
| **Acceptance**   | "Search for mechanical keyboards on Amazon" completes: navigates to amazon.com, types in search box, submits, arrives at search results page. All steps logged. Loop terminates cleanly on DONE.                                                                                                                                                                                                                                                                                          |
| **Req Coverage** | Spec §05 (Ghost Tab State Machine — LOADING → PERCEIVING → INFERRING → ACTING → COMPLETE), §08.1 (Navigator Engine end-to-end)                                                                                                                                                                                                                                                                                                                                                            |

---

## Phase 2: Perception Reliability & Model Routing

**Goal:** The agent handles ambiguous pages, AX-deficient pages, and scrolling correctly. Vision (screenshots) is used as a fallback. Model routing between Flash and Pro is implemented.

### 2.1 Tiered Perception Protocol

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Implement the three-tier perception decision tree                                                                                                                                                                                                                                                                                                                                                                               |
| **Actions**      | **Tier 1:** AX tree + interactive element index → Gemini Flash. Cost target: ~$0.00015/call (~4K tokens). **Tier 2:** AX tree + viewport screenshot → Gemini Pro. Cost target: ~$0.003/call. **Tier 3:** Scroll 800px → re-run from Tier 1. Implement the orchestration logic that tries Tier 1 first, escalates on low confidence or AX deficiency, and scrolls as a last resort. Track tier usage per task for cost analysis. |
| **Acceptance**   | Well-labeled page (e.g., Google) resolves at Tier 1. Ambiguous page (confidence < 0.75) escalates to Tier 2. Canvas-heavy page skips directly to Tier 2. All tiers produce valid actions or escalate correctly.                                                                                                                                                                                                                 |
| **Req Coverage** | Spec §04 (Tiered Perception Protocol, Tiered Perception Decision Matrix)                                                                                                                                                                                                                                                                                                                                                        |

### 2.2 Confidence Threshold & Escalation

| Item             | Detail                                                                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Enforce the 0.75 confidence threshold for Tier 1 → Tier 2 escalation                                                                                                                                                                                                      |
| **Actions**      | Navigator Engine already returns `confidence` in its action schema. Orchestration layer checks: if `confidence < 0.75`, capture viewport screenshot and re-invoke with Gemini Pro (Tier 2). Log every escalation with page URL, confidence score, and tier that resolved. |
| **Acceptance**   | Pages with clear ARIA labels and familiar layouts resolve at Tier 1 (confidence ≥ 0.75). Pages with generic labels or unusual layouts trigger Tier 2 escalation. No actions are executed with confidence below threshold without escalation.                              |
| **Req Coverage** | Spec §04 (Confidence Threshold), §08.1 (Model Routing)                                                                                                                                                                                                                    |

### 2.3 AX-Deficient Page Detection

| Item             | Detail                                                                                                                                                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Detect pages where the AX tree is insufficient and skip directly to Tier 2                                                                                                                                                                                                        |
| **Actions**      | After AX tree normalization, count interactive elements. If count < 5 AND the page has significant visual content (determined by page load status being complete), flag as AX-deficient. Route directly to Tier 2, bypassing the Flash call. Log AX-deficient pages for analysis. |
| **Acceptance**   | Canvas-heavy apps (e.g., Figma landing page), custom web component frameworks, and flash-based legacy sites are detected as AX-deficient. Standard HTML pages with proper ARIA are not falsely flagged.                                                                           |
| **Req Coverage** | Spec §04 (Canvas & Custom Component Fallback)                                                                                                                                                                                                                                     |

### 2.4 Scroll Control & Above-the-Fold Heuristic

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Implement scroll-based exploration with the above-the-fold optimization                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Actions**      | Before a full-page screenshot, capture only the viewport. Pass to model. If model returns SCROLL action, execute scroll of 800px (11% overlap with previous viewport). Re-capture and re-infer. Track scroll steps; abort after 8 steps with FAILED status and page URL for manual review. Implement scroll position query: `Runtime.evaluate('window.scrollY')`. Use scroll position + viewport height to determine if target might be below fold before issuing another screenshot. |
| **Acceptance**   | Target element within first viewport is found without scrolling. Target below fold triggers scroll + re-perception. Infinite-scroll pages abort after 8 steps.                                                                                                                                                                                                                                                                                                                        |
| **Req Coverage** | Spec §02 (Scroll Control, Above-the-Fold Heuristic, Partial Render Trigger), §04 (Tiered Perception — scroll tier)                                                                                                                                                                                                                                                                                                                                                                    |

### 2.5 AX Tree Staleness Detection

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Task**         | Detect DOM mutations after agent actions and re-fetch the AX tree when needed                                                                                                                                                                                                                                                                                                                                            |
| **Actions**      | After each action (especially CLICK), inject a `MutationObserver` via `Runtime.evaluate` that watches for structural DOM changes (childList mutations, attribute changes on interactive elements). If significant mutations detected within 2 seconds post-action, re-extract the AX tree before next perception cycle. Define "significant" as: ≥ 3 added/removed nodes, or any change to nodes with interactive roles. |
| **Acceptance**   | Clicking a dropdown triggers AX tree re-fetch (new options appear). Clicking a static link does not trigger unnecessary re-fetch. Dynamic content loading (AJAX) is caught and triggers re-perception.                                                                                                                                                                                                                   |
| **Req Coverage** | Spec §04 (AX Tree Staleness Detection)                                                                                                                                                                                                                                                                                                                                                                                   |

### 2.6 DOM Extraction via JS (Vision Bypass)

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Task**         | Use lightweight JS injection to extract element data, potentially bypassing the vision model entirely                                                                                                                                                                                                                                                                                                                          |
| **Actions**      | Before issuing a screenshot (Tier 2), run a DOM extraction script via `Runtime.evaluate` that returns: `{elements: [{tag, text, boundingBox, isVisible, isInteractive}]}` for all visible interactive elements. If the target element can be identified unambiguously by text content + bounding box from this extraction, skip the vision model call entirely. This is a cost optimization sitting between Tier 1 and Tier 2. |
| **Acceptance**   | On a page where AX tree is ambiguous but DOM text is clear, the DOM extraction script resolves the target without a Gemini Pro call. Cost savings are logged.                                                                                                                                                                                                                                                                  |
| **Req Coverage** | Spec §03 (DOM Extraction via JS), §04 (optimization layer)                                                                                                                                                                                                                                                                                                                                                                     |

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

---

## Phase 4: Navigator Engine — Advanced

**Goal:** The Navigator Engine handles complex multi-step tasks, manages context windows, and uses observation caching.

### 4.1 Context Window Management

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Maintain a rolling context window of recent actions and observations                                                                                                                                                                                                                                                                                                                           |
| **Actions**      | Keep the last 5 action+observation pairs in the context sent to the model. Older history is summarized: compress into a 2-3 sentence summary of what was accomplished and what the current state is. Implement summarization as a lightweight Gemini Flash call (or template-based if deterministic enough). Monitor total token count sent per call; alert if exceeding model context limits. |
| **Acceptance**   | A 15-step task doesn't overflow the model context. Summarized history preserves goal-relevant information. Token cost per call remains bounded.                                                                                                                                                                                                                                                |
| **Req Coverage** | Spec §08.1 (Context Window Management)                                                                                                                                                                                                                                                                                                                                                         |

### 4.2 Task Decomposition & Checkpointing

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | For complex intents, decompose into ordered subtasks with checkpoint-aware recovery (v1 sequential scope)                                                                                                                                                                                                                                                                                      |
| **Actions**      | If an intent implies > 2 steps, run a decomposition pass that returns an ordered subtask list. Each subtask includes: `id`, `intent`, optional `startUrl`, `verification` (`type` + `condition`), and runtime `status` (`PENDING`, `IN_PROGRESS`, `COMPLETE`, `FAILED`). Persist a task-local checkpoint object after each completed subtask: `{lastCompletedSubtaskIndex, subtaskArtifacts, currentSubtaskAttempt}`. On failure, retry only the current failed subtask from checkpoint; do not restart completed subtasks. Publish subtask progress to task status feed by extending the typed status channel with a `SUBTASK` payload (subtask id/status and `currentSubtaskIndex` of `totalSubtasks`). v1 excludes parallel DAG execution, multi-plan fallbacks, and human-handoff workflow orchestration. |
| **Acceptance**   | "Find the cheapest flight from NYC to London next Friday on Google Flights" decomposes into ~5 sequential subtasks. Failure at subtask 4 retries subtask 4 from checkpoint while subtasks 1-3 remain `COMPLETE` and are not re-run. Subtask list and status transitions are visible in task status feed. Result artifacts include subtask timeline and checkpoint metadata.                                |
| **Req Coverage** | Spec §08.1 (Task Decomposition)                                                                                                                                                                                                                                                                                                                                                                |

### 4.3 Error Handling — Structured Error Objects

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Surface all errors to the Navigator Engine as structured objects, not raw HTML                                                                                                                                                                                                                                                                                                                                                   |
| **Actions**      | Network errors, JS runtime errors, CDP errors, and timeout errors are all caught by the orchestration layer. Convert to: <code>{type: NETWORK &#124; RUNTIME &#124; CDP &#124; TIMEOUT, status: number &#124; null, url: string, message: string, retryable: boolean}</code>. Navigator Engine receives these in observation payload (`structuredError`) instead of error page screenshots. Retryable errors use a non-terminal fallback policy if the model returns immediate failure. |
| **Acceptance**   | A 404 page produces a structured error (not a screenshot of the 404 page). A JS runtime error in a Ghost Tab is caught and structured. Retryable failures (for example HTTP 503) produce a non-`FAILED` recovery decision from the structured-error decision path.                                                                                                                                                           |
| **Req Coverage** | Spec §01 (Error Handling), §03 (Error Isolation), §08.1 (error handling behavior)                                                                                                                                                                                                                                                                                                                                                |

### 4.4 Observation Cache

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Cache perception results within a task session to avoid redundant rendering and inference                                                                                                                                                                                                                                                                                                                               |
| **Actions**      | Maintain an in-memory cache: `{url → {axtree_hash, screenshot_b64, interactive_elements, timestamp, ttl}}`. Default TTL: 60 seconds. Cache is per-task-session — discarded when task completes. Before running perception, check cache: if URL matches and TTL is valid and page hasn't navigated, reuse cached perception data. Especially valuable for form flows and multi-step checkouts that revisit the same URL. |
| **Acceptance**   | Revisiting the same URL within 60s during a form flow reuses cached AX tree (no re-extraction or re-inference). Cache is empty after task completion.                                                                                                                                                                                                                                                                   |
| **Req Coverage** | Spec §07 (Observation Cache)                                                                                                                                                                                                                                                                                                                                                                                            |

---

## Phase 5: Networking Optimizations

**Goal:** Ghost Tabs load faster by blocking unnecessary assets, pre-warming connections, and handling network errors intelligently.

### 5.1 Request Interception & Asset Filtering

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Block images, fonts, and media in Ghost Tabs by default                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Actions**      | Use CDP `Network.setRequestInterception` (or Fetch.enable) to intercept all outbound requests in Ghost Tabs. Block resource types: `Image`, `Font`, `Media`, `Stylesheet` (optional — may be needed for layout). Allow: `Document`, `Script`, `XHR`, `Fetch`. Re-enable assets only when the Navigator Engine explicitly requests a visual render pass (Tier 2 screenshot). Classify requests at intercept time: decide if full HTML fetch or lightweight JSON/API response suffices. |
| **Acceptance**   | Ghost Tab page load time is reduced by ≥ 40% on media-heavy pages (measure against Amazon, news sites). Re-enabling assets for screenshot produces correct visual output.                                                                                                                                                                                                                                                                                                             |
| **Req Coverage** | Spec §01 (Request Interception, Asset Filtering), Performance target (≥ 40% load time reduction)                                                                                                                                                                                                                                                                                                                                                                                      |

### 5.2 Connection Pool Isolation

| Item             | Detail                                                                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Task**         | Ensure each Ghost Tab BrowserContext has an isolated connection pool                                                                                                                                                                                   |
| **Actions**      | Verify that Electron's `session.fromPartition` creates isolated network stacks. Confirm connections are not shared across Ghost Tabs. Test: two Ghost Tabs accessing the same site use separate TCP connections (no connection reuse across contexts). |
| **Acceptance**   | Network isolation confirmed via CDP Network domain inspection. No state leakage between Ghost Tab sessions.                                                                                                                                            |
| **Req Coverage** | Spec §01 (Connection Pool)                                                                                                                                                                                                                             |

### 5.3 Predictive Prefetch

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Task**         | Prefetch likely next URLs in parallel with model inference                                                                                                                                                                                                                                                                                                                                                         |
| **Actions**      | After each Navigator Engine call, if the model's action suggests a navigation (CLICK on a link), extract the target URL from the AX tree or DOM. Issue a prefetch (DNS resolve + TCP/TLS handshake + optional initial request) for that URL into the Ghost Tab's connection pool. Prefetch runs concurrently with model inference time for the next step. Expose a `prefetch(url)` API in the orchestration layer. |
| **Acceptance**   | Prefetching reduces TTFB by 150-300ms on predicted navigations. Prefetch does not trigger full page loads.                                                                                                                                                                                                                                                                                                         |
| **Req Coverage** | Spec §01 (Predictive Prefetch), Performance target (150-300ms TTFB reduction)                                                                                                                                                                                                                                                                                                                                      |

### 5.4 Network Error Handling (Structured)

| Item             | Detail                                                                                                                                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Catch all network errors at the orchestration layer and convert to structured objects                                                                                                                                                           |
| **Actions**      | Intercept DNS failures, connection timeouts, TLS errors, HTTP 4xx, and 5xx responses via CDP Network events. Convert to `{status, url, retryable, errorType}`. Route to Navigator Engine instead of letting the Ghost Tab render an error page. |
| **Acceptance**   | DNS failure returns `{status: null, url: ..., retryable: true, errorType: 'DNS_FAILURE'}`. HTTP 503 returns `{status: 503, url: ..., retryable: true}`. Navigator Engine never receives a screenshot of an error page for network errors.       |
| **Req Coverage** | Spec §01 (Error Handling — structured errors)                                                                                                                                                                                                   |

### 5.5 HTTP Cache Partitioning

| Item             | Detail                                                                                                                                                                                                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Configure per-BrowserContext cache partitions with overridable TTL                                                                                                                                                                                                                                                                        |
| **Actions**      | Each BrowserContext already gets its own cache via partition isolation. Implement application-level TTL override: allow the orchestration layer to set cache behavior per session (e.g., force refresh for time-sensitive data, long cache for static reference sites). Layer the observation cache (Phase 4.4) on top of the HTTP cache. |
| **Acceptance**   | Repeat visits to the same URL within a session use cached resources. Cache override forces fresh fetch when needed.                                                                                                                                                                                                                       |
| **Req Coverage** | Spec §01 (HTTP Cache), §07 (observation cache integration)                                                                                                                                                                                                                                                                                |

---

## Phase 6: Command Bar & UX Layer

**Goal:** The foreground Electron window has a polished command bar, real-time task status, and result display.

### 6.1 Command Bar — Natural Language Input

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Build the command bar UI replacing the traditional address bar                                                                                                                                                                                                                                                                                                                         |
| **Actions**      | Implement a text input field at the top of the Electron foreground window. Accept free-text natural language input (no special syntax required). Support standard URL input as well (detect URLs and navigate directly). Add keyboard shortcut to focus the command bar (Cmd/Ctrl+L). Auto-clear on task submission. Display placeholder text indicating natural language is accepted. |
| **Acceptance**   | User can type "find me the best rated coffee maker under $50 on Amazon" and submit. User can also type "amazon.com" and navigate directly. Command bar is always accessible.                                                                                                                                                                                                           |
| **Req Coverage** | Spec §09 (Natural Language Input)                                                                                                                                                                                                                                                                                                                                                      |

### 6.2 Intent Classification

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Classify user input into execution paths before dispatch                                                                                                                                                                                                                                                                                                                                                                                 |
| **Actions**      | Implement classifier (can be rule-based initially, upgraded to Gemini-powered later): **NAVIGATE** — single URL destination (just go there). **RESEARCH** — multi-site information gathering (spawn Ghost Tabs). **TRANSACT** — form fill / checkout workflow. **GENERATE** — Maker Engine request (create an applet). Classification determines: whether Ghost Tabs are spawned, which engine is primary, and how results are surfaced. |
| **Acceptance**   | "google.com" → NAVIGATE (direct navigation, no Ghost Tab). "Compare prices for AirPods Pro across Amazon and Best Buy" → RESEARCH (spawn Ghost Tabs). "Fill out this contact form" → TRANSACT. "Show me a comparison chart of these products" → GENERATE.                                                                                                                                                                                |
| **Req Coverage** | Spec §09 (Intent Classification)                                                                                                                                                                                                                                                                                                                                                                                                         |

### 6.3 Task Status Feed

| Item             | Detail                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Build a sidebar panel showing real-time Ghost Tab task status                                                                                                                                                                                                                                                                          |
| **Actions**      | Sidebar panel in the foreground window showing active tasks. Per task: current URL, current action description, elapsed time, progress indicator (subtask N of M), Ghost Tab state. Updates arrive via IPC at max 2Hz (cap to prevent UI jank). Sidebar is collapsible. Tasks are listed in order of creation with most recent at top. |
| **Acceptance**   | Active Ghost Tab task shows live status updates. Multiple concurrent tasks are all visible. Updates are smooth (no jank at 2Hz cap). Sidebar collapses cleanly.                                                                                                                                                                        |
| **Req Coverage** | Spec §09 (Task Status Feed)                                                                                                                                                                                                                                                                                                            |

### 6.4 Result Surface & Confidence Indicator

| Item             | Detail                                                                                                                                                                                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Display task results in structured result cards                                                                                                                                                                                                                                                                        |
| **Actions**      | When a task completes, display a result card in the foreground UI containing: source URLs visited, extracted data (formatted), confidence indicator (based on Navigator Engine's reported confidence), and an "Open Applet" button if a Maker Engine visualization is available. Result cards persist until dismissed. |
| **Acceptance**   | Completed research task shows result card with source URLs, extracted data, and confidence level. User can click source URLs to visit them. Applet button launches the generated visualization.                                                                                                                        |
| **Req Coverage** | Spec §09 (Result Surface)                                                                                                                                                                                                                                                                                              |

### 6.5 Ghost Tab Visibility (Read-Only)

| Item             | Detail                                                                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Allow users to peek at active Ghost Tab state                                                                                                                                                                                                                             |
| **Actions**      | Clicking a task in the status feed opens a read-only view of the Ghost Tab's current state (last captured screenshot or live view). Ghost Tab must NOT receive user input focus — read-only visibility only. Display as a picture-in-picture overlay or a separate panel. |
| **Acceptance**   | User can see what the agent is currently looking at in a Ghost Tab. User cannot accidentally interact with the Ghost Tab. View updates on each new screenshot capture.                                                                                                    |
| **Req Coverage** | Spec §09 (Ghost Tab Visibility)                                                                                                                                                                                                                                           |

### 6.6 Task Cancellation

| Item             | Detail                                                                                                                                                                                                                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Enable user-initiated task cancellation at any time                                                                                                                                                                                                                                                                  |
| **Actions**      | Each task in the status feed has a cancel button. Cancellation must: (1) abort any in-flight Gemini API call, (2) close the BrowserContext (destroying all storage), (3) return a partial result if any data was extracted before cancellation. Cancellation is immediate — no waiting for current step to complete. |
| **Acceptance**   | Cancelling a running task stops it within 1 second. Partial results are displayed if available. BrowserContext is fully cleaned up.                                                                                                                                                                                  |
| **Req Coverage** | Spec §09 (Task Cancellation), §05 (Context Lifecycle — destruction)                                                                                                                                                                                                                                                  |

---

## Phase 7: Maker Engine & Applets

**Goal:** The system can generate interactive single-use applets from aggregated task data and display them safely in the foreground.

### 7.1 Applet Brief Schema

| Item             | Detail                                                                                                                                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Define and implement the structured input format for the Maker Engine                                                                                                                                                                                                                   |
| **Actions**      | Input schema: `{intent: string, dataType: string, data: object[], visualizationHint: string, constraints: string[]}`. No raw HTML or screenshots as input (prevents prompt injection via web-scraped content). Data must be pre-sanitized (HTML-escaped) before inclusion in the brief. |
| **Acceptance**   | Maker Engine receives a clean structured brief. Raw HTML from scraped pages is never included. Schema validation rejects malformed briefs.                                                                                                                                              |
| **Req Coverage** | Spec §08.2 (Applet Brief Schema)                                                                                                                                                                                                                                                        |

### 7.2 Maker Engine — Applet Generation

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Implement the Maker Engine that generates HTML/JS/CSS applets from structured data                                                                                                                                                                                                                                                                                                                          |
| **Actions**      | System prompt instructs Gemini to generate a single self-contained HTML string with inline CSS and JS. Data is injected as `const DATA = {...}` at the top of the generated script (model does not embed data inline in markup). Model generates visualization code that reads from the DATA constant. Support retry: if output validation fails, append error context to prompt and retry (max 2 retries). |
| **Acceptance**   | Given a brief with price comparison data, the Maker Engine generates a working HTML applet with a sortable comparison table. Applet renders correctly when loaded in an iframe.                                                                                                                                                                                                                             |
| **Req Coverage** | Spec §08.2 (Maker Engine, Data Injection)                                                                                                                                                                                                                                                                                                                                                                   |

### 7.3 Applet Output Validation (3-Layer)

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Validate generated applet HTML before sandbox injection                                                                                                                                                                                                                                                                                                                                                                               |
| **Actions**      | Three validation layers: (1) **HTML parse validation** — generated string must parse as valid HTML. (2) **API allowlist check** — scan the JS for prohibited APIs: `fetch`, `XMLHttpRequest`, `WebSocket`, `localStorage`, `document.cookie`, `window.parent`. Reject if any found. (3) **Size check** — applet must be < 100KB. Any validation failure triggers a retry with the specific error appended to the Maker Engine prompt. |
| **Acceptance**   | Valid applet passes all three checks. Applet containing `fetch()` is rejected at layer 2. Applet exceeding 100KB is rejected at layer 3. Failed validations trigger retries with error context.                                                                                                                                                                                                                                       |
| **Req Coverage** | Spec §08.2 (Output Validation), §03 (Applet Generation Contract — prohibited APIs)                                                                                                                                                                                                                                                                                                                                                    |

### 7.4 Applet Sandbox — iframe Isolation & CSP

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Run applets in a sandboxed iframe with strict security policies                                                                                                                                                                                                                                                                                                                                                       |
| **Actions**      | Create iframe with sandbox attributes: `allow-scripts` only. Explicitly NO: `allow-same-origin`, `allow-forms`, `allow-popups`, `allow-top-navigation`. Inject Content Security Policy via meta tag or HTTP header: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'`. Exception: Chart.js CDN loading requires `script-src 'unsafe-inline' https://cdn.jsdelivr.net` (or bundle Chart.js). |
| **Acceptance**   | Applet JS runs inside the iframe. Applet cannot access parent window, cookies, localStorage, or make outbound requests. CSP blocks any external resource loading (except allowed CDN).                                                                                                                                                                                                                                |
| **Req Coverage** | Spec §03 (Applet Sandbox — Execution, CSP)                                                                                                                                                                                                                                                                                                                                                                            |

### 7.5 Applet Lifecycle Management

| Item             | Detail                                                                                                                                                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Task**         | Manage mounting, unmounting, and lifecycle of applets in the foreground                                                                                                                                                                                                                                            |
| **Actions**      | Maximum one active applet per browser window at a time. Mount: inject validated HTML into sandbox iframe in the foreground window. Unmount: remove iframe from DOM, discard all applet state. Applet state is never preserved across unmounts (single-use). Provide UI controls: close applet, full-screen applet. |
| **Acceptance**   | Applet mounts and renders correctly. Mounting a new applet unmounts the previous one. No cross-task data leakage between applets. Close button fully removes the applet.                                                                                                                                           |
| **Req Coverage** | Spec §03 (Applet Lifecycle)                                                                                                                                                                                                                                                                                        |

### 7.6 Visualization Types

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Ensure the Maker Engine supports the minimum required visualization types                                                                                                                                                                                                                                                                                                        |
| **Actions**      | Required types: (1) **Sortable comparison tables** — HTML table with column sort. (2) **Charts** — line, bar, pie via inline Chart.js (loaded from CDN or bundled). (3) **Filterable card grids** — card layout with text filter/search. Additional types generated freeform by the model based on the visualization hint in the brief. Test each type with representative data. |
| **Acceptance**   | Price comparison → sortable table. Historical price data → line chart. Product listings → filterable card grid. All types render correctly in the sandbox.                                                                                                                                                                                                                       |
| **Req Coverage** | Spec §08.2 (Visualization Types)                                                                                                                                                                                                                                                                                                                                                 |

### 7.7 Data Injection & Sanitization

| Item             | Detail                                                                                                                                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Ensure data is safely injected into applets                                                                                                                                                                                                                                                                                     |
| **Actions**      | All structured data from task results is HTML-escaped before injection into the `const DATA = {...}` declaration. Sanitization covers: `<`, `>`, `&`, `"`, `'`, backtick. Verify that sanitized data renders correctly in the applet (no double-escaping). Data injection is done by the orchestration layer, not by the model. |
| **Acceptance**   | Data containing HTML tags (e.g., product names with `<b>`) is escaped and renders as literal text, not markup. No XSS vectors in injected data.                                                                                                                                                                                 |
| **Req Coverage** | Spec §08.2 (Data Injection)                                                                                                                                                                                                                                                                                                     |

---

## Phase 8: Storage Layer

**Goal:** Persistent local storage for task results, applets, and secure cookie handling.

### 8.1 Session Storage Isolation

| Item             | Detail                                                                                                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Verify and enforce complete browser storage isolation per Ghost Tab                                                                                                                                                         |
| **Actions**      | Confirm that BrowserContext isolation (Phase 3.1) covers all browser storage types: cookies, localStorage, sessionStorage, IndexedDB, HTTP cache. Add integration tests that verify isolation across concurrent Ghost Tabs. |
| **Acceptance**   | Two Ghost Tabs on the same domain have completely independent storage. Context destruction clears all storage atomically.                                                                                                   |
| **Req Coverage** | Spec §07 (Session Storage Isolation)                                                                                                                                                                                        |

### 8.2 Task Result Store (SQLite)

| Item             | Detail                                                                                                                                                                                                                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Implement persistent storage for completed task results                                                                                                                                                                                                                                                                                      |
| **Actions**      | Install `better-sqlite3`. Create schema: `tasks(task_id TEXT PRIMARY KEY, timestamp INTEGER, intent TEXT, status TEXT, result_json TEXT, source_urls TEXT)`. Store results on task completion. Provide query API for the foreground UI to display past results. Provide query API for the Maker Engine to access multi-task aggregated data. |
| **Acceptance**   | Completed task results persist across app restarts. Past results are queryable by intent, status, and timestamp. Maker Engine can aggregate data from multiple completed tasks.                                                                                                                                                              |
| **Req Coverage** | Spec §07 (Task Result Store)                                                                                                                                                                                                                                                                                                                 |

### 8.3 Applet Output Persistence

| Item             | Detail                                                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Task**         | Persist generated applets for re-opening without re-generation                                                                                                                                               |
| **Actions**      | Store validated applet HTML strings in the task result store, associated with their source task_id. Maximum 50 stored applets (LRU eviction). Provide "re-open applet" functionality from past task results. |
| **Acceptance**   | User can re-open a previously generated applet without re-running the agent or calling the Maker Engine. Oldest applets are evicted when the 50-applet limit is reached.                                     |
| **Req Coverage** | Spec §07 (Applet Output Persistence)                                                                                                                                                                         |

### 8.4 Cookie / Auth Passthrough

| Item             | Detail                                                                                                                                                                                                                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Enable authenticated Ghost Tab tasks by cloning foreground cookies                                                                                                                                                                                                                                                                 |
| **Actions**      | Implement API to clone cookies from the foreground BrowserContext to a Ghost Tab BrowserContext for a specific domain only. Require explicit user permission per domain (permission dialog in the foreground UI). Only clone cookies for the requested domain — no cross-domain cookie leakage. Log all cookie passthrough events. |
| **Acceptance**   | User grants permission for amazon.com. Ghost Tab can access the user's authenticated Amazon session. Cookies for other domains are not cloned. Permission is required each time (not remembered — per the spec's security intent).                                                                                                 |
| **Req Coverage** | Spec §07 (Cookie / Auth Passthrough)                                                                                                                                                                                                                                                                                               |

### 8.5 Storage Encryption (SQLCipher)

| Item             | Detail                                                                                                                                                                                                                                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Encrypt the task result SQLite database at rest                                                                                                                                                                                                                                                                              |
| **Actions**      | Replace `better-sqlite3` with `@journeyapps/sqlcipher` (or equivalent SQLCipher binding). Derive encryption key from a user-specific local credential (e.g., Electron's `safeStorage` API for OS-level keychain integration). Encrypt the database on creation. Verify that the database file is unreadable without the key. |
| **Acceptance**   | Task result database is encrypted at rest. Opening the raw database file without the key fails. Normal read/write operations work transparently with the key.                                                                                                                                                                |
| **Req Coverage** | Spec §07 (Storage Encryption)                                                                                                                                                                                                                                                                                                |

---

## Phase 9: Cloud Deployment & Infrastructure

**Goal:** The Cloud Run backend is live, proxying Gemini API calls, logging task events, and deployed via IaC.

### 9.1 Cloud Run Backend — Gemini API Proxy

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Build and deploy a Cloud Run service that proxies all Gemini API calls                                                                                                                                                                                                                                                                                                |
| **Actions**      | Create a Node.js (or Python) service that: accepts inference requests from the local Electron app, forwards them to the Gemini API with server-side API key management, returns responses to the client. Handles rate limiting with exponential backoff. Request logging (see 9.3). Centralized API key management — key is never exposed in the Electron app binary. |
| **Acceptance**   | Local Electron app sends inference requests to Cloud Run endpoint. Cloud Run forwards to Gemini API and returns results. API key is only on the server side. Rate limiting works correctly under load.                                                                                                                                                                |
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
| **Actions**      | Cloud Run service logs to Cloud Logging. Each log entry includes: `task_id`, `user_id` (hashed), `timestamp`, `model_used` (Flash/Pro), `action_type`, `tier_used`, `confidence`, `status`. Structured log format for easy querying. Log retention per Cloud Logging defaults. |
| **Acceptance**   | Task events are visible in Cloud Logging console. Logs are queryable by task_id, model_used, tier_used. Tiered perception effectiveness is measurable from logs.                                                                                                               |
| **Req Coverage** | Spec §10 (Task Logging), Hackathon req (proof of GCP deployment)                                                                                                                                                                                                               |

### 9.4 Scaling Configuration

| Item             | Detail                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Configure Cloud Run auto-scaling                                                                                                                                    |
| **Actions**      | Set min-instances: 1 (prevents cold start). Max-instances: 10. Concurrency: 80 requests per instance. Configure appropriate CPU and memory allocation per instance. |
| **Acceptance**   | Service handles concurrent requests up to configured limits. Cold start is avoided with min-instances: 1. Scaling behavior observed under simulated load.           |
| **Req Coverage** | Spec §10 (Scaling)                                                                                                                                                  |

### 9.5 Infrastructure-as-Code (Terraform)

| Item             | Detail                                                                                                                                                                                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Define all cloud infrastructure in Terraform                                                                                                                                                                                                                                                               |
| **Actions**      | Create Terraform configuration in `terraform/` directory: Cloud Run service definition, IAM bindings, Cloud Logging configuration, Google Identity Platform setup (if applicable), container registry. Include `terraform plan` and `terraform apply` instructions in README. Commit to public repository. |
| **Acceptance**   | `terraform apply` provisions the full backend from scratch. Configuration is version-controlled. Teardown via `terraform destroy` works cleanly.                                                                                                                                                           |
| **Req Coverage** | Spec §10 (IaC), Hackathon bonus (automated cloud deployment)                                                                                                                                                                                                                                               |

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

---

## Phase 11: Security Hardening

**Goal:** All security requirements from the spec are enforced. Defense-in-depth for generated code and user data.

### 11.1 Applet JS API Allowlist Enforcement

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Task**         | Harden the JS API allowlist check for generated applets                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Actions**      | Implement a robust scanner (not just string search — use AST parsing if feasible, or at minimum regex with word boundaries) for prohibited APIs: `fetch`, `XMLHttpRequest`, `WebSocket`, `localStorage`, `sessionStorage`, `document.cookie`, `window.parent`, `window.top`, `window.opener`, `eval` (beyond what's already inline), `Function()` constructor. Combine with CSP enforcement (belt and suspenders). Test with adversarial applet code that tries to bypass detection. |
| **Acceptance**   | Applets using prohibited APIs are rejected before injection. Obfuscated attempts (e.g., `window['par'+'ent']`) are caught by CSP as a fallback. No unauthorized network requests or data access from applet code.                                                                                                                                                                                                                                                                    |
| **Req Coverage** | Spec §03 (Applet Generation Contract, Applet Sandbox — CSP), §08.2 (Output Validation)                                                                                                                                                                                                                                                                                                                                                                                               |

### 11.2 BrowserContext Lifecycle Enforcement

| Item             | Detail                                                                                                                                                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Ensure BrowserContexts are always destroyed on task completion or cancellation                                                                                                                                                                                                            |
| **Actions**      | Add lifecycle hooks: on COMPLETE, FAILED, or CANCEL → destroy BrowserContext. Add a cleanup sweep on app shutdown that destroys any lingering contexts. Verify no residual auth tokens, cookies, or form data persist after context destruction. Add integration tests for the lifecycle. |
| **Acceptance**   | No BrowserContexts leak beyond task lifetime. App shutdown cleans up all contexts. No residual data after destruction.                                                                                                                                                                    |
| **Req Coverage** | Spec §05 (Context Lifecycle)                                                                                                                                                                                                                                                              |

### 11.3 Cookie Passthrough Consent UX

| Item             | Detail                                                                                                                                                                                                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Build the user permission flow for cookie passthrough                                                                                                                                                                                                                                                                 |
| **Actions**      | When a task requires authenticated access to a domain, display a permission dialog: "Ghost Browser needs to use your [domain] session for this task. Allow?" Per-domain permission, granted per-task (not persisted). Clear visual indicator of which domains have active cookie passthrough. Log all consent grants. |
| **Acceptance**   | User sees a clear permission dialog before any cookies are cloned. Permission is per-domain and per-task. Denied permission prevents cookie cloning (task proceeds without auth).                                                                                                                                     |
| **Req Coverage** | Spec §07 (Cookie / Auth Passthrough — UX), Spec Appendix (Auth Cookie Passthrough UX open question)                                                                                                                                                                                                                   |

### 11.4 Error Isolation (Renderer Crashes)

| Item             | Detail                                                                                                                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Task**         | Verify that Ghost Tab crashes are fully isolated                                                                                                                                                                                                                                     |
| **Actions**      | Simulate renderer crashes (kill renderer process, trigger OOM, execute crashing JS). Verify: other Ghost Tabs are unaffected, foreground window is unaffected, orchestration layer receives crash event and handles recovery. No unhandled exceptions propagate to the main process. |
| **Acceptance**   | Crashing one Ghost Tab has zero impact on other tabs or the foreground. All crashes are caught and handled by the crash recovery system (Phase 3.7).                                                                                                                                 |
| **Req Coverage** | Spec §03 (Error Isolation), §05 (Crash Recovery)                                                                                                                                                                                                                                     |

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
| **Acceptance**   | Diagram clearly shows system architecture: how Gemini connects to the backend, the CDP orchestration layer, Ghost Tab pool, and the foreground UI. Judges can understand the system from the diagram alone.                                                                                                           |
| **Req Coverage** | Hackathon submission req (Architecture Diagram)                                                                                                                                                                                                                                                                       |

### 12.3 README with Spin-Up Instructions

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Write comprehensive README with reproducible setup instructions                                                                                                                                                                                                                                                                                                  |
| **Actions**      | README sections: Project overview, architecture summary, prerequisites (Node.js, Electron, GCP account, Gemini API key), installation steps, local development setup, cloud deployment steps (`terraform apply`), configuration (environment variables), usage guide. Must be reproducible — judges should be able to spin up the project from the README alone. |
| **Acceptance**   | A fresh developer can clone the repo, follow the README, and have a running Ghost Browser instance within 15 minutes.                                                                                                                                                                                                                                            |
| **Req Coverage** | Hackathon submission req (spin-up instructions in README)                                                                                                                                                                                                                                                                                                        |

### 12.4 Proof of Google Cloud Deployment

| Item             | Detail                                                                                                                                                                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Prepare proof of GCP deployment                                                                                                                                                                                                                                      |
| **Actions**      | Option A: Screen recording showing Cloud Run service running in GCP console (logs, deployment status, request metrics). Option B: Link to Terraform config + Cloud Run service code in the repo demonstrating GCP API usage. Prepare both — submit the stronger one. |
| **Acceptance**   | Clear evidence that the backend runs on Google Cloud. Judges can verify from the recording or code.                                                                                                                                                                  |
| **Req Coverage** | Hackathon submission req (Proof of Google Cloud Deployment)                                                                                                                                                                                                          |

### 12.5 Text Description / Write-Up

| Item             | Detail                                                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**         | Write the project summary                                                                                                                                                                                                                                           |
| **Actions**      | Cover: features and functionality, technologies used (Electron, Gemini Flash/Pro, CDP, Cloud Run, SQLite, Terraform), data sources, findings and learnings (tiered perception effectiveness, AX tree optimization insights, cost analysis of Flash vs Pro routing). |
| **Acceptance**   | Summary is clear, complete, and compelling. Technologies are listed. Learnings are specific and interesting.                                                                                                                                                        |
| **Req Coverage** | Hackathon submission req (Text Description)                                                                                                                                                                                                                         |

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

---

## Appendix A: Requirements Traceability Matrix

This matrix maps every requirement from the Ghost Browser Technical Specification v1.0 to the phase and step where it is addressed.

| Spec Section                 | Requirement                              | Build Phase              |
| ---------------------------- | ---------------------------------------- | ------------------------ |
| **§01 Networking**           | Connection Pool Isolation                | 5.2                      |
| §01                          | Request Interception                     | 5.1                      |
| §01                          | Asset Filtering                          | 5.1                      |
| §01                          | HTTP Cache                               | 5.5                      |
| §01                          | Predictive Prefetch                      | 5.3                      |
| §01                          | Error Handling (structured)              | 5.4, 4.3                 |
| §01                          | TTFB < 800ms target                      | 10.2                     |
| §01                          | Prefetch TTFB reduction target           | 10.2                     |
| §01                          | Asset-blocked load reduction target      | 10.2                     |
| **§02 Rendering**            | Headless Rendering Mode                  | 1.2                      |
| §02                          | Viewport Configuration (1280×900)        | 1.2                      |
| §02                          | Screenshot Capture (JPEG, quality, clip) | 1.3                      |
| §02                          | Partial Render Trigger                   | 2.4                      |
| §02                          | Scroll Control                           | 2.4                      |
| §02                          | Above-the-Fold Heuristic                 | 2.4                      |
| §02                          | Render Timing Observability              | 10.1                     |
| **§03 JavaScript (V8)**      | Page Script Execution                    | 1.1 (implicit)           |
| §03                          | JS Injection (Agent Actions)             | 1.7, 2.6                 |
| §03                          | DOM Extraction via JS                    | 2.6                      |
| §03                          | Applet Sandbox — Execution               | 7.4                      |
| §03                          | Applet Sandbox — CSP                     | 7.4                      |
| §03                          | Applet Lifecycle                         | 7.5                      |
| §03                          | Error Isolation                          | 11.4                     |
| §03                          | Applet Generation Contract               | 7.3, 11.1                |
| **§04 Accessibility Tree**   | AX Tree Extraction                       | 1.4                      |
| §04                          | AX Tree Normalization                    | 1.4                      |
| §04                          | Interactive Element Index                | 1.5                      |
| §04                          | Tiered Perception Protocol               | 2.1                      |
| §04                          | Confidence Threshold                     | 2.2                      |
| §04                          | AX Tree Staleness Detection              | 2.5                      |
| §04                          | Canvas/Custom Component Fallback         | 2.3                      |
| §04                          | Tiered Perception Decision Matrix        | 2.1                      |
| **§05 Process Architecture** | Ghost Tab Pool                           | 3.2                      |
| §05                          | BrowserContext Isolation                 | 3.1                      |
| §05                          | Context Lifecycle                        | 3.1, 11.2                |
| §05                          | IPC Message Schema                       | 3.4                      |
| §05                          | Parallel Task Scheduling                 | 3.5                      |
| §05                          | Resource Budget per Ghost Tab            | 3.6                      |
| §05                          | Crash Recovery                           | 3.7                      |
| §05                          | Ghost Tab State Machine                  | 3.3                      |
| **§06 CDP Interface**        | Page.navigate                            | 1.1                      |
| §06                          | Page.captureScreenshot                   | 1.1, 1.3                 |
| §06                          | Accessibility.getFullAXTree              | 1.4                      |
| §06                          | Runtime.evaluate                         | 1.7, 2.6                 |
| §06                          | Input.dispatchMouseEvent                 | 1.7                      |
| §06                          | Input.dispatchKeyEvent                   | 1.7                      |
| §06                          | Network.setRequestInterception           | 5.1                      |
| §06                          | Target.createTarget / closeTarget        | 3.2                      |
| §06                          | Performance.getMetrics                   | 10.1                     |
| §06                          | DOM.getDocument / querySelectorAll       | 2.6                      |
| §06                          | CDP Client (playwright-core)             | 1.1                      |
| **§07 Storage**              | Session Storage Isolation                | 3.1, 8.1                 |
| §07                          | Observation Cache                        | 4.4                      |
| §07                          | Task Result Store (SQLite)               | 8.2                      |
| §07                          | Applet Output Persistence                | 8.3                      |
| §07                          | Cookie / Auth Passthrough                | 8.4                      |
| §07                          | Storage Encryption (SQLCipher)           | 8.5                      |
| **§08 AI Engines**           | Navigator — Model Routing                | 2.1, 2.2                 |
| §08                          | Navigator — Action Schema                | 1.6                      |
| §08                          | Navigator — Context Window Mgmt          | 4.1                      |
| §08                          | Navigator — Task Decomposition           | 4.2                      |
| §08                          | Maker — Applet Brief Schema              | 7.1                      |
| §08                          | Maker — Output Validation                | 7.3                      |
| §08                          | Maker — Visualization Types              | 7.6                      |
| §08                          | Maker — Data Injection                   | 7.7, 7.2                 |
| **§09 Command Bar & UX**     | Natural Language Input                   | 6.1                      |
| §09                          | Intent Classification                    | 6.2                      |
| §09                          | Task Status Feed                         | 6.3                      |
| §09                          | Result Surface                           | 6.4                      |
| §09                          | Ghost Tab Visibility                     | 6.5                      |
| §09                          | Task Cancellation                        | 6.6                      |
| **§10 Deployment**           | Gemini API Proxy (Cloud Run)             | 9.1                      |
| §10                          | Authentication (OIDC)                    | 9.2                      |
| §10                          | Task Logging (Cloud Logging)             | 9.3                      |
| §10                          | Scaling Configuration                    | 9.4                      |
| §10                          | IaC (Terraform)                          | 9.5                      |
| **Appendix**                 | Tauri CDP Access                         | Out of scope (hackathon) |
| Appendix                     | Model Versioning                         | 2.1 (decision point)     |
| Appendix                     | Auth Cookie Passthrough UX               | 11.3                     |
| Appendix                     | Applet CDN Dependency                    | 7.4 (decision point)     |
| Appendix                     | AX Tree Normalization Perf               | 10.3                     |
| Appendix                     | Rate Limit Handling                      | 10.4                     |

---

## Appendix B: Open Questions & Decisions

These items from the spec's appendix need resolution. Recommended decision points are noted.

| Item                                  | Recommended Resolution                                                                                                                                                      | Decide By                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **Tauri CDP Access**                  | Out of scope for hackathon. Electron-only. Document Tauri migration path in README for production roadmap.                                                                  | Phase 0                                |
| **Model Versioning**                  | Pin Gemini 2.5 Flash for Tier 1, Gemini 2.5 Pro for Tier 2. Evaluate Gemini 3 Flash if available during development. Make model IDs configurable via environment variables. | Phase 1                                |
| **Auth Cookie Passthrough UX**        | Per-domain, per-task consent dialog. No persistence of consent across tasks. Simple modal dialog in foreground window.                                                      | Phase 8                                |
| **Applet CDN Dependency**             | For hackathon: CDN-only (Chart.js from jsdelivr). Add CSP exception for CDN domain. For production: bundle as fallback with feature detection.                              | Phase 7                                |
| **AX Tree Normalization Performance** | Profile during Phase 1. If > 15ms on 95th percentile, implement Worker thread in Phase 10.                                                                                  | Phase 1 (profile), Phase 10 (optimize) |
| **Rate Limit Handling**               | Implement request queue with exponential backoff in Cloud Run proxy. Track per-model RPM. Alert if consistently hitting limits.                                             | Phase 9                                |
