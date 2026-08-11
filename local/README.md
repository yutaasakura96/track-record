# local/ — reference material, not committed

Everything in this directory except this file is gitignored. It is the author's real career
record, kept on disk so agents can see the workflow Track Record is replacing and the source
documents it must be able to produce.

## What lives here

| Path | What |
|---|---|
| `ENGLISH/` | English résumé (`.docx` + `.pdf`) and `career-story.md` |
| `JAPANESE/` | 履歴書, 職務経歴書, キャリアストーリー |
| `work-summary/` | Long-form per-employer evidence portfolios (~2.4 MB), LinkedIn profiles, master document |

## Why it is excluded

Three distinct kinds of sensitive content, only the first of which is the author's to disclose:

1. **Personal PII** — home address, phone number, date of birth (履歴書 requires all three).
2. **NDA-bound client material** — internal architecture, migration details and system
   inventories for named client organisations.
3. **Third-party data** — names of individuals at client and vendor companies, and internal
   network addresses.

## The rule that matters

Ignoring the directory protects the *files*. It does not protect their *contents*, and the
planning documents in `docs/` are written from this material. **Never copy specifics out of
`local/` into any committed file** — no addresses, no client names, no employee names, no
internal hostnames or IPs. Describe shape and structure instead: "a per-employer evidence
portfolio of roughly 6,000 lines" is committable; the client's name and its network layout
are not.

This constraint does not end at the repo boundary. Track Record will store this same material
in a database and, if deployed, serve it over the internet — so confidentiality is a product
requirement, not just a git setting. See `docs/00-kickoff.md`.
