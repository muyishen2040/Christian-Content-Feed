# Working agreement (shared by Claude and Codex)

This file is read by every AI tool and person working in the repo. Change it only through a reviewed PR.

Mu An Shen (GitHub `danielshenmuan`) and Samuel / Mu-Yi Shen (GitHub `muyishen2040`) build this together. Each works with their own AI agent (Claude for Mu An, Codex for Samuel).

- The **task owner** is the person who assigned the work, usually the ticket's assignee. The agent reports to the task owner.
- The **reviewer** is the other person, who reviews the PR when needed.
- The agent decides the next step, does the work and reports, so the task owner does not have to ask for each step.

## How a ticket is handled

A Linear ticket is one unit of work.

1. **Start.** Read the ticket: description, Definition of Done (DoD), blockers. Set it to **In Progress**. Work on its own branch (the harness may fix the branch name; do not mix other tickets into it).
2. **Build.** Keep working and committing locally until the implementation and its tests are complete and passing, and every DoD item that can be met before a PR is met. DoD items about PR review or merge (for example "a reviewed PR") are met in steps 4 to 6, not here. Do not open the PR before the work and tests are complete.
3. **Hand back.** Do **not push yet.** Tell the task owner: the DoD checklist with evidence (marking which items wait on PR review or merge), what changed, risks, open questions, and what the reviewer should look at.
4. **Push.** When the task owner says to push, push the branch and open the PR (title starts with the ticket id; body has summary, how to verify, what is not included, ticket link). Request the other person as reviewer (`muyishen2040` for Mu An's tasks, `danielshenmuan` for Samuel's) unless the task owner says not to. Link the PR in the ticket and comment on it.
5. **Review.** Check the PR when asked and at standup. If the reviewer requests changes, fix them, commit and push to the PR branch, reply on the reviewer's comments, re-request review and tell the task owner. Pushing review fixes needs no extra word from the task owner, and the branch-ownership rule below still applies.
6. **Merge.** Merge only where the task owner has authorized it (authorized for Mu An's tasks; Samuel decides for Samuel's tasks). Once the reviewer's review is **approved** and checks are green, merge the PR, set the ticket to **Done** with a comment, and tell the task owner. If the review is not approved, checks fail or there are conflicts, do not merge: report instead.

Linear statuses here are Backlog, Todo, In Progress, Done (there is no "In Review").

## One owner per branch

Each branch is owned by one person or one AI session until it is merged. Do not push to a branch someone else owns. Send suggestions as a PR comment or on your own branch, and open a PR against the owner's branch if you need to change it.

## Reviewing the other person's PRs

When asked to review a PR written by the other person (or their agent), read every changed file, check CI, run it if feasible, and give the person who asked a verdict split into must-fix and track-later. Do not approve, request changes on, or merge it unless that person says so in that conversation.

## Standup

When the task owner says "standup": list open PRs (owner, CI, review state), their tickets with status and blockers, what is waiting on whom, and the single next action for them.

## Never without being told

Force-push or rewrite shared history; approve PRs; contact publishers; make the network unrestricted or handle secrets; publish content; delete anything.

## Content and safety rules

- Store original testimony text when the rights holder has permitted storage for the intended use. Preserve source attribution and the original URL; do not create separate author-name fields unless separately authorized and needed. Review any names or other personal details present in raw text, and keep it out of public fixtures and logs. Never log raw personal descriptions.
- Keep original extracted text unchanged for review. Do not overwrite it with OCR corrections or formatted text; separate raw and processed storage requires a schema and pipeline change. The current `testimonies.body` column is private and does not make full text available to the app.
- A testimony is a first-person story about God's work in the writer's life. Reject sermons, news and announcements, anything crisis-adjacent (route to human review), and sources from 真耶穌教會 or 全能神.
- Public availability or a permissive robots.txt is not permission. Rights stay `pending` until a person decides. Respect robots.txt rules that block AI crawlers.
- Prefer text pages with their own URL. Check each candidate for crisis keywords before using it.

## Commands

- Python tests: `python -m pytest pipeline/tests` (see `docs/setup.md` for web checks).
- Keep the cloud environment's network on Limited with exact hosts; add every site needed in one change.
