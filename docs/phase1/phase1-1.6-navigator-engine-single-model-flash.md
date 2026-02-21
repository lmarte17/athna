# Phase 1.6: Navigator Engine (Flash Only)

This milestone implements the first Navigator Engine using Gemini Flash and a typed action schema.

## Command

```bash
npm run navigator:smoke
```

## What It Verifies

1. Uses Gemini Flash only for navigator decisions.
2. Navigator input includes:
   - user intent
   - interactive element index and normalized AX tree
   - optional previous actions/observations
3. Navigator output is parsed and schema-validated as:
   - `{action, target, text, confidence, reasoning}`
4. Malformed JSON responses are retried once before failing.

## Validation Target

`https://www.google.com/`

Intent: `search for mechanical keyboards`

## Artifact

`docs/artifacts/phase1-1.6/google-mechanical-keyboards-action.json`

## Latest Validation Snapshot

- `action`: `CLICK`
- `confidence`: `1.0`
- `target`: `{x: 567.685, y: 405}`
- `reasoning`: `Initial step for search, clicking on the main search input field.`

## Notes For Next Steps

- The output schema is aligned with the upcoming `1.7` CDP action executor mapping.
- The engine already accepts previous actions/observations, so it can be used in the `1.8` loop with minimal interface changes.
