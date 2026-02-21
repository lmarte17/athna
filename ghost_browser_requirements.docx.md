

| GHOST BROWSER Browser Architecture & AI Optimization Requirements Intent-First Agentic Browser  ·  Technical Specification v1.0 |
| :---- |

| 🗂  Component-Level Requirements | 🤖  AI Optimization Strategy | 🏗  Electron \+ Tauri Targets |
| :---: | :---: | :---: |

# **Purpose & Scope**

This document defines the functional and AI-optimization requirements for the Ghost Browser — an intent-first, agentic web browser. It is organized by browser subsystem, covering both standard browser functionality and the AI-native behaviors layered on top.

Each section covers: what the subsystem does natively, what it must do in the Ghost Browser, and where AI optimization can reduce latency, token cost, or model load. This document is the source of truth for component-level engineering decisions.

| Design Philosophy The Ghost Browser does not build a rendering engine from scratch. It controls Chromium (via Electron for the hackathon, Tauri/Wry for production) through the Chrome DevTools Protocol (CDP). Every AI optimization decision is made in the orchestration layer above CDP — not inside the browser engine itself. |
| :---- |

# **System Architecture Overview**

The Ghost Browser is structured as three layers communicating over well-defined interfaces:

| Layer | Description |
| :---- | :---- |
| Shell Layer | Electron BrowserWindow (foreground UI) and headless BrowserWindow pool (Ghost Tabs). Handles rendering, JS execution, input, and storage via Chromium. |
| CDP Orchestration Layer | Node.js process that controls all BrowserWindow instances via CDP. Issues navigation, screenshot, input, and DOM commands. Routes results to AI engines. |
| AI Engine Layer | Dual-engine: Navigator Engine (Gemini Pro/Flash for vision \+ action planning) and Maker Engine (Gemini for applet generation). Stateless per-task; all state managed in orchestration layer. |

| Hackathon Stack Electron \+ Node.js orchestration \+ Gemini API (google-genai SDK). Ghost Tabs are headless Electron BrowserWindows. Applets are sandboxed iframes in the foreground window. Deployed to Google Cloud Run. |
| :---- |

| Production Target Tauri 2.0 with Wry WebView. CDP access via tauri-plugin-devtools or embedded CDP server. Rust orchestration layer replacing Node.js for lower memory footprint per Ghost Tab. |
| :---- |

| 01 | Networking Stack |
| :---: | :---- |

The networking stack handles DNS resolution, TCP/TLS connection management, HTTP/1.1, HTTP/2, and HTTP/3 (QUIC) request lifecycle, caching, CORS enforcement, and certificate validation. In Chromium this runs as an isolated network service process.

### **Functional Requirements**

| Component | Requirement / Behavior | AI Optimization |
| :---- | :---- | :---- |
| **Connection Pool** | Each Ghost Tab (headless BrowserContext) must have an isolated connection pool. Connections must not be shared across agent sessions to prevent state leakage. | *Pre-warm connections to predicted next URLs based on Navigator Engine's current page context.* |
| **Request Interception** | All outbound requests from Ghost Tabs must pass through a CDP Network interceptor before dispatch. Interceptor must be configurable per-session. | *Classify requests at intercept time: decide whether full HTML fetch or lightweight JSON/API response suffices for the agent's current task, skipping unnecessary asset loads.* |
| **Asset Filtering** | Ghost Tabs must block loading of images, fonts, and media by default unless the Navigator Engine explicitly requires a visual render pass. | *Reduces page load time for Ghost Tabs by 40-70% on media-heavy pages. Re-enable assets only when a screenshot is requested.* |
| **HTTP Cache** | Each BrowserContext must have its own disk cache partition. Cache TTL must respect server headers but be overridable per-agent-session. | *Cache agent-visited page resources so that repeat visits within a session do not re-fetch. Layer an application-level observation cache on top (see Storage section).* |
| **Predictive Prefetch** | Orchestration layer must expose an API to prefetch a URL into a warm connection without initiating a full navigation. | *Navigator Engine signals likely next URL before executing the click action; prefetch runs in parallel with model inference.* |
| **Error Handling** | Network errors (DNS failure, timeout, 4xx, 5xx) must be caught at the orchestration layer and surfaced to the Navigator Engine as structured error objects, not raw HTML error pages. | *Model receives structured {status, url, retryable} rather than a screenshot of an error page, reducing wasted inference calls.* |

### **Performance Targets**

| Metric | Target |
| :---- | :---- |
| Time to first byte (Ghost Tab, assets blocked) | \< 800ms on broadband for typical e-commerce pages |
| Connection warm-up via prefetch | Reduce TTFB by 150-300ms on predicted navigations |
| Asset-blocked page load vs. full load | ≥ 40% reduction in load time |

| 02 | Rendering Engine |
| :---: | :---- |

The rendering engine transforms HTML \+ CSS \+ JS into pixels through a pipeline: HTML parsing → DOM construction → style calculation (CSSOM) → layout → paint → GPU composite. This is the most resource-intensive subsystem and the primary target for AI optimization in Ghost Tabs.

### **Functional Requirements**

| Component | Requirement / Behavior | AI Optimization |
| :---- | :---- | :---- |
| **Headless Rendering Mode** | Ghost Tabs must run in headless Chromium mode (--headless=new). GPU compositing and antialiasing must be disabled. Offscreen rendering must be enabled for screenshot capture. | *Eliminates GPU process overhead for tabs the user cannot see. Reduces memory per Ghost Tab from \~120MB to \~60MB.* |
| **Viewport Configuration** | Viewport dimensions must be programmable per Ghost Tab via CDP. Default Ghost Tab viewport: 1280×900. Foreground window: matches user display. | *Model receives consistent input size. 1280×900 is sufficient for Gemini Vision without scaling. Reduces image payload to model vs. HiDPI captures.* |
| **Screenshot Capture** | CDP Page.captureScreenshot must be callable with configurable format (JPEG preferred), quality (75-85 for agent use), and clip region. Must support full-page and viewport-only modes. | *Use viewport-only screenshots by default. Escalate to full-page scroll-and-stitch only when Navigator Engine determines the target element is below the fold.* |
| **Partial Render Trigger** | Orchestration layer must be able to halt further rendering after initial paint \+ layout (before composite) when only layout/accessibility data is needed and no screenshot is required. | *Saves composite \+ GPU upload cost when the accessibility tree is sufficient for navigation decisions.* |
| **Scroll Control** | CDP Input.dispatchMouseEvent (scroll) and Runtime.evaluate (window.scrollBy) must both be available. Scroll position must be queryable at any time. | *Navigator Engine uses scroll position plus viewport height to determine whether to issue another screenshot or if the target is in-frame.* |
| **Above-the-Fold Heuristic** | Before a full-page screenshot, the orchestration layer must first capture the viewport, pass to the model, and only scroll \+ re-capture if the model returns a SCROLL action. | *Prevents unnecessary rendering of long pages. Most navigation targets are within the first two viewport heights on well-designed sites.* |
| **Render Timing Observability** | CDP Performance domain must be enabled on all Ghost Tabs. LayoutCount, RecalcStyleCount, and PaintCount must be logged per navigation for performance tuning. | — (infrastructure requirement) |

### **Viewport & Screenshot Standards**

| Context | Specification |
| :---- | :---- |
| Ghost Tab default viewport | 1280 × 900 px, device scale factor 1.0 |
| Screenshot format | JPEG, quality 80 |
| Screenshot max dimension for model | 1280px wide (no upscaling) |
| Full-page scroll step | 800px (≈ 89% viewport height, 11% overlap for context continuity) |
| Max scroll steps before agent abort | 8 (flags infinite-scroll or broken pages) |

| 03 | JavaScript Engine (V8) |
| :---: | :---- |

V8 is Chromium's JavaScript engine. It executes page scripts via the Ignition interpreter and TurboFan JIT compiler. For the Ghost Browser, V8 serves two roles: executing page JavaScript as pages require, and serving as the sandbox in which AI-generated applets run.

### **Functional Requirements**

| Component | Requirement / Behavior | AI Optimization |
| :---- | :---- | :---- |
| **Page Script Execution** | V8 must execute page JavaScript normally within Ghost Tabs. JS execution must not be disabled — many target sites require it for content rendering and interaction. | — (required for correct page behavior) |
| **JS Injection (Agent Actions)** | Orchestration layer must be able to inject and execute arbitrary JavaScript in the page context of any Ghost Tab via CDP Runtime.evaluate or Runtime.callFunctionOn. | *Navigator Engine outputs actions as structured JSON. Orchestration layer translates these to JS injection calls, enabling actions like element.click(), form.submit(), and custom scroll behaviors.* |
| **DOM Extraction via JS** | Injected scripts must be able to extract: element bounding boxes (getBoundingClientRect), visible text (innerText), input values, and computed styles. Results returned as JSON to orchestration layer. | *Before issuing a screenshot, the orchestration layer runs a lightweight DOM extraction script. If the target element is identified unambiguously by text \+ bounding box, the vision model call is skipped entirely.* |
| **Applet Sandbox — Execution** | AI-generated applets (HTML/JS/CSS) must run in isolated iframes with sandbox attributes: allow-scripts only. No allow-same-origin, no allow-forms, no allow-popups. | *Applet code is generated by Gemini. Sandbox isolation prevents generated code from accessing parent window, cookies, or making outbound requests.* |
| **Applet Sandbox — CSP** | Each applet iframe must have a Content Security Policy injected by the orchestration layer: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'. No external resource loading. | — (security requirement for generated code) |
| **Applet Lifecycle** | Applets must be mountable and unmountable from the foreground window DOM on demand. Maximum one active applet per browser window at a time. Applet state is discarded on unmount. | *Maker Engine generates single-use applets. Unmounting and discarding ensures no cross-task data leakage in generated code.* |
| **Error Isolation** | Runtime errors within Ghost Tab page scripts or applet scripts must be caught at the CDP level and must not crash the orchestration process. Error details must be returned as structured objects. | *Structured errors allow the Navigator Engine to decide whether to retry, navigate away, or escalate to a screenshot-based approach.* |

| Applet Generation Contract The Maker Engine receives a structured brief: {dataType, sourceData, desiredVisualization, constraints}. It outputs a single self-contained HTML string with inline CSS and JS. The orchestration layer validates the string against an allowlist of JS APIs before injecting into the sandbox iframe. Prohibited APIs: fetch, XMLHttpRequest, WebSocket, localStorage, document.cookie, window.parent. |
| :---- |

| 04 | Accessibility Tree |
| :---: | :---- |

The browser builds a parallel semantic tree from the DOM describing each element's role (button, heading, link, input), label, state (enabled/disabled/checked), and relationships. This is the single most important optimization surface in the Ghost Browser — it provides structured page understanding at a fraction of the cost of vision inference.

### **Functional Requirements**

| Component | Requirement / Behavior | AI Optimization |
| :---- | :---- | :---- |
| **AX Tree Extraction** | CDP Accessibility.getFullAXTree must be called on every Ghost Tab page load, after DOM content loaded and before any screenshot is taken. | *The AX tree is the primary perception input. Screenshot is the fallback. Most major commerce, travel, and SaaS sites have sufficient ARIA labeling for text-only navigation.* |
| **AX Tree Normalization** | Raw CDP AX tree must be normalized into a compact JSON structure retaining only: nodeId, role, name, value, description, states\[\], boundingBox. Irrelevant roles (generic, none, presentation) must be pruned. | *Reduces token count sent to model. A full raw AX tree for a complex page can exceed 50,000 characters; normalized form targets \< 8,000 characters.* |
| **Interactive Element Index** | A filtered subset of the normalized AX tree — containing only interactive elements (buttons, links, inputs, selects, checkboxes) with their bounding boxes — must be maintained as a separate data structure. | *Allows Gemini Flash to reason about available actions without processing the full page tree. Fast first-pass orientation before deeper analysis.* |
| **Tiered Perception Protocol** | Orchestration layer must implement a three-tier perception decision: (1) Try AX tree \+ Flash model. (2) If confidence \< threshold, add viewport screenshot \+ Pro model. (3) If target not found, scroll and repeat from tier 1\. | *Tier 1 costs \~$0.00015 per call (Flash, \~4K tokens). Tier 2 costs \~$0.003 per call (Pro, image input). Targeting 80%+ of navigations resolved at Tier 1\.* |
| **Confidence Threshold** | Navigator Engine must return a confidence score (0.0-1.0) with each action decision. If score \< 0.75, orchestration layer must escalate to next tier. | *Prevents model from hallucinating actions on ambiguous pages. Explicit escalation path ensures correctness over speed when needed.* |
| **AX Tree Staleness Detection** | After each agent action, the orchestration layer must detect DOM mutations via MutationObserver injection and re-fetch the AX tree if significant structural changes are detected. | *Prevents the model from acting on stale tree state after dynamic content loads (e.g., dropdown appearing after a click).* |
| **Canvas & Custom Component Fallback** | If AX tree normalization returns fewer than 5 interactive elements for a page that visually has more, orchestration layer must flag the page as AX-deficient and route directly to Tier 2 (screenshot). | *Canvas-heavy pages (games, custom UI frameworks) provide no AX data. Early detection prevents wasted Tier 1 calls.* |

### **Tiered Perception Decision Matrix**

| Condition | Action |
| :---- | :---- |
| AX tree has ≥ 5 interactive elements \+ target identifiable by label | Tier 1: Flash \+ AX tree only. No screenshot. |
| AX tree has elements but target ambiguous (confidence \< 0.75) | Tier 2: Capture viewport screenshot, combine with AX tree, use Pro model. |
| AX tree has \< 5 interactive elements (AX-deficient page) | Skip to Tier 2 immediately. |
| Target not found after Tier 2 at current scroll position | Scroll 800px, re-run from Tier 1\. |
| Target not found after 8 scroll steps | Abort task, return FAILED result to user with page URL for manual review. |

| 05 | Process Architecture & Ghost Tabs |
| :---: | :---- |

Chromium uses a multi-process architecture for security and stability. The Browser Process is privileged and manages the UI. Each Renderer Process handles one or more pages in isolation. For the Ghost Browser, each Ghost Tab is a headless Renderer Process controlled by a corresponding BrowserContext. The orchestration layer lives in the Browser Process (main Electron process).

### **Functional Requirements**

| Component | Requirement / Behavior | AI Optimization |
| :---- | :---- | :---- |
| **Ghost Tab Pool** | Orchestration layer must maintain a warm pool of pre-initialized headless BrowserWindows. Pool minimum: 2\. Pool maximum: configurable (default 6, constrained by available RAM). | *Eliminates \~80ms cold-start cost per Ghost Tab spawn. New tasks are assigned from the pool immediately; pool replenishes asynchronously.* |
| **BrowserContext Isolation** | Each Ghost Tab must use a separate Chromium BrowserContext with its own: cookie jar, localStorage, sessionStorage, IndexedDB, cache partition, and network credentials. | *Prevents cross-task state contamination. Enables parallel agents to hold different login sessions for the same site simultaneously.* |
| **Context Lifecycle** | BrowserContexts must be created fresh for each user-initiated task and destroyed (with all associated storage) upon task completion or user cancellation. | — (privacy requirement; ensures no residual auth tokens or form data persist across tasks) |
| **IPC Message Schema** | All communication between Ghost Tabs (renderer processes) and the orchestration layer (browser process) must use a typed IPC schema. Message types: NAVIGATE, SCREENSHOT, AX\_TREE, INJECT\_JS, INPUT\_EVENT, TASK\_RESULT, TASK\_ERROR. | *Typed schema enables the orchestration layer to route model outputs directly to the correct CDP command without string parsing.* |
| **Parallel Task Scheduling** | Orchestration layer must support concurrent execution of N Ghost Tab tasks where N \= pool size. Tasks must be queued when pool is exhausted. Queue must be FIFO with priority override for foreground-initiated tasks. | *Enables the core Ghost Tab value proposition: parallel background research while the user works in the foreground.* |
| **Resource Budget per Ghost Tab** | Each Ghost Tab must be subject to configurable CPU and memory budgets. Defaults: CPU 25% of one core, Memory 512MB. Tabs exceeding budget for \> 10s must be flagged and optionally killed. | *Prevents runaway agents (e.g., on infinite-scroll pages) from degrading the foreground browser experience.* |
| **Crash Recovery** | If a Ghost Tab renderer process crashes, the orchestration layer must detect via CDP Target.targetCrashed event, log the failure, and retry the task on a fresh Ghost Tab up to 2 times before reporting failure. | — (reliability requirement) |

### **Ghost Tab State Machine**

| State | Description |
| :---- | :---- |
| IDLE | In pool, pre-initialized, awaiting task assignment |
| LOADING | Navigating to target URL; network requests in flight |
| PERCEIVING | Running AX tree extraction and/or screenshot capture |
| INFERRING | Waiting for model response (Gemini API call in flight) |
| ACTING | Executing CDP input/JS injection commands |
| COMPLETE | Task finished; result returned; context being destroyed |
| FAILED | Unrecoverable error; result returned with error detail |

| 06 | Chrome DevTools Protocol (CDP) Interface |
| :---: | :---- |

CDP is the programmatic control interface to Chromium. It exposes domains for every browser subsystem. The orchestration layer is, in essence, a CDP client that translates model outputs into CDP commands. This section defines which domains and methods are required and how they map to agent behaviors.

### **Required CDP Domains & Methods**

| Component | Requirement / Behavior | AI Optimization |
| :---- | :---- | :---- |
| **Page.navigate** | Navigate a Ghost Tab to a URL. Must return loadEventFired before declaring page ready for perception. | *Entry point for all navigation actions output by the Navigator Engine.* |
| **Page.captureScreenshot** | Capture JPEG screenshot at configurable quality and clip region. Must support fromSurface: true for headless accuracy. | *Tier 2 perception input. Called only after AX tree is insufficient.* |
| **Accessibility.getFullAXTree** | Return the full accessibility tree for the current page. Must be called after loadEventFired \+ DOMContentLoaded. | *Primary Tier 1 perception input. Lowest cost path to page understanding.* |
| **Runtime.evaluate** | Execute JavaScript expression in page context. Must support awaitPromise for async operations and returnByValue for JSON-serializable results. | *DOM extraction scripts, scroll position queries, and custom action implementations.* |
| **Input.dispatchMouseEvent** | Dispatch synthetic mouse events (mousemove, mousedown, mouseup, click) at absolute page coordinates. Must support type: click as shorthand. | *Primary action mechanism. Model outputs {x, y} coordinates; orchestration dispatches click.* |
| **Input.dispatchKeyEvent** | Dispatch synthetic keyboard events. Must support type: char for text input and type: keyDown/keyUp for special keys (Enter, Tab, Escape, Arrow keys). | *Required for form filling, search input, and keyboard navigation actions.* |
| **Network.setRequestInterception** | Intercept outbound network requests before dispatch. Must support pattern-based filtering and response modification. | *Asset blocking for Ghost Tabs and request classification logic.* |
| **Target.createTarget / closeTarget** | Create and destroy browsing contexts (Ghost Tabs) programmatically. | *Ghost Tab pool management.* |
| **Performance.getMetrics** | Return performance metrics including LayoutCount, RecalcStyleCount, ScriptDuration, TaskDuration. | *Observability for performance tuning. Not in critical path.* |
| **DOM.getDocument \+ DOM.querySelectorAll** | DOM queries as fallback when AX tree lacks sufficient data and JS injection is inappropriate. | *Structural fallback for specific cases (e.g., identifying iframes, shadow DOM roots).* |

| CDP Client Implementation Use playwright-core (without browser download) or puppeteer-core as the CDP client library in the Node.js orchestration layer. Both provide typed wrappers over raw CDP with reconnection handling and proper event lifecycle management. Do not implement raw CDP WebSocket communication manually. |
| :---- |

| 07 | Storage Layer |
| :---: | :---- |

The storage layer covers both browser-native storage (cookies, localStorage, IndexedDB, HTTP cache) and application-level storage (agent observation cache, task results, applet outputs). Both must be managed with session isolation and efficient retrieval.

### **Functional Requirements**

| Component | Requirement / Behavior | AI Optimization |
| :---- | :---- | :---- |
| **Session Storage Isolation** | Each Ghost Tab BrowserContext must have fully isolated browser storage (cookies, localStorage, sessionStorage, IndexedDB, HTTP cache). Clearing a context must delete all associated storage atomically. | *Isolation is a correctness and privacy requirement, not an optimization. But it enables a valuable feature: parallel agents can hold independent authenticated sessions.* |
| **Observation Cache** | Orchestration layer must maintain an in-memory observation cache: {url → {axtree\_hash, screenshot\_b64, timestamp, ttl}}. TTL default: 60 seconds. Cache must be per-task-session and discarded at task completion. | *If the Navigator Engine revisits a URL within the same task (common during form flows and multi-step checkouts), cached perception data can be reused without re-rendering or re-inferring.* |
| **Task Result Store** | Completed task results (structured data extracted by agents) must be persisted to a lightweight local store (SQLite via better-sqlite3). Schema: {task\_id, timestamp, intent, status, result\_json, source\_urls\[\]}. | *Enables the foreground browser to display past task results and enables the Maker Engine to access multi-task aggregated data for applet generation.* |
| **Applet Output Persistence** | Generated applets must be persisted as HTML strings in the task result store, associated with their source task. Max stored applets: 50 (LRU eviction). | *Allows users to re-open a previously generated visualization without re-running the agent or re-calling the Maker Engine.* |
| **Cookie / Auth Passthrough** | For tasks where the user is already authenticated in the foreground browser on a target site, orchestration layer must expose an explicit API to clone the foreground context's cookies into a Ghost Tab context for that domain only. | *Enables authenticated Ghost Tab tasks (e.g., checking your own order history) without requiring the user to log in again inside the agent flow. Requires explicit user permission per domain.* |
| **Storage Encryption** | The task result SQLite database must be encrypted at rest using SQLCipher. Key derived from user-specific local credential. | — (privacy requirement for stored browsing/task data) |

| 08 | AI Engine Layer |
| :---: | :---- |

The AI Engine Layer consists of two purpose-built engines that consume browser perception data and produce structured outputs. They are stateless per-call; all session state is managed by the orchestration layer.

### **8.1 Navigator Engine**

The Navigator Engine drives Ghost Tab behavior. It receives perception data (AX tree and/or screenshot) plus task context and outputs a single structured action per call.

| Component | Requirement / Behavior | AI Optimization |
| :---- | :---- | :---- |
| **Model Routing** | Tier 1 calls (AX tree only) must use Gemini Flash. Tier 2 calls (screenshot \+ AX tree) must use Gemini Pro. Model selection is handled by the orchestration layer, not the engine itself. | *Flash costs \~10x less than Pro and responds \~2x faster. Routing correctly dramatically reduces per-task cost.* |
| **Action Schema** | Every Navigator Engine response must conform to a typed action schema: {action: CLICK|TYPE|SCROLL|WAIT|EXTRACT|DONE|FAILED, target: {x, y}|null, text: string|null, confidence: 0.0-1.0, reasoning: string}. | *Typed outputs eliminate brittle string parsing. The orchestration layer maps action types directly to CDP commands.* |
| **Context Window Management** | Orchestration layer must maintain a rolling context window of the last 5 actions \+ observations per task. Older history must be summarized and compressed before inclusion. | *Prevents context overflow on long multi-step tasks. Summarization preserves goal relevance without token bloat.* |
| **Task Decomposition** | For complex intents (\> 2 implied steps), the Navigator Engine must decompose the intent into an ordered subtask list before beginning execution. Subtasks must be tracked and checkpointed. | *Decomposition enables recovery: if a subtask fails, the orchestration layer can retry from the last checkpoint rather than restarting the entire task.* |

### **8.2 Maker Engine**

The Maker Engine generates single-use interactive applets from structured data aggregated across Ghost Tabs.

| Component | Requirement / Behavior | AI Optimization |
| :---- | :---- | :---- |
| **Applet Brief Schema** | Input to Maker Engine must be a structured brief: {intent, dataType, data: object\[\], visualizationHint, constraints: string\[\]}. No raw HTML or screenshots as input. | *Structured input enables consistent, validatable outputs and prevents prompt injection via web-scraped content.* |
| **Output Validation** | Generated applet HTML must pass: (1) HTML parse validation, (2) API allowlist check (no prohibited JS APIs), (3) size check (\< 100KB). Failures must trigger a retry with error context appended to the prompt. | *Generated code safety is non-negotiable. Three-layer validation provides defense in depth before sandbox injection.* |
| **Visualization Types** | Maker Engine must support at minimum: sortable comparison tables, line/bar/pie charts (via inline Chart.js from CDN), and filterable card grids. Additional types are generated freeform by the model. | *Comparison tables and charts cover 90% of the research synthesis use cases (price comparison, flight search, product features).* |
| **Data Injection** | Structured data from task results must be injected into the applet as a JSON literal in a const DATA \= {...} declaration at the top of the generated script. The model must not embed data inline in markup. | *Separating data from markup makes validation and sanitization tractable. Data is sanitized (HTML-escaped) before injection.* |

| 09 | Command Bar & UX Layer |
| :---: | :---- |

The Command Bar replaces the traditional browser address bar. It is the primary user-facing interface and the entry point for all intent-driven tasks. It must support natural language input, real-time task status, and result surfacing.

### **Functional Requirements**

| Component | Requirement / Behavior | AI Optimization |
| :---- | :---- | :---- |
| **Natural Language Input** | Command Bar must accept free-text natural language input with no required syntax. Users must not be required to use special keywords or commands. | — (core UX requirement) |
| **Intent Classification** | Before task dispatch, the orchestration layer must classify the intent: NAVIGATE (single URL destination), RESEARCH (multi-site information gathering), TRANSACT (form fill / checkout), GENERATE (Maker Engine request). Classification determines execution path. | *Classification prevents over-engineering simple requests. A request for 'google.com' should just navigate; it should not spawn a Ghost Tab.* |
| **Task Status Feed** | Active Ghost Tab tasks must surface real-time status updates in a sidebar panel: current URL, current action, elapsed time, progress indicator. Updates must arrive via IPC at a max rate of 2Hz. | *Keeps the user informed without being distracting. 2Hz cap prevents UI jank from rapid status updates.* |
| **Result Surface** | Task results must be surfaced in a structured result card in the foreground UI: source URLs, extracted data, confidence indicator, and (if applicable) an applet render button. | *Result card enables the user to verify agent findings before acting on them. Confidence indicator sets appropriate expectations.* |
| **Ghost Tab Visibility** | User must be able to click through to any active Ghost Tab's current state (live or last screenshot) from the task status feed. Ghost Tab must not receive user input focus by default. | *Transparency into agent behavior builds user trust. Read-only visibility prevents accidental user interference with agent execution.* |
| **Task Cancellation** | User must be able to cancel any in-progress Ghost Tab task at any time. Cancellation must: terminate the model API call, close the BrowserContext, and return a partial result if any data was extracted. | — (user control requirement) |

| 10 | Deployment & Cloud Infrastructure |
| :---: | :---- |

The hackathon submission requires Google Cloud deployment of the backend. The Ghost Browser follows a hybrid architecture: the Electron shell runs locally (client), while the AI orchestration layer and Gemini API calls are proxied through a Cloud Run backend service.

### **Architecture Decision: Local vs. Cloud**

| Hybrid Model Rationale Full cloud rendering (streaming pixels from a cloud browser to a local shell) introduces prohibitive latency for interactive navigation. Instead, Chromium runs locally, CDP commands execute locally, and only AI inference calls are routed through the Cloud Run backend. This keeps perception-action latency under 500ms while satisfying the GCP hosting requirement. |
| :---- |

### **Cloud Run Backend Requirements**

| Component | Requirement / Behavior | AI Optimization |
| :---- | :---- | :---- |
| **Gemini API Proxy** | Cloud Run service must proxy all Gemini API calls from the local orchestration layer. Handles API key management, rate limiting, and request logging centrally. | *Centralizing API key management prevents key exposure in the Electron app binary.* |
| **Task Logging** | All task events (intent, actions, results, errors) must be logged to Cloud Logging via the Cloud Run service. Log entries must include task\_id, user\_id (hashed), timestamp, and model used. | *Provides audit trail for debugging agent failures and measuring tiered perception effectiveness.* |
| **Authentication** | Cloud Run service must require authentication via Google Identity Platform (OIDC tokens). Local Electron app must authenticate on startup. | — (security requirement) |
| **Scaling** | Cloud Run service must be configured with min-instances: 1 (cold start prevention) and max-instances: 10\. Concurrency: 80 requests per instance. | — (infrastructure requirement) |
| **IaC** | Cloud Run deployment must be defined in Terraform or Cloud Deployment Manager. Configuration must be committed to the public repository. | *Fulfills hackathon bonus requirement for automated cloud deployment.* |

# **Appendix: Open Questions & Decisions**

The following items require resolution before or during development:

| Item | Notes |
| :---- | :---- |
| Tauri CDP Access | Tauri's WebView (WKWebView on macOS, WebKitGTK on Linux) does not natively expose the same CDP interface as Chromium. Options: Tauri-plugin-devtools (limited), embedded Chromium via CEF, or ship a headless Chromium binary alongside Tauri for Ghost Tabs only. |
| Model Versioning | Gemini Pro vs. Flash model versions pinned to what? Need to evaluate Gemini 2.5 Flash for Tier 1 vs. Gemini 2.0 Flash for cost sensitivity at scale. |
| Auth Cookie Passthrough UX | The mechanism for copying foreground auth cookies to a Ghost Tab session requires explicit per-domain user permission. UX for this consent flow is undefined. |
| Applet CDN Dependency | Chart.js is loaded from CDN in generated applets. Offline use case requires bundling. Decide: always bundle, always CDN, or feature-detect and fallback? |
| AX Tree Normalization Performance | Normalizing a large AX tree (500+ nodes) may take 5-15ms of synchronous JS. Profile in practice and consider moving to a Worker thread if this becomes a bottleneck. |
| Rate Limit Handling | Gemini API rate limits under parallel Ghost Tab usage (6 concurrent tabs, 2 model calls per navigation step) may hit RPM limits. Design a request queue with exponential backoff in the Cloud Run proxy. |

*Ghost Browser  ·  Technical Specification v1.0  ·  Internal Use Only*