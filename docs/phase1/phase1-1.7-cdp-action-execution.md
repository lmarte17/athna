# Phase 1.7: CDP Action Execution

This milestone maps Navigator action schema outputs to executable CDP commands.

## Command

```bash
npm run action:smoke
```

## What It Verifies

1. `CLICK` executes via `Input.dispatchMouseEvent`:
   - `mouseMoved` → `mousePressed` → `mouseReleased`
2. `TYPE` executes via `Input.dispatchKeyEvent`:
   - per-character `type: "char"`
   - special keys supported: `[Enter]`, `[Tab]`, `[Escape]`
3. `SCROLL` executes via `Input.dispatchMouseEvent` (`mouseWheel`) plus `Runtime.evaluate(window.scrollBy(...))`.
4. `WAIT` pauses execution and returns.
5. `EXTRACT` executes `Runtime.evaluate` and returns structured JSON data.
6. `DONE` and `FAILED` return completion/failure status without crashing orchestration.
7. Action executor waits for resulting navigation or DOM mutation before returning.

## Validation Target

`https://www.google.com/`

## Artifact

`docs/artifacts/phase1-1.7/google-action-execution.json`

## Latest Validation Snapshot

- Search flow executed with:
  - `CLICK` on search input
  - `TYPE` with `mechanical keyboards[Enter]`
  - `SCROLL` by `800`
  - `EXTRACT` returning `{title, url, query, scrollY}`
  - `DONE` status
- Extracted query: `mechanical keyboards`
- Final URL: Google search results page for mechanical keyboards

## Notes For Next Steps

- Action executor now directly consumes the same action shape produced by Phase 1.6.
- This is the core execution primitive for the full loop integration in Phase 1.8.
