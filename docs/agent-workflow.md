# Agent workflow: before you commit, before you push

Applies to Claude, Codex and people. The ticket flow itself is in `AGENTS.md`; this is the routine inside it.

## Before every commit (automatic)

Run `bash scripts/setup-hooks.sh` once per clone (`npm install` in `web/` does it too). The hook in `.githooks/pre-commit` then runs the CI checks for the areas you staged:

- `web/`: `format:check`, `typecheck`, `lint`, `test`
- `pipeline/`, `supabase/scripts/`: `python3 -m pytest pipeline/tests`
- docs-only commits are not checked.

Skip one commit with `git commit --no-verify` only for work in progress on your own branch. The checks must pass before you push. If `typecheck` fails with errors inside `web/.next`, delete that stale build folder.

The hook does not run the database, Playwright or preview checks. Those run in CI; run them locally when you change `supabase/` or the browser flows.

## Before every push

1. **Test first where it is cheap.** New logic and bug fixes: write the failing test, then the code (`tdd`). Guards and constraints: break them once on purpose to prove the test fails.
2. **Review your own diff** against the ticket's Definition of Done and the standards in `AGENTS.md` (`code-review`). Look for what a reviewer would flag: error paths, temporary failures treated as final ones, a missing test for new routes or middleware, docs not updated.
3. **Write the PR body** with the template in `.github/pull_request_template.md`: summary, evidence, and merge danger (one-way or two-way door, blast radius). A migration or an auth change is usually one-way or wide.

## Reviews

A review round is the slowest step, so answer a whole review in one push: fix every comment, run the full checks, reply on each thread, resolve it, then re-request review.

## Steps only a person can do

For a procedure that needs a person's browser or a secret (a token, a dashboard setting, a staging run), write a wizard script (`wizard` skill) instead of a long chat explanation. The first one is `scripts/wizard-muy16-staging-import-test.sh`. Secrets stay in the person's shell and are never written to a file or the ticket.

## Session retro (MUY-26 / MUY-16 / MUY-50, 2026-11-25)

| Finding | Category | Fix |
|---|---|---|
| Format, DB and missing-test failures reached CI and cost review rounds | Automated checks | Pre-commit hook (this PR) |
| The same reviewer found the same kind of gap twice (temporary Auth error treated as "no session", in two places) | Coding standards | "Review your own diff" step above; temporary failures must not be treated as final answers |
| Hosted steps waited on the person's terminal | Information access | Wizard script for the MUY-16 staging test |
| A stale `web/.next` build broke `typecheck` | Navigation | Noted above |
| `AGENTS.md` is already short (51 lines) | No-ops | Only a pointer to this file was added |
