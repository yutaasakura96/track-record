# Track Record

A web application that turns a hand-maintained career record into a structured source of truth
with derived renders (résumé, 履歴書, 職務経歴書, interview stories).

**Phase 1 is complete.** Read `docs/01-project-brief.md` and `docs/02-product-requirements.md`
first — they define what this is and what it does. `docs/06-decision-log.md` answers "why is it
like this?" and is append-only. `docs/00-kickoff.md` was the pre-planning scaffold and has been
deleted; it is superseded by 01 and 02 and survives only in git history.

Phase 2 (design exploration in Claude Design) is next. There is no code yet — this file will be
rewritten by `/new-project` once the planning documents state a stack.

**Document ownership — do not violate this.**
`/Users/yutaasakura/Documents/GitHub/claude-setup-inventory/project-planning-template.md` owns the
structure of `docs/01`–`06` and any Tier 2 files it triggers. The `mattpocock-skills` pack supplies
the interview *engine* only; anything it generates (specs, `CONTEXT.md`, ADRs) belongs under
`docs/specs/`, never at `docs/` root. Do not let a second, competing document set grow alongside
the planning template's.

## Agent skills

### Issue tracker

Issues live as GitHub issues in this repo, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## local/ — read it, never quote it

`local/` holds the author's real career documents. It is gitignored and must stay that way.
Read it freely: understanding the current workflow and the render formats is the point of
having it here.

**Do not copy specifics out of it into any committed file** — `docs/`, code, tests, fixtures,
commit messages or PR descriptions. It contains the author's home address, phone number and
date of birth; NDA-bound client material; names of individuals at client and vendor companies;
and internal network addresses.

Describe structure, not content. "The 職務経歴書 lists each employer with a business-description
paragraph and bulleted technical outcomes" is committable. The employer's internal system
inventory is not.

Test fixtures and seed data must be invented, never sampled from `local/`.
