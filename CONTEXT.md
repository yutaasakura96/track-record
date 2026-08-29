# Track Record

A structured, provenance-tracked record of one career, built from imported long-form work
documents, from which every career document is generated — English résumé, 履歴書, 職務経歴書, and a
bilingual pair of interview stories.

This file is a glossary and nothing else. It carries no implementation detail; `docs/03` and
`docs/04` own that.

## The record

**The Record**:
All seven entity types together — Profile, Employer, Role, Project, Fact, Education, Certification.
Not a synonym for the facts alone.
_Avoid_: "enters the record" as a way of saying a review gate was passed — say **is accepted**.

**Fact**:
One claim about the author's work, carrying Provenance, Disclosure and Evidence. The core object;
the only entity that arrives through the import path rather than a form.

## Evidence and worth

**Provenance**:
How much a claim is worth — one of Measured, Attested or Generated. A Postgres enum on every fact,
never optional. Anything a model produces starts Generated, and Generated never reaches a render.
_Avoid_: using this word for the pointer to the source passage — that is Evidence.

**Evidence**:
The link from a fact to the passage that proves it — a source document version, the verbatim quote,
and its offsets into that version's text. Every accepted fact has one.
_Avoid_: Provenance, citation, reference.

**Disclosure**:
What may be said and to whom — one of Public, Restricted or Private. Independent of Provenance and
equally non-optional. Private never reaches a render.
_Avoid_: Confidentiality, sensitivity, classification.

## Awaiting review

**Candidate**:
A fact the import extracted but the author has not yet ruled on. Reviewed **one at a time** —
accepted, edited then accepted, or rejected.
_Avoid_: proposed fact, suggested fact, draft fact.

**Render Proposal**:
A generated render the author has not yet ruled on. Reviewed **wholesale** as a diff against the
current version — accepted or rejected in one action. Never a version.
_Avoid_: candidate render, draft render.

**Propose**:
Reserved for renders. The import does not propose — it **extracts candidates**.
