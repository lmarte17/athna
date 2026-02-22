# Phase 5 Reference Writeup: Networking Stack Optimization

## Purpose
This document consolidates what we implemented in Phase 5 (5.1-5.5), why each decision was made, and what results we got. It is meant as a memory-safe reference for the final submission writeup.

Primary Phase 5 goal from `docs/build/phase-5.md`:

- Add a networking optimization and reliability layer for Ghost Tabs: interception/filtering, connection isolation, predictive prefetch, structured network errors, and cache partition policy control.

## Scope Summary
Implemented in Phase 5:

- Request interception with dual runtime modes (`AGENT_FAST`, `VISUAL_RENDER`) and classification telemetry
- Asset filtering defaults (block `Image`/`Font`/`Media`) with visual-pass re-enable path
- Per-BrowserContext connection-pool isolation validation at TCP and CDP levels
- Predictive prefetch API (`HEAD`, non-navigation) plus loop integration and telemetry
- Structured network error classification and Navigator routing (`DNS_FAILURE`, `HTTP_5XX`, etc.)
- Per-session HTTP cache policy controls (`RESPECT_HEADERS`, `FORCE_REFRESH`, `OVERRIDE_TTL`)
- HTTP cache partition validation across contexts with TTL override behavior

Not implemented in Phase 5 (intentionally deferred):

- External-site production benchmarking/telemetry expansion (Phase 10 hardening + benchmark work)
- UI-level controls/visualization for network policies and cache mode toggles (Phase 6 UX layer)
- Security hardening items such as allowlist hardening and consent UX (Phase 11)

## Browser-Layer Mapping (Requirements Alignment)
This is how Phase 5 work maps to `ghost_browser_requirements.docx.md` and why it matters.

- Networking stack (`Spec §01`):
  - Implemented request interception, asset filtering, prefetch, structured network errors, and session cache policy controls.
  - Why: this is the direct performance/reliability control plane for web navigation.

- Connection pool isolation (`Spec §01`, Connection Pool):
  - Verified that separate Ghost Tab BrowserContexts do not share transport connections.
  - Why: prevents cross-session leakage and preserves session correctness in parallel runs.

- Request interception and filtering (`Spec §01`, Request Interception + Asset Filtering):
  - Added configurable interception with `AGENT_FAST` default blocking and `VISUAL_RENDER` pass-through mode.
  - Why: keeps default perception fast while preserving screenshot fidelity when needed.

- Predictive prefetch (`Spec §01`, Predictive Prefetch):
  - Added non-navigation `prefetch(url)` and loop-triggered prefetch before click execution.
  - Why: reduces TTFB for likely next navigations without forcing full-page loads.

- Error handling (`Spec §01`, Error Handling):
  - Converted network failures to structured error objects and routed them into Navigator decisions.
  - Why: avoids misinterpreting browser error pages as normal content.

- HTTP cache + observation cache integration (`Spec §01`, `Spec §07`):
  - Preserved per-context cache partitions and added orchestration-level session cache policy/TTL overrides.
  - Why: enables both correctness isolation and task-specific freshness policy.

## Phase-by-Phase: How, Why, Results

### 5.1 Request Interception & Asset Filtering
How:

- Enabled `Fetch.requestPaused` interception in the CDP client.
- Added mode control:
  - `AGENT_FAST`: block `Image`, `Font`, `Media`
  - `VISUAL_RENDER`: continue requests for render fidelity
- Added request classification metrics (`DOCUMENT_HTML`, `JSON_API`, `STATIC_ASSET`, `OTHER`) and per-navigation/lifetime telemetry.
- Added visual render pass helper to temporarily re-enable blocked assets for screenshot capture.

Why:

- Default Ghost Tab perception should avoid expensive media fetches unless a visual pass is explicitly needed.

Result:

- Median load dropped from `801ms` (visual baseline) to `65ms` (agent-fast), with observed reduction ratio `0.919` versus required minimum `0.4`.
- Agent-fast blocked `26` requests per run (`24` images, `1` font, `1` media) while keeping API path available.
- Visual pass successfully reloaded previously blocked image assets (`naturalWidth` changed `0 -> 1`, `visualRenderPassCount=1`).
- Artifact:
  - `docs/artifacts/phase5/phase5-5.1/request-interception-result.json`

### 5.2 Connection Pool Isolation
How:

- Ran two concurrent contexts through real pool leases and a keep-alive fixture server.
- Captured server socket usage and CDP `Network.responseReceived` connection metadata per context.

Why:

- Session isolation requires transport-level separation, not just storage partition separation.

Result:

- No cross-context server socket sharing (`sharedServerSockets=[]`).
- No cross-context CDP connection-id sharing (`sharedCdpConnectionIds=[]`).
- Keep-alive reuse remained healthy within each context (`reusedServerSocketByContext` true for both contexts).
- Pool remained healthy post-run (`available=2`, `inUse=0`, `queued=0`).
- Artifact:
  - `docs/artifacts/phase5/phase5-5.2/connection-pool-isolation-result.json`

### 5.3 Predictive Prefetch
How:

- Added `GhostTabCdpClient.prefetch(url)` using non-navigation `HEAD` fetch in Ghost Tab context.
- Added loop-side candidate extraction (DOM link target / action text URL) and non-blocking prefetch dispatch before click execution.
- Persisted prefetch telemetry in `prefetches[]` and step history (`prefetchCandidateUrl`, `prefetchStatus`, `prefetchReason`, `prefetchDurationMs`).

Why:

- Warming likely next URLs should reduce navigation TTFB without paying full navigation cost up front.

Result:

- Baseline median TTFB: `227ms`; prefetched median TTFB: `5.5ms`.
- Observed median reduction: `221.5ms`, inside the target `150-300ms` range.
- Prefetch did not change active-page URL before navigation.
- Loop integration emitted prefetch event (`source=DOM_LINK_TARGET`, `status=PREFETCHED`, `reason=PREFETCH_REQUEST_DISPATCHED`).
- Artifact:
  - `docs/artifacts/phase5/phase5-5.3/predictive-prefetch-result.json`

### 5.4 Structured Network Error Handling
How:

- Classified navigation failures into structured network error types (`DNS_FAILURE`, `CONNECTION_TIMEOUT`, `TLS_ERROR`, `HTTP_4XX`, `HTTP_5XX`, etc.).
- Routed structured errors to Navigator decision path before any perception screenshot flow.
- Persisted structured error timeline events and final error details.

Why:

- Network failures should be handled as typed control events, not as inferred page content.

Result:

- DNS scenario produced structured error with `status=null`, `retryable=true`, `errorType=DNS_FAILURE`.
- HTTP 503 scenario produced structured error with `status=503`, `retryable=true`, `errorType=HTTP_5XX`.
- Both scenarios routed through Navigator with `decisionAction=WAIT` and `navigatorCallCount=1`.
- Tier-2 screenshot path remained unused for these network-failure flows (`tier2Calls=0` in scenario artifacts).
- Artifacts:
  - `docs/artifacts/phase5/phase5-5.4/network-error-handling-result.json`
  - `docs/artifacts/phase5/phase5-5.4/scenarios/dns-failure-network-error-handling-result.json`
  - `docs/artifacts/phase5/phase5-5.4/scenarios/http-503-network-error-handling-result.json`

Note:

- 5.4 uses deterministic Navigator stub behavior in the smoke harness to assert routing semantics, while the browser/network path remains real.

### 5.5 HTTP Cache Partitioning
How:

- Added session-level cache policy in CDP/orchestration:
  - `RESPECT_HEADERS`
  - `FORCE_REFRESH`
  - `OVERRIDE_TTL` (session TTL window with forced refresh after expiry)
- Applied cache policy at navigation boundaries using CDP cache-disabled control.
- Exposed policy through loop/task inputs and emitted applied policy in task result.
- Validated with two real BrowserContexts and local cacheable fixture resources (no stubs/mock data for this smoke).

Why:

- Ghost Tabs need both strict context cache isolation and workload-specific freshness controls.

Result:

- Repeat visit reused cache in-session (`firstNavigationHits=1`, `secondNavigationHits=1`).
- `FORCE_REFRESH` fetched each time (`hitsBefore=1`, then `2`, then `3`).
- `OVERRIDE_TTL` reused within TTL and refreshed after expiry (`1 -> 1 -> 2` with `ttlMs=2000`).
- Cross-context partitioning held on same resource key:
  - ctx1 `1 -> 1`
  - ctx2 first nav `2` (cache miss against ctx1)
  - ctx2 second nav `2` (ctx2 cache reuse)
- Artifact:
  - `docs/artifacts/phase5/phase5-5.5/http-cache-partitioning-result.json`

## Optimizations We Intentionally Applied in Phase 5
- Default interception posture (`AGENT_FAST`) to suppress high-cost static assets.
- Visual-pass-only asset re-enable path to avoid always-on rich rendering cost.
- Explicit per-context connection validation to enforce isolation contracts under concurrency.
- Prefetch as non-navigation `HEAD` path to warm likely targets without page state churn.
- Structured network error normalization to keep failure handling deterministic and model-friendly.
- Session-level cache policy controls so orchestration can choose freshness vs reuse by task type.
- End-to-end telemetry and artifacts for each milestone to make policy behavior auditable.

## Known Tradeoffs and Residual Risks
- Prefetch uses `HEAD` and may not provide equal warm-up benefit on all origin/CDN configurations.
- Cache TTL override currently uses session URL-visit timing; highly dynamic resources may still require stronger invalidation keys.
- Request filtering defaults prioritize speed and may hide visual context unless a visual pass is invoked.
- 5.4 smoke intentionally focuses on structured routing semantics and uses deterministic Navigator responses for assertion stability.
- Some transport/cache behaviors can vary on external sites versus deterministic local harness fixtures.

## What To Highlight in Final Submission Writeup
- Phase 5 turned networking into a policy-driven subsystem rather than passive browser behavior.
- Performance and correctness were addressed together:
  - faster default loading (interception/filtering),
  - lower predicted-navigation latency (prefetch),
  - safer failure handling (structured network errors),
  - explicit freshness controls (cache policy modes + TTL override).
- Isolation remained a first-class constraint across both transport and cache layers.
- Every milestone is backed by reproducible smoke artifacts with quantitative assertions.

## Quick Evidence Index
- Requirements baseline: `ghost_browser_requirements.docx.md`
- Build milestones baseline: `docs/build/phase-5.md`
- Phase 5 milestone notes:
  - `docs/phase5/phase5-5.1-request-interception-asset-filtering.md`
  - `docs/phase5/phase5-5.2-connection-pool-isolation.md`
  - `docs/phase5/phase5-5.3-predictive-prefetch.md`
  - `docs/phase5/phase5-5.4-network-error-handling.md`
  - `docs/phase5/phase5-5.5-http-cache-partitioning.md`
- Smoke artifacts:
  - `docs/artifacts/phase5/phase5-5.1/request-interception-result.json`
  - `docs/artifacts/phase5/phase5-5.2/connection-pool-isolation-result.json`
  - `docs/artifacts/phase5/phase5-5.3/predictive-prefetch-result.json`
  - `docs/artifacts/phase5/phase5-5.4/network-error-handling-result.json`
  - `docs/artifacts/phase5/phase5-5.4/scenarios/dns-failure-network-error-handling-result.json`
  - `docs/artifacts/phase5/phase5-5.4/scenarios/http-503-network-error-handling-result.json`
  - `docs/artifacts/phase5/phase5-5.5/http-cache-partitioning-result.json`
