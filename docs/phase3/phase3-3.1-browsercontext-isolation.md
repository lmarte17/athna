# Phase 3.1: BrowserContext Isolation

This milestone introduces isolated Ghost Tab BrowserContexts in Electron and validates storage/cache separation across concurrent contexts.

## Command

```bash
npm run context:smoke
```

## What It Verifies

1. Electron creates each Ghost Tab with a unique partition-backed BrowserContext (`session.fromPartition`).
2. Concurrent contexts on the same origin keep independent:
   - cookies
   - localStorage
   - sessionStorage
   - IndexedDB
3. HTTP cache is partitioned per context:
   - a cacheable script hit is reused inside one context
   - the same script is fetched again on first navigation from another context
4. Context destruction clears partition storage and cache.
5. Destroying one context does not impact an active sibling context.
6. Auto-replenished context reusing the same context id starts with clean browser storage.

## Artifacts

- `docs/artifacts/phase3/phase3-3.1/browsercontext-isolation-result.json`

## Notes For Next Steps

- Phase 3.2 can build pool allocation on top of the context-id lifecycle added here.
- Phase 5.2 can reuse this partition model for connection-pool isolation validation.
- Phase 8.1 and 11.2 can extend the same harness pattern for deeper lifecycle enforcement tests.
