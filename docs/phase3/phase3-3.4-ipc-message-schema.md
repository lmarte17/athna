# Phase 3.4: IPC Message Schema

This milestone adds a typed IPC message contract between Ghost Tabs and the orchestration layer, including strict boundary validation and typed command routing.

## Command

```bash
npm run ipc:schema:smoke
```

## What It Verifies

1. Typed message schema exists for all required message types:
   - `NAVIGATE`
   - `SCREENSHOT`
   - `AX_TREE`
   - `INJECT_JS`
   - `INPUT_EVENT`
   - `TASK_RESULT`
   - `TASK_ERROR`
   - `TASK_STATUS`
2. Both inbound and outbound boundaries validate message envelopes and payload shapes.
3. Malformed messages are rejected with structured validation details.
4. Request messages are routed by typed message kind (switch on `type`), not string parsing.
5. Routing failures are converted into `TASK_ERROR` payloads with structured error objects.

## Artifacts

- `docs/artifacts/phase3/phase3-3.4/ipc-message-schema-result.json`

## Notes For Next Steps

- Phase 3.5 queue/scheduler can emit the same typed envelope to the status feed without adding ad hoc payloads.
- Phase 6.3 task status feed can consume `TASK_RESULT` / `TASK_ERROR` and state updates through a single typed channel.
- Phase 3.7 crash recovery can return crash diagnostics through the same `TASK_ERROR` shape.
