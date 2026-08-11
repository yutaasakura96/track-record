# Track Record — kickoff context

Scaffolding for the planning session. Delete once `01-project-brief.md` and
`02-product-requirements.md` exist — they supersede this.

---

## What Track Record is

A **web application** that replaces a hand-run document workflow.

`local/` holds the real career record in three layers. It is **gitignored** — see `local/README.md`
and `CLAUDE.md`. Read it, never quote specifics from it into a committed file.

| Layer | Files | Role |
|---|---|---|
| Evidence | `local/work-summary/` (~2.4 MB) | Long-form per-employer portfolios — TierLine, HCLTech/Nissan, Sogo & Seibu — plus LinkedIn profiles and a stale master document. Hand-maintained. Source of truth today. |
| Renders | `local/ENGLISH/resume-yutaasakura.docx`+`.pdf`, `local/JAPANESE/履歴書.docx`, `local/JAPANESE/職務経歴書.docx` | Derived by prompting Claude Code against the evidence layer. |
| Narrative | `local/ENGLISH/career-story.md`, `local/JAPANESE/キャリアストーリー.md` | Interview prep. Same story in two languages, chapter-parallel, each ending in an anchor-facts table and a question→chapter routing map. Hand-authored. |

## The current workflow

```
task or achievement happens
  → update the work-summary files by hand
  → prompt AI to study the work-summary files
  → ask AI to update the résumés and stories
```

## The three problems, as stated

1. Keeping a source of truth
2. Updating résumés constantly
3. Capturing highlights, achievements and information as they happen

## Diagnosis agreed in session

The loop's **shape** is right; its **cost** is in the wrong place.

Every render re-reads 2.4 MB of prose and re-extracts the same facts from scratch. Three
consequences, all currently being lived with:

- Each update is slow, so updates get batched instead of running per achievement.
- Output isn't repeatable — the same request twice produces two different résumés.
- Updates are wholesale rewrites, not reviewable diffs, so prior hand-tuning is lost each pass.

**The expensive part is re-reading, not writing.**

Hypothesis to interrogate during planning, not a decision: a structured record layer sits between
the evidence and the renders. Work summaries stay as they are — they are good, and they are the
proof. On top sits a compact record of *facts*, each pointing back at the section that proves it.
Renders read that layer instead of the raw corpus, becoming fast, repeatable and diff-able.

Corollary worth carrying into Phase 4: **the existing renders are a fixed contract.** The English
résumé, 履歴書, 職務経歴書 and the two career stories dictate every field the record layer must
carry. 履歴書 in particular has a conventional format that is not negotiable.

## Answered in session

**Q: only for the author, or for other users?** → A serious side project, built for the author
first, with the possibility of becoming a product later. Not a weekend hack, not a product today.

The operational form of that answer, and a Phase 1 decision-log entry: **build for one user, but do
not foreclose multi-user.** No multi-tenancy, roles, or settings surfaces now — but no schema
decision that assumes exactly one person exists either. This line is what keeps speculative
complexity out.

Consequence for naming and positioning: the likely product wedge is **bilingual**. Very little on
the market handles 履歴書 and 職務経歴書 properly alongside Western résumés.

**Name:** **Track Record** — repo `track-record`, chosen 2026-08-11, replacing `career-ledger`.
Rejected: Dossier, Provenance, Throughline, Rireki (履歴), Ashiba (足場). Naming principle agreed:
*name the record, not the output* — the résumé is one render out of five, so a résumé-derived name
locks the product to its least interesting layer. **Domain, npm and GitHub handle availability is
unverified** — check before any public use, since "track record" is a common phrase.

## Open questions for the brief and PRD

- Do résumés become strict renders, or stay hand-tunable per application with the system feeding
  them?
- Are the interview stories generated the same way, or hand-authored with the system supplying and
  checking facts only? *(Recommendation on record: keep them hand-authored. They are the strongest
  artifacts in the repo precisely because they admit failures a generator would never volunteer.)*
- Does capture stay manual, get prompted, or pull from git and tickets? Note the evidence harvests
  unevenly: the recent internal platform build is git-shaped and harvests well; the enterprise
  migration runbook, the vendor negotiation and the firewall diagnosis left almost no commits — and
  that is the strongest material.
- Scope: the four documents only, or also LinkedIn, the portfolio site, the master document?
- Confidentiality — the corpus mixes personal PII (home address, phone, DOB), NDA-bound client
  material, and names of individuals at client and vendor companies. Only the first is the author's
  to disclose. On a deployed web app this is a first-class product requirement — probably per-record
  confidentiality tiers, and a rule about what a render is allowed to include. Not a footnote.
- Is consistency checking in scope? Deprioritised in session ("the drift doesn't matter"), so treat
  it as a possible side effect of the design rather than a goal. Known drift is catalogued in
  `local/work-summary/HCL/PORTFOLIO-EDITOR-NOTES.md`.

## Process

Following `/Users/yutaasakura/Documents/GitHub/claude-setup-inventory/project-planning-template.md`.

Full five phases — this is a web app, so Phase 2 (Claude Design) and Phase 3 (extract) both apply.
Tier 2 documents expected to trigger: 07 (API), 08 (auth), 09 (user flows), 10 (screen specs),
11 (testing), 12 (deployment), and probably 13 (infra/security, because of the confidentiality
constraint above).

**Document ownership — decide once, up front.** The planning template owns the output structure
(`docs/01`–`06` and triggered Tier 2 files). `mattpocock/skills` supplies the interview *engine*
only. Do not let `/grill-with-docs` spawn a competing `CONTEXT.md`/ADR document set alongside the
template's — pick which is authoritative before running it.

Use `/grill-me` for Phase 1 (product thinking, non-code) and `/grill-with-docs` from Phase 4 on
(engineering, and it writes ADRs inline).

## Setup state

- `mattpocock-skills` installed via `claude plugins install` on 2026-08-11.
- Chosen as the two-week trial named in `claude-agentic-setup.md` Appendix D, still-open item 2.
- `superpowers` deliberately left disabled — Appendix D disabled it the same day, and the gates
  flagged as possibly worth restoring were TDD and systematic-debugging, not brainstorming.
- **Still to run:** `/setup-matt-pocock-skills`. Choose **local files** as the tracker — Backlog
  (Nulab) is not supported, per Appendix E.
- `.claude/settings.json` created, enabling the pack for this repo only. The marketplace install
  set it `true` at *user* scope; that was flipped to `false` in `~/.claude/settings.json` so the
  trial stays scoped here, per the catalog's thin-floor principle.
- Repo: https://github.com/yutaasakura96/track-record — **public**. Branches: `main` (production,
  GitHub default) and `develop` (working). Day-to-day work happens on `develop`.
- Because the repo is public, the `CLAUDE.md` rule about never quoting `local/` specifics into a
  committed file is load-bearing rather than advisory. A leak here is indexed, cloned and archived,
  not quietly deleted.
- Run `/new-project` *after* planning, per the README's two-halves note — there is no stack to
  detect until the docs state one.
