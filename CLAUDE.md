# Track Record

A web application that turns a hand-maintained career record into a structured source of truth
with derived renders (résumé, 履歴書, 職務経歴書, interview stories).

Currently in Phase 1 planning. See `docs/00-kickoff.md` for context and open questions, and
`/Users/yutaasakura/Documents/GitHub/claude-setup-inventory/project-planning-template.md` for
the process. There is no code yet — this file will be rewritten by `/new-project` once the
planning documents state a stack.

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
