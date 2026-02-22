# Phase 5.3: Predictive Prefetch

This milestone introduces a predictive prefetch path in the orchestration layer:

- `GhostTabCdpClient.prefetch(url)` performs a non-navigation HEAD fetch from the Ghost Tab context to warm DNS/TCP/TLS and request path state.
- The loop orchestrator launches prefetch for `CLICK` actions before action execution using candidate URL extraction from DOM link target or action text URL.
- Loop-triggered prefetches use non-blocking dispatch mode so navigation and next-step inference are not stalled waiting for HEAD completion.
- Prefetch telemetry is persisted in task results (`prefetches[]`) and per-step history fields.

## Command

```bash
npm run prefetch:smoke
```

The smoke run uses a real Electron CDP host and a local keep-alive fixture server with deterministic first-request latency.

## What It Verifies

1. Prefetch API does not navigate the active page:
   - URL before and after `prefetch(url)` remains unchanged.
2. Prefetch reduces navigation TTFB on predicted target URLs:
   - median TTFB reduction is validated against a 150-300ms bound on fixture runs.
3. Prefetch path avoids full-page loads before navigation:
   - prefetch is issued as a non-navigation request path and measured independently from `Page.navigate`.
4. Orchestrator loop emits prefetch telemetry:
   - loop result contains `prefetches[]` with click-prefetch event(s).
   - step history records `prefetchCandidateUrl`, `prefetchStatus`, `prefetchReason`, and `prefetchDurationMs`.

## Artifacts

- `docs/artifacts/phase5/phase5-5.3/predictive-prefetch-result.json`

## Notes For Next Steps

- Phase 5.4 can route retryable network failures into prefetch-aware fallback logic.
- Phase 10.2 can benchmark prefetch impact on external sites and compare with this deterministic harness baseline.
