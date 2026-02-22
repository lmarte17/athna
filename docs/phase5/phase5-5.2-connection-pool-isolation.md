# Phase 5.2: Connection Pool Isolation

This milestone validates that Ghost Tab BrowserContexts do not share TCP connections when talking to the same origin.

Validation is done with two concurrent Ghost Tab contexts and a local HTTP keep-alive harness.

## Command

```bash
npm run connection-pool:smoke
```

The smoke run uses a real Electron CDP host, real pool manager leases, and a local fixture server (no mocks).

## What It Verifies

1. Distinct Ghost Tabs are assigned distinct BrowserContexts:
   - two acquired leases use different `contextId` values.
2. Requests from each context are observed on separate server-side TCP sockets:
   - server request logs are grouped by `contextId` and `socketId`.
   - no socket id appears in both context groups.
3. Intra-context keep-alive reuse can still occur:
   - at least one context reuses a socket for multiple requests.
4. CDP Network domain captures per-context connection metadata:
   - each context records non-empty `Network.responseReceived` traces.
   - connection ids are reported per context for inspection.
5. Pool remains healthy after probe completion:
   - final pool snapshot/telemetry are emitted in artifact output.

## Artifacts

- `docs/artifacts/phase5/phase5-5.2/connection-pool-isolation-result.json`

## Notes For Next Steps

- Phase 5.3 can use per-context connection behavior to tune prefetch placement and avoid cross-context assumptions.
- Phase 5.4 can extend this harness to include connection error paths (DNS/TLS/timeout) while preserving context isolation assertions.
