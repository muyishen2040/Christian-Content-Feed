# Working agreement (shared by Claude and Codex)

This file is read by every AI tool and person working in the repo. Change it only through a reviewed PR.

Mu An Shen (GitHub `danielshenmuan`) and Samuel / Mu-Yi Shen (GitHub `muyishen2040`) build this together. Claude (Mu An's sessions) and Codex (Samuel's sessions) are implementers. Claude also acts as Mu An's engineering manager: it decides the next step, does the work, and reports, so Mu An does not have to ask for each step.

## How a ticket is handled

A Linear ticket is one unit of work.

1. **Start.** Read the ticket: description, Definition of Done (DoD), blockers. Set it to **In Progress**. Work on its own branch (the harness may fix the branch name; do not mix other tickets into it).
2. **Build.** Keep working and committing locally until every DoD item is met and the tests pass.
3. **Hand back.** Do **not push yet.** Tell Mu An: the DoD checklist with evidence, what changed, risks, open questions, and what Samuel should look at.
4. **Push.** When Mu An says to push, push the branch and open the PR (title starts with the ticket id; body has summary, how to verify, what is not included, ticket link). Request Samuel (`muyishen2040`) as reviewer unless Mu An says not to. Link the PR in the ticket and comment on it.
5. **Review.** Check the PR when asked and at standup. If changes are requested, fix and commit locally, tell Mu An, and push when told.
6. **Merge.** Once Samuel's review is **approved** and checks are green, merge the PR (Mu An has pre-authorized this), set the ticket to **Done** with a comment, and tell Mu An. If the review is not approved, checks fail or there are conflicts, do not merge: report instead.

Linear statuses here are Backlog, Todo, In Progress, Done (there is no "In Review").

## One owner per branch

Each branch is owned by one person or one AI session until it is merged. Do not push to a branch someone else owns. Send suggestions as a PR comment or on your own branch, and open a PR against the owner's branch if you need to change it.

## Reviewing Samuel's PRs

Read every changed file, check CI, run it if feasible, and give Mu An a verdict split into must-fix and track-later. Do not approve, request changes on, or merge Samuel's PRs unless Mu An says so in that conversation.

## Standup

When Mu An says "standup": list open PRs (owner, CI, review state), Mu An's tickets with status and blockers, what is waiting on whom, and the single next action for Mu An.

## Never without being told

Force-push or rewrite shared history; approve PRs; contact publishers; make the network unrestricted or handle secrets; publish content; delete anything.

## Content and safety rules

- Link-out model: store title, source, original URL, our own summary and tags. Never store article body text or author names, and never log raw personal descriptions.
- A testimony is a first-person story about God's work in the writer's life. Reject sermons, news and announcements, anything crisis-adjacent (route to human review), and sources from 真耶穌教會 or 全能神.
- Public availability or a permissive robots.txt is not permission. Rights stay `pending` until a person decides. Respect robots.txt rules that block AI crawlers.
- Prefer text pages with their own URL. Check each candidate for crisis keywords before using it.

## Commands

- Python tests: `python -m pytest pipeline/tests` (see `docs/setup.md` for web checks).
- Keep the cloud environment's network on Limited with exact hosts; add every site needed in one change.
