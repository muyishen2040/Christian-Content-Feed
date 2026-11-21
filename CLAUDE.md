@AGENTS.md

## Claude-specific

- Follow the ticket flow in AGENTS.md exactly: build and commit locally, hand back, and make the first push only when the task owner says so. Review fixes on an open PR are pushed without waiting.
- Post a Linear comment on the ticket at every handoff, so any session can resume.
- The allow and deny rules for tools are in `.claude/settings.json`.

## Agent skills

### Issue tracker

Issues are Linear tickets in team `MUY` (Linear MCP tools; ticket flow in AGENTS.md). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), created as Linear labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
