# Issue tracker: Linear

Issues and specs for this repo live as Linear tickets in team **MUY** (workspace team "Muyishen4020"). Use the Linear MCP tools (`mcp__<linear>__list_issues`, `get_issue`, `save_issue`, `save_comment`, `list_comments`, `list_issue_labels`). The ticket flow (statuses, handoff comments, pushing, merging) is defined in `AGENTS.md`; follow it.

## Conventions

- **Create an issue**: `save_issue` with `team: "MUY"`, a title and a markdown description (use real newlines). First `list_issues` with a `query` to check for duplicates.
- **Read an issue**: `get_issue` with the identifier (e.g. `MUY-38`), then `list_comments` for the discussion (`get_issue` does not include comments).
- **List issues**: `list_issues` with `team`, `state`, `label`, `assignee` filters; follow `cursor` while `hasNextPage` is true.
- **Comment on an issue**: `save_comment` with the issue id and a body.
- **Apply / remove labels**: `save_issue` with `id` and `labels`. The `labels` parameter replaces the whole set, so pass the existing labels plus the change.
- **Change status**: `save_issue` with `id` and `state`. Statuses are Backlog, Todo, In Progress and Done (no "In Review").
- **Close**: set the state to Done and add a comment.
- **Sub-issues / parents**: `save_issue` with `parentId`.
- **Blocking**: use Linear's issue relations (`blockedBy` / `blocks` on `save_issue`).

Ticket identifiers look like `MUY-<n>`. PR titles start with the ticket id.

## Pull requests as a triage surface

**PRs as a request surface: no.** PRs are code review only; requests are tracked as Linear tickets.

## When a skill says "publish to the issue tracker"

Create a Linear issue in team `MUY` with `save_issue`.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. Create the label first if missing.
- **Child ticket**: an issue with `parentId` set to the map. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, assign it to the driving dev.
- **Blocking**: Linear issue relations (`blockedBy`). A ticket is unblocked when every blocker is Done.
- **Frontier query**: list the map's children that are not Done, drop any with an unfinished blocker or an assignee; first in map order wins.
- **Claim**: assign the ticket to `me` and set it to In Progress, the session's first write.
- **Resolve**: `save_comment` with the answer, set the state to Done, then append a context pointer (gist + link) to the map's Decisions-so-far.
