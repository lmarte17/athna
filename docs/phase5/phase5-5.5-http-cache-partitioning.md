# Phase 5.5: HTTP Cache Partitioning

This milestone formalizes per-session HTTP cache policy control in orchestration while preserving BrowserContext cache isolation.

- Each Ghost Tab still uses its own Chromium partition cache.
- The CDP client now exposes session policy control:
  - `RESPECT_HEADERS`: default browser cache behavior.
  - `FORCE_REFRESH`: bypass cache on every navigation.
  - `OVERRIDE_TTL`: use cache within a session TTL window, then force a fresh fetch.
- The Perception-Action loop accepts `httpCachePolicy` at loop/task level, so orchestration can set cache behavior per task session.

## Command

```bash
npm run http-cache:smoke
```

The smoke run uses a real Electron CDP host, two real BrowserContexts, and a local HTTP fixture server (no stubs or mock data).

## What It Verifies

1. Repeat visits reuse cached resources within a session:
   - second navigation in `RESPECT_HEADERS` does not re-request a cacheable script.
2. Cache override can force fresh fetches:
   - `FORCE_REFRESH` causes the same resource to be fetched on each navigation.
3. TTL override is honored per session:
   - `OVERRIDE_TTL` keeps cached responses within TTL.
   - after TTL expiry, next navigation forces a fresh fetch.
4. BrowserContext partition isolation is preserved:
   - the same resource URL fetched in a second context is a cache miss on first visit.
   - second visit in that second context uses its own cache.

## Artifacts

- `docs/artifacts/phase5/phase5-5.5/http-cache-partitioning-result.json`

## Runtime Toggles

- `GHOST_HTTP_CACHE_MODE` (`RESPECT_HEADERS`, `FORCE_REFRESH`, `OVERRIDE_TTL`)
- `GHOST_HTTP_CACHE_TTL_MS` (used when mode is `OVERRIDE_TTL`)

## Notes For Next Steps

- Phase 6+ can tune task-level cache policy profiles by workflow type (time-sensitive dashboards vs static reference pages).
- Production telemetry can correlate policy mode with latency and structured network error rates.
