# Phase 5.4: Network Error Handling (Structured)

This milestone extends orchestration-side network handling so Ghost Tabs route structured network failures to the Navigator instead of treating browser error pages as normal content.

- Navigation failures now classify network `errorType` values (for example `DNS_FAILURE`, `CONNECTION_TIMEOUT`, `TLS_ERROR`, `HTTP_4XX`, `HTTP_5XX`).
- Structured error objects now include `errorType` alongside `{type,status,url,message,retryable}`.
- The Perception-Action loop forwards these structured network errors to the Navigator decision path before any perception screenshot flow.

## Command

```bash
npm run network-error:smoke
```

The smoke run uses a real Electron CDP host, a local HTTP fixture for 503 responses, and a deterministic DNS-failure scenario on `.invalid`.

## What It Verifies

1. DNS failure is structured at orchestration layer:
   - `status=null`, `retryable=true`, `errorType=DNS_FAILURE`.
2. HTTP 503 is structured at orchestration layer:
   - `status=503`, `retryable=true`, `errorType=HTTP_5XX`.
3. Network failures route to Navigator without Tier 2 screenshot escalation:
   - `structuredErrors[]` contains navigation-source network events.
   - `tier2Calls=0` for the network-failure scenarios.
   - Navigator receives structured error context with no screenshot payload.

## Artifacts

- Suite summary:
  - `docs/artifacts/phase5/phase5-5.4/network-error-handling-result.json`
- Per-scenario detail:
  - `docs/artifacts/phase5/phase5-5.4/scenarios/<scenario>-network-error-handling-result.json`

## Notes For Next Steps

- Phase 5.5 can apply cache policy overrides that react to retryable network error types.
- Phase 10 can track network-error-type frequencies for reliability tuning.
