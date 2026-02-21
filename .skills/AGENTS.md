# AGENTS.md

## Scope

This file applies to `/Users/lmarte/Documents/Projects/athna/.skills` and all subdirectories.

## Purpose

The `.skills/` directory stores repository-local Codex skills that make repetitive workflows faster and more reliable.

## Skills Rules

1. Every skill directory must include a `SKILL.md` with YAML frontmatter containing `name` and `description`.
2. Keep skill instructions concise and procedural; move executable workflows into `scripts/` when deterministic execution is important.
3. Any script added under a skill must be runnable from the repository root and include a `--help` usage path.
4. When adding a new skill directory, include supporting guidance for artifact verification if the skill produces evidence files.
