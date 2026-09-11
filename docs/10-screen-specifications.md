# 10 — Screen Specifications

**Status:** Phase 3 · written 2026-08-12 · Screen 5 (version history) added 2026-09-12
**Visual reference:** `design/prototype/` — `fact-review.dc.html`, `diff-review.dc.html`,
`diff-review-ja.dc.html`, `overview.dc.html`. The prototype shows the target look; **this document
and `05-design-system.md` are the contract.** Where they disagree, the docs win.

Three screens carry v1. All values referenced here are defined in `05-design-system.md`.

---

## Shared chrome

**Sidebar** — 212px, `surface`, right border `border`. App mark + wordmark at 46px height. Nav
rows: Home, Facts, Documents, Imports, Settings, each with an optional right-aligned mono count.
Active row: `bg hover`, `color text`, weight 500. Footer: 22px circular avatar, name, and the
literal label `Personal record` — the single-user posture stated in the interface.

**Header** — 46px, `surface`, bottom border `border`. Screen title at 12.5px/600, contextual note
in `text-dimmer`, actions right-aligned.

The fact-review and diff-review screens replace the sidebar with a breadcrumb in the header
(`Imports / <document>`, `Outputs / <render>`) — they are focused, full-width tasks, not
navigation destinations.

---

## Screen 1 — Fact Review

**Purpose.** Turn one imported document into accepted facts. The most-used screen in the product
and the one M1 is judged on.

**Interaction model:** Grammarly's editor — highlighted spans in a document, one card per span in a
right rail, decided one at a time.

### Layout

| Region | Spec |
|---|---|
| Header (46px) | Breadcrumb `Imports / <project> · <filename>` (filename in a mono chip) · right: `N of M reviewed` + 96×4px progress bar + **Finish review** (primary; secondary-styled until all facts are resolved) |
| Source pane (flex) | 34px label strip: `Source document · N words · imported <relative time>` · right `N passages marked`. Below: the document, 740px measure, centred, `text-body` |
| Fact rail (412px) | Fixed right column, `surface`, left border `border`. Header + scrolling card list + summary footer |

### Source pane

Each extracted fact marks a span in place. Border style carries meaning and must not be restyled:
**solid** = normal · **dashed** = Generated · **dotted** = Private · **strikethrough** = rejected ·
green underline = accepted.

Clicking a mark selects its card and scrolls the rail to it. Selecting a card scrolls the document
so the mark sits ~34% from the top. Both directions are required.

### Fact rail

**Header:** `Candidate facts` + mono `N extracted`. One line of explanatory copy. Filter pills:
`All N` · `Open N` · `Resolved N`.

**Card, open state:**
1. Line-reference chip (mono, e.g. `L79`) — the evidence pointer into the source
2. Status badge when applicable — `DRAFT · NOT USABLE` (Generated, dashed amber) or `PRIVATE · NEVER SHARED` (locked grey)
3. Claim text — inline editable, commits on blur. Generated claims render *italic* in `#a9a290`
4. Warning block for Generated: *"Inferred by the importer — this number is not stated in the source. Promote it to Attested or Measured before it can be accepted."*
5. `Provenance` segmented control — Measured / Attested / Generated
6. `Disclosure` segmented control — Public / Restricted / Private
7. Explanatory footnote for Private: what it means, in one sentence
8. Actions — `Reject` (ghost, left) · optional hint · `Accept` (primary, right)

**Card, resolved state:** collapses to icon + claim + mono `ACCEPTED · MEASURED · PUBLIC` meta line
+ `Undo`. Accepted at `.78` opacity, rejected at `.5` with strikethrough.

**Card treatments:** Generated cards use a dashed amber border and a 135° hatch background. Private
cards use `card-recessed` with a large low-opacity padlock watermark at bottom-right. Selected cards
use the lifted elevation with a tone-matched ring.

**Footer:** legend — `N shareable` (green) · `N private` (grey) · `N need promotion` (amber). Then a
full-width primary button: `Add N facts to record`, disabled reading `Nothing accepted yet` at zero.

### Rules

- **A Generated fact can be accepted.** It is accepted, flagged, and excluded at render time. The prototype blocks acceptance outright; that is wrong — see the decision log entry of 2026-08-12. Accept must remain enabled, with the card clearly marked as not renderable.
- **Private facts are accepted normally.** The accept button reads `Accept · private`.
- **No confidence score.** The prototype shows `p 0.96`; it is cut.
- Re-importing an updated document must not re-surface facts already accepted or rejected.

### States

| State | Behaviour |
|---|---|
| **Loading (extracting)** | Document renders immediately; rail shows skeleton cards with the progress bar active. Extraction is visibly incremental |
| **Zero facts extracted** | Rail shows a failure, not an empty success: *"No facts could be extracted from this document."* Actions: retry, or capture manually. Document is retained |
| **Extraction failed** | Same shape, with the reason. The import is not discarded |
| **All resolved** | `Finish review` becomes primary. Rail shows the summary |

---

## Screen 2 — Diff Review

**Purpose.** Decide whether a regenerated document replaces the current one. The gate that makes
generation safe.

**Interaction model:** GitHub split-view review, at a fraction of the density.

### Layout

| Region | Spec |
|---|---|
| Header (46px) | Breadcrumb `Outputs / <render name>` + mono `proposed v<n>` chip · right: regeneration reason (`Regenerated after N new facts entered your record`) + **Version history** (ghost) |
| Toolbar (38px) | `N additions` (green dot) · `N removals` (red dot) · section summary · right: `Change N of M` + prev/next icon buttons |
| Split body | Two equal columns with a 1px centre rule. Sticky column headers: **Current** + mono `v4` + saved date; **Proposed** + accent `v5 draft` chip + generated timestamp |
| Rationale bar | Above the footer. Dot in the change's tone + the provenance of the selected change |
| Footer | Consequence copy + `Keep current version` (secondary) + `Accept proposed version` (primary) |

### Diff rendering

- **Word-level**, never line-level or character-level. Marks sit on phrase spans inside sentences.
- Unchanged content renders identically in both columns at full opacity — this is a document being read, not a patch being applied.
- An addition with no counterpart shows `no matching line` in the opposite column, on a hatched empty cell; a removal shows `removed`.
- Changed rows carry a 5%-opacity tone tint; the marks themselves carry 11% idle / 26% selected.
- Clicking any mark selects that change and updates the rationale bar. Prev/next cycles in document order.

### The rationale bar — required, not decorative

Every change states where it came from. This is PRD S6 (traceability) at the point of decision:

- `From 2 measured facts · <source>, L63 and L79`
- `From 1 attested fact · <source>, L63`
- `Removed — no fact in your record supports it`
- `Removed — the supporting fact is unverified (Generated) and is never rendered`
- `From 1 restricted fact · included in this résumé, withheld from public outputs`

A change with no explanation is a defect.

### Footer

- `Accepting replaces your <render> with v<n>.`
- `v<n-1> and every earlier version stay restorable from version history.`
- A withholding notice when applicable: `N private facts in your record were not used.` — states that something was withheld, never what.
- **Accept is all-or-nothing.** No per-change accept. If a proposed line is wrong, the fix is the underlying fact.

### Decided state

Footer is replaced by a result bar: icon + `Proposal accepted — saved as v5` / `Proposal dismissed — v4 kept`, a one-line consequence, and `Undo`.

### Japanese variant

Same layout, same components. Differences that are **requirements, not styling**:

- Mixed JA/EN font stack (`05-design-system.md` §2). Geist alone has no Japanese coverage.
- `word-break: normal; line-break: strict; overflow-wrap: break-word` on all prose.
- Marks wrap phrase-level units (文節-scale), e.g. `イベント駆動型のサービス群として再構築` — never individual characters.
- Interface chrome stays **English** even in a Japanese document; only the document content is Japanese.
- Japanese section headings render at their conventional names (職務要約 / 職務経歴), with positive tracking (`.04em`) rather than the negative tracking used on Latin headings.

### States

| State | Behaviour |
|---|---|
| **Generating** | Proposed column shows a skeleton; current column is fully readable throughout |
| **Generation failed** | Current version untouched and readable. Error states the reason; action is retry. Never a blank proposed column with no explanation |
| **No changes proposed** | Do not open the diff. Report `Already up to date with your record` on the overview |
| **Every line changed** | Renders normally. Reject-all remains one action |

---

## Screen 3 — Record Overview

**Purpose.** Home. What the record contains, what the documents say, what needs attention.

### Layout

Sidebar + header (`Your record`, note `Last import <relative time>`, actions `Quick capture`
(ghost) and `Import a document` (primary)). Content column: `max-width 940px`, centred.

**Section 1 — At a glance.** Four-tile grid, 1px gaps over a `border` background so the tiles read
as one object. Each tile: label, 23px value, sub-note (`2 current, 2 past` / `4 with measured
outcomes` / `1 expires Mar 2027`). Entities: Employers · Roles · Projects · Credentials.
**Credentials counts educations and certifications together** — the split is a storage decision
(`04-database-schema.md` §3.8–3.9), not an interface one.

**Section 2 — Facts by provenance.** A panel with a 7px stacked bar (green / accent / amber, 2px
gaps) and a legend row per value: dot, name, one-line description, count.
**The Generated row is the action row** — when nonzero it takes an amber tint, an amber inset ring,
and a `Review N →` call to action. Everything waiting for the author is expressed here.

**Section 3 — Documents.** One row per render: icon tile, name, `<language> · generated <date>`,
status dot + text, right-aligned action.

- Up to date → green dot, `Up to date with your record`, action `Open`
- Stale → accent dot, `N new facts since it was generated`, action `Review proposal`

Five rows: Résumé (English), 履歴書, 職務経歴書, and both career stories. **Japanese titles render
in the mixed font stack.**

### Empty state

Not a variant of the populated screen — a different screen.

- Heading `Your record is empty`
- One paragraph explaining the loop: import a document you already have, review the facts it extracts
- A dashed drop target: icon tile, `Import your first document`, and a `Choose a file` primary button.
  **The copy names only the types that actually import** — M1 is `Markdown and plain text`; the line
  grows as `07-api-design.md` §5 grows. Offering Word or PDF here and rejecting them at upload is a
  worse empty state than a narrower one
- Footnote: `Quick capture and document generation open up once your record holds its first facts.`
- `Quick capture` is **hidden**, not disabled — there is nothing to capture against yet
- Stat tiles and the documents list are absent entirely

### States

| State | Behaviour |
|---|---|
| **No profile** | Redirect to the profile form. Every render needs a name |
| **Import in progress** | A row above At a glance showing the document and progress, linking to fact review |
| **All documents stale** | Normal. Five accent dots is a valid state, not an error |
| **Zero Generated facts** | Row renders in the resting style with `Nothing waiting` — no amber, no call to action |

---

## Screen 4 — Your record

The five hand-entered entity types on one screen: employers, roles, projects, education and
certifications. **Each is a plain form** — no import, no extraction, no diff review (S7). Sidebar
chrome, one `Panel` per collection, each listing its rows with an inline form below the row being
edited.

**Employer** carries 資本金 and 従業員数; **Education** carries an **outcome**, and a withdrawal must
read 中退 rather than 卒業. **Education also carries a required level** — the rung the schooling sits
on, which is what the English résumé selects rows by; the field is required on the form because the
alternative is a render classifying a school by its name. All calendar fields collect **month and
year only**.

Two rules the screen makes visible: **Add** on Roles is disabled with a stated reason until an
employer exists, because a role belongs to one; and deleting an employer something still references
surfaces the server's `409` message in place, rather than being pre-empted by a check the client
would have to keep in step with the server.

The **employer picker on the fact card** lives on Screen 1, not here — filing a fact is part of
reading it, and it appears on a resolved card as well as a candidate one so an already-reviewed
import can be filed without re-importing.

---

## Screen 5 — Version history

**Added 2026-09-12.** S14 (restore) and S16 (hand edit). The edit route landed on 2026-09-11 with
no surface; this is the screen that makes a stored version readable, comparable and restorable.

**Purpose.** Show every version of one document, how each came to exist, and put an earlier one
back. It is also where the two proposal outcomes stop being invisible: an accepted proposal became
a version, a dismissed one did not, and both are retained.

**Interaction model:** a read destination, not a focused task — it keeps the **sidebar**, unlike
fact review and diff review. The restore *preview* is a focused task and borrows Screen 2 whole.

Reached from the Documents row on Screen 3 and from the `Version history` ghost button already
specced in the Screen 2 header. Route: `/renders/:kind/history`.

### Layout

| Region | Spec |
|---|---|
| Header (46px) | Title `<render name> · version history` · contextual note `N versions · current v<n>` in `text-dimmer` · right: `Download current` (ghost) |
| Content column | `max-width 940px`, centred. One `Panel`, one row per entry, `border-inner` separators, newest first |

**Japanese render names use the mixed font stack**, as on Screen 3.

### The row

Four entry kinds share one row shape. The kind is carried by the mono meta line, never by colour
alone — `origin` and a dismissal are facts about provenance, and the palette's green/amber/red are
already spoken for (`05-design-system.md` §1).

1. **Version chip** — mono `v4`. The current version additionally carries a `measured` dot and the
   label `Current`, matching "up to date" on Screen 3.
2. **Date** — accepted date, absolute, month precision never applies here; this is a system
   timestamp, not a calendar column.
3. **Origin meta** — mono, `text-dimmer`, one of `ACCEPTED · from a proposal` · `RESTORED` ·
   `EDITED BY HAND`.
4. **Ancestry line** — present whenever `source_version_id` is set: `Restored from v2` /
   `Edited from v4`. A history that shows the origin but not the parent says an edit happened
   without saying to what.
5. **Actions**, right-aligned — `Download` (ghost) and `Compare` (ghost). `Compare` opens the
   restore preview; it is absent on the current version, which has nothing to be restored from.

**Dismissed proposals** render on `card-recessed` at `.5` opacity with the mono meta
`DISMISSED · not a version`, their dismissal date, and a single `View diff` action pointing at the
existing proposal diff. They carry no version chip, because they never received a version number.

**Download honours the existing rules** — `?versionId=` serves any version, and a 履歴書 offers
`.docx` only.

### Restore

**Restore is never a button on a row.** The action is `Compare`, which opens the preview; the
commit lives there. Replacing a document with one the author may not remember, in one click, is the
failure mode this screen exists to prevent.

**The preview is Screen 2's split view**, read-only, with three differences:

- Columns read **Current** `v<n>` and **Restoring** `v<m>` — the current version is *before*, the
  target is *after*, so the diff reads as the change the commit will make.
- The toolbar, rationale bar and per-change navigation behave as specced. A change's rationale is
  the fact behind the *target* version's text.
- The footer reads `Restoring v<m> saves it as a new version v<n+1>. v<n> stays readable and
  downloadable.` with `Cancel` (secondary) and `Restore v<m>` (primary).

**Nothing is written to the proposal table.** This comparison is not a proposal and must never
create one — that table is what a generation produced.

### 履歴書 only — the tables are always current

A 履歴書 version stores the two prose blocks; its three tables are filled from the record at
download time (`03-technical-design.md` §30). The history for `rirekisho` therefore carries one
line of copy below the panel header: **`Restoring changes the summary text only — the education,
employment and qualification tables always reflect your record as it is now.`** Without it the
screen promises a document it does not produce.

### Rules

- **No editor here.** The screen reads versions and restores them; the hand-edit route stays
  API-only until the editing surface gets its own specification. A textarea added to this screen
  would also have nowhere to put the route's attribution warnings.
- **Rows are keyboard-operable** — each row is focusable, `Enter` opens `Compare`, and the preview
  is dismissible with `Escape`. Screens 1 and 2 both shipped without this and both needed a bug.
- **Nothing on this screen deletes anything.** There is no discard, no prune, no "clean up old
  versions" — the never-delete rule is the product, and a control that appears to offer it is worse
  than its absence.

### States

| State | Behaviour |
|---|---|
| **Loading** | Panel shows skeleton rows. The header count waits rather than rendering `0 versions` |
| **No versions yet** | Not an error. `This document has not been generated yet.` with `Generate` as the action — the same sentence whether the generator for that kind is built or not |
| **Only one version** | Renders normally. `Compare` is absent throughout; no empty comparison affordance |
| **Restore refused — a proposal is waiting** | The server's `409` message in place on the preview footer, naming the proposal and linking to it. The author decides the proposal first |
| **Restore refused — the target cites a fact that can no longer be rendered** | The server's `422` in place, listing the fact ids and the reason per id (unknown · not accepted · Private · Generated). Stated as a dead end with a route out — fix the fact, or restore a different version — never as a retry |
| **Restore succeeded** | Return to the history with the new version at the top, marked `Current`, its ancestry line reading `Restored from v<m>` |
| **Staleness after a restore** | Screen 3 may now report the document as stale where it did not before. This is correct and is not an error state — the content moved back to an older era of the record |

---

## Screens not yet designed

Needed before their milestones; not blocking M1.

| Screen | Milestone | Note |
|---|---|---|
| Profile form | M2 | 履歴書 identity fields incl. PII. **Field list is now fixed** — see `04-database-schema.md` §4 |
| Quick capture | M3 | Two sentences in, short interrogation, Attested facts out |
| Skills curation | M2 | Derived candidates, author-ordered; stale skills flagged, not removed |
| Import list | M2 | Documents imported, with re-import and re-extract |

---

## Responsive behaviour

**Desktop only in v1.** Minimum supported width **1280px**; designed at 1440×900.

The two core screens are irreducibly two-pane — source beside facts, current beside proposed — and
neither survives a phone. Below 1280px the panes narrow before anything reflows; below 1024px the
app shows a message stating that a wider window is required rather than degrading into an unusable
single column.

The overview screen would adapt to narrow widths, but shipping one responsive screen out of three
is worse than none: it invites use on a device where the next click fails.

**Built fluid regardless.** No fixed page widths; panes flex. The desktop gate is a deliberate
product decision, not a layout limitation — so the M3 quick-capture screen can ship as a narrow
surface without re-laying-out the application.
