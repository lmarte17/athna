# Phase 4.4: Observation Cache

This milestone adds in-task observation caching to avoid repeated perception and inference work on stable pages:

- Cache key scope is task-session local and URL-based.
- Cached perception includes AX-derived element index, normalized tree encoding, AX deficiency signals, scroll snapshot, and AX tree hash.
- Cached decisions are keyed by inference tier and escalation reason to skip repeated model calls when page state is stable.
- Tier 2 screenshot payload is cached per URL to reduce repeat image capture.
- Default cache TTL is 60 seconds (`observationCacheTtlMs` override available on loop/task input).

## Command

```bash
npm run observation-cache:smoke
```

The smoke run uses a real Electron CDP host, real Navigator engine, and a local fixture page (no stubs/mocks).

## What It Verifies

1. Within-task cache reuse occurs on same-URL stable steps:
   - `history[].observationCachePerceptionHit=true` appears after the first step.
   - cache-hit steps also report `axTreeRefetched=false`.
2. Re-inference is skipped when decision cache is warm:
   - `history[].observationCacheDecisionHit=true` appears.
   - navigator inference call count is lower than total loop steps for the validated scenario.
3. Cache is task-session scoped:
   - running a second task against the same URL starts with cache miss (`history[0].observationCachePerceptionHit=false` and `observationCacheDecisionHit=false`).
4. TTL wiring is applied:
   - `result.observationCache.ttlMs=60000` by default.

## Artifacts

- Suite summary:
  - `docs/artifacts/phase4/phase4-4.4/observation-cache-result.json`
- Per-scenario detail:
  - `docs/artifacts/phase4/phase4-4.4/scenarios/within-task-cache-reuse-observation-cache-result.json`
  - `docs/artifacts/phase4/phase4-4.4/scenarios/task-session-cache-reset-observation-cache-result.json`

## Notes For Next Steps

- Phase 5.5 can layer HTTP cache partition controls with per-session observation-cache policy overrides.
- Future iteration can add cache-key enrichment (for example viewport bucket + lightweight DOM signature) where URL-only reuse is too coarse.
