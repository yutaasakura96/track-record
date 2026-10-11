# 10 — Screen Specifications

**Status:** Phase 3 · written 2026-08-12 · Screens 5 (version history) and 6 (edit a version) added 2026-09-12 · Screen 8 (documents) added 2026-09-15 · light theme, rendered Markdown, contents, extraction progress and screen intros added 2026-10-05 (issue #56) · Screen 3 (home) and the sidebar rewritten 2026-10-05 (#58) · the documents separated into English and 日本語 tabs, and a master document per language, 2026-10-10 (#59) · Screens 12 to 15 (Applications) specified 2026-10-11 (#60, #69), built by #70 to #77
**Visual reference:** `design/prototype/` — `fact-review.dc.html`, `diff-review.dc.html`,
`diff-review-ja.dc.html`, `overview.dc.html`. The prototype shows the target look; **this document
and `05-design-system.md` are the contract.** Where they disagree, the docs win.
For Screens 12 to 15 the reference is `docs/prototype/applications-prototype.html`, the clickable
prototype the owner reviewed on 2026-10-10, under the same rule. `docs/prototype/README.md` lists
where this document already differs from it.

Three screens carry v1. All values referenced here are defined in `05-design-system.md`.

---

## Shared chrome

**Sidebar** — 212px, `surface`, right border `border`. App mark + wordmark at 46px height. Nav
rows: Home, Record, Skills, Documents, Flagged, Master document, Applications. Applications
replaced Tailored résumés in #70. There is no separate Imports row: imports are versions of a
document and are listed on Screen 8.
Active row: `bg hover`, `color text`, weight 500. An inactive row is `text-muted`. Footer: 22px
circular avatar, name, and the literal label `Personal record` — the single-user posture stated in
the interface.

- **A destination that is not built has no row** (#58). `Facts` stood in the list disabled, with its
  reason in a tooltip, so that the shape of the application was legible; what it was read as is a
  broken link. It is the rule Screen 3 already follows for Quick capture, hidden rather than
  disabled. `Facts` and `Settings` take their rows when their screens exist
- **The Documents row says what its count counts** (#58). The count is the open candidates across
  every version of every document, shown only above zero, and it is written out on a second line of
  the row: `1,085 facts to review`, at `text-small` in `generated-text`, amber because a candidate
  is not usable yet. A bare `1085` beside the word `Documents` read as a number of documents
- **`Applications` takes the `Tailored résumés` row** (specified 2026-10-11, #60; built by #70), last
  in the list. It carries a second line, `N gone quiet`, the applications marked gone quiet (Screen
  12), shown only above zero and set in `text-muted` as Flagged's line is: it is advice, and
  nothing is held back by it. Until #70 the row is still `Tailored résumés`
- **Since 2026-10-08 that line reads `N facts to sort`** (#57). A fact imported since then never
  waits, so the count is only the facts found before, and what they wait for is one press, not a
  review each (Screen 3). **The Flagged row carries its own line, `N to check`**, the flags not
  marked checked, shown only above zero. It is set in `text-muted`, not amber: amber is for what is
  held back, and a flag is advice

**Header** — 46px, `surface`, bottom border `border`. Screen title at 12.5px/600, contextual note
in `text-dimmer`, actions right-aligned.

The fact-review and diff-review screens replace the sidebar with a breadcrumb in the header
(`Documents / <project> · <filename>`, `Outputs / <render>`) — they are focused, full-width tasks, not
navigation destinations.

### Theme · added 2026-10-05, issue #56

**Light by default, dark as an option** (`05` intro and §1). The sidebar footer carries the control,
under the name: a two-segment `Light` / `Dark` radio group labelled `Theme`, one tab stop, arrow
keys inside it. It takes effect at once and is remembered for this browser. The focused screens have
no sidebar and so no control; they open in whichever theme was chosen. Every screen is checked in
both themes before it ships.

### Screen intro · added 2026-10-05, issue #56

The author's first pass through Documents and Review was not self-explanatory: nothing said what a
screen was for or what to do next. **Every sidebar screen opens its content column with two lines:**

1. **What the screen is for**, one or two plain sentences at the UI size in `text-secondary`.
2. **`Next:`** and the one thing to do now, in `text-strong`, chosen from the screen's state. When
   nothing is waiting it says so, because "nothing to do" is also an answer.

It is not dismissible. Two lines cost less than a first-time reader's guess, and a `Next:` that
tracks state stays useful on the hundredth visit. The words for each screen are given under that
screen. Home's intro belongs to its own layout (issue #58) and follows the same two-line shape. The
focused screens say the same things in place: Fact Review in its rail, Diff Review above its columns.

**Plain words over internal ones.** A fact waiting for a decision is `to review`, not `open`. A
decided one is `reviewed`, not `resolved`. A part of a document sent to the model is a `section`,
not a `chunk`. The API keeps its field names (`07`); the interface does not show them.

### Extraction progress · added 2026-10-05, issue #56

Reading one portfolio took 150 sections, and the only sign of it was a 96px bar on one row. **Wherever
the author waits on an import, the same block says three things: that work is under way, how far
along it is, and that they can keep going.** It is the block specified in `05` §7.

| Import state | Title | Percentage | Line |
|---|---|---|---|
| `queued`, or `extracting` with no section count yet | `Getting ready to read this document` | None | `Still working, please wait. This page updates on its own.` |
| `extracting` | `Reading the document` | Sections read over the total, rounded **down** and capped at `99%`: the last section is counted before the import leaves `extracting`, and the block never reads `100%` while the import is `queued` or `extracting` | `N of M sections read. Still working, please wait: a long document takes several minutes.` then the surface's own sentence about what to do meanwhile |

It appears on Fact Review, pinned above the cards (Screen 1), and under the version's row on
Documents (Screen 8). Home's import row shows the same percentage and count (issue #58). The
percentage counts work done; it is not a confidence in anything (`05` §9, rule 12).

---

## Screen 1 — Fact Review

**Purpose.** Turn one imported document into accepted facts. The most-used screen in the product
and the one M1 is judged on.

**Changed 2026-10-08 (#57): the importer accepts, the author checks.** A fact now arrives accepted,
with its Worth and Who set and its flags on it, so on an import made since then nothing on this
screen waits. It is where a fact is opened when the author wants to check it, change it or reject
it. Everything below about a *candidate* still holds for the facts imported before, which wait
until they are sorted or reviewed. "After automatic acceptance", at the end of the Fact rail
section, is what differs.

**Interaction model:** Grammarly's editor — highlighted spans in a document, one card per span in a
right rail, decided one at a time.

### Layout

| Region | Spec |
|---|---|
| Header (46px) | Breadcrumb `Documents / <project> · <filename>`, `Documents` linking to Screen 8 (filename in a mono chip). A document filed under no project reads `Documents / <filename>`: the project and its `·` are left out, not labelled `No project` · right: `N of M reviewed` + 96×4px progress bar + **Finish review** (primary; secondary-styled until all facts are resolved) |
| Source pane (flex) | 34px label strip: `Source document · N words · imported <relative time>` · right: the `Rendered` / `Source` control, a `Contents` button while the contents column is hidden, and `N passages marked`. Below: the contents column (212px) and the document, 740px measure, centred, `text-body` |
| Fact rail (412px) | Fixed right column, `surface`, left border `border`. Header + scrolling card list + summary footer |

### Source pane

Each extracted fact marks a span in place. Border style carries meaning and must not be restyled:
**solid** = normal · **dashed** = Generated · **dotted** = Private · **strikethrough** = rejected ·
green underline = accepted.

Clicking a mark selects its card and scrolls the rail to it. Selecting a card scrolls the document
so the mark sits ~34% from the top. Both directions are required.

**Rendered by default · #56.** A Markdown document (`.md`, `.markdown`) is shown rendered, per `05`
§2 Rendered Markdown: headings, lists, tables, emphasis and code read as what they are and not as
`#`, `**`, `-` and `|`. A plain-text document is shown as stored, because rendering it as Markdown
would join its lines into paragraphs; it has no view control and no contents.

**The source is one press away.** The label strip carries a two-segment `Rendered` / `Source` radio
group. `Source` shows the stored text exactly, whitespace preserved, with the same marks on the same
characters. It is the view for when the exact quote matters: a fact's quote is verified against
these characters, not the rendered ones (`03` §4.1). Switching keeps the selected passage in view. The
choice lasts while the app is open and is not stored.

**Marks in the rendered view.** A mark covers the rendered text its quote's characters produce.
A quote that runs across bold text, two list items or several table cells is drawn as several marked
runs that belong to one fact: clicking any of them selects the card, and selecting the card scrolls
to the first. Markup characters inside a quote (`**`, `|`, `- `) are not text and carry no mark. A
quote that falls wholly on markup has no mark in the rendered view; its card works as before and
`Source` shows it. An image is one unit: a quote that touches any part of it marks its alt text
whole. The border styles above mean the same in both views.

**Contents.** A rendered document with two or more headings gets a contents column on the left of
the pane: 212px, `surface`, a `border-subtle` right edge, scrolling on its own. A `Contents` label
and a bare `Hide`, then one link per heading of level 1 to 3 in document order, at the small role,
indented `12px` per level below the first. Clicking a link scrolls the pane so that heading sits at
its top. The entry for the section being read, which is the last heading at or above the top of the
pane, is `text-strong` on `hover` with `aria-current`; the others are `text-dim`. `Hide` closes the
column and a ghost `Contents` button in the label strip opens it again. Headings of level 4 and
deeper are not listed. The column is absent in `Source`, for a plain-text document, and for a
document with fewer than two headings.

### Fact rail

**Header:** `Candidate facts` + mono `N extracted`. Then the `Next:` line below, then the filter
pills: `All N` · `To review N` · `Reviewed N`, and `To re-grade N` while any accepted fact of the
import has no grade (M3, #37). The rail lists every fact of the import, not only the first page of
the API.

**How to review · #56.** This screen's intro, in place of the one line of copy the header used to
carry. It is the first item in the card list and scrolls with the cards, so it is read once at the
top and is out of the way by the third card. A block headed `How to review` with a bare `Hide`:

1. `Read the highlighted passage on the left. It is the evidence.`
2. `Check that the claim on its card says what the passage says. Click the claim to reword it.`
3. `Accept it into your record, or reject it. Either can be undone.`

Then what the three controls on a card ask, each as its label and one line: **Worth**, `Measured`
is a number the passage states, `Attested` is true and yours but not a number, `Generated` is the
importer's guess and stays out of every document until you change it. **Who**, `Public` can go to
any employer, `Restricted` is used only in general terms with the client unnamed, `Private` stays
in your record and is never put in a document. **Where**, the employer it happened at. These are the
definitions of PRD §5 in the author's words; the block explains the controls and changes nothing
about them. It is open until the author hides it, and that is remembered for this browser; hidden,
it is one line, `How to review` and a bare `Show`.

**The `Next:` line** is in the header, under the title, and is never hidden. The first of these
that applies: `Next: wait for the first facts. They appear here as they are found.` while the
import is `queued` or `extracting` and has no fact yet;
`Next: review the facts found so far while the rest of the document is read.` while it is still
being read; `Next: this import stopped before it finished. Press Retry to read the rest.` for a
`failed` import with no fact left to review, whether none was found or every one found is reviewed:
a failed import never says nothing was found, and never says to finish;
`Next: nothing was found to review.` for a finished import with no facts; `Next: everything here is reviewed. Press Finish review.` when none is left;
`Next: N facts left to review.` otherwise.

**Extraction progress** is pinned between the header and the card list while the import is `queued`
or `extracting`, so scrolling the cards never scrolls it away. It is the shared block (Shared
chrome), and its last sentence here is `You can review the facts already found.`

**Card, open state:**
1. Line-reference chip (mono, e.g. `L79`) — the evidence pointer into the source
2. Status badge when applicable — `DRAFT · NOT USABLE` (Generated, dashed amber) or `PRIVATE · NEVER SHARED` (locked grey)
3. Claim text — inline editable, commits on blur. Generated claims render *italic* in `generated-claim`
4. Warning block for Generated: *"Inferred by the importer — this number is not stated in the source. Promote it to Attested or Measured before it can be accepted."*
5. `Provenance` segmented control — Measured / Attested / Generated
6. `Disclosure` segmented control — Public / Restricted / Private
7. Explanatory footnote for Private: what it means, in one sentence
8. Actions — `Reject` (ghost, left) · optional hint · `Accept` (primary, right)

**The quoted passage on the card · #56.** Every open card shows the passage it quotes,
directly under the claim, so the evidence and the decision are in one place: a left rule in
`border-strong`, `10px` in from it, a mono label `Quoted passage`, then the passage at the small
role in `text-secondary`. For a Markdown document it is rendered: emphasis, code, links and images as
in the source pane, with block structure flattened to a line break between blocks and ` · ` between table
cells. A bare `Exact text` beside the label swaps it for the stored characters, verbatim and with
whitespace preserved, and `Rendered` swaps back. A plain-text document shows the exact text and no
toggle. A resolved card shows none. **It does not depend on selection:** a press on an unselected
card selects it at mousedown, and a passage that appeared at that moment would move the grade and
the buttons out from under the press. No part of a card changes height with selection.

**Overlap on the card · M3, built by #36, 2026-09-28.** A candidate with likely matches
among the accepted facts at the same employer shows them on the card, beside its claim: each
match's claim and the document it came from, and a **conflict** marker when the match's number
differs (PRD §8). The flag is advisory. It changes nothing about Accept or Reject, which are how the
author settles it: when a portfolio restates a narrative fact, the portfolio's fact is accepted and
the narrative one rejected (decision log, 2026-09-28). There is no merge action. A card with no
likely matches shows nothing, not an empty block.

- **Placement:** directly under the claim, above the Generated warning and the controls, so the two
  claims read as a pair.
- **The block:** a left rule in `border-strong`, `10px` in from it. A mono label, `Likely already in
  your record` (`text-faint`). Then one row per match, at most three, best first: the match's claim
  at `text-small` in `text-secondary`, and under it the document's filename as a mono identifier in
  `text-dimmer`, with `· vN` after it when the version is above 1. The filename links to that
  document's Fact Review.
- **Re-grading a match · M3, #37, 2026-09-30.** A match whose grade is not the author's
  (`graded: false`, `07` §6), which is each of the 112 facts of the 2026-09-04 import, carries a
  line under its document: a mono `Graded by default · <provenance>` in `text-faint`, a `Re-grade`
  group of three buttons, Measured / Attested / Generated, with **none marked as chosen**, and a
  ghost `Reject`. They are actions rather than a radio group, so arrowing through them grades
  nothing. Pressing any of them, the current provenance included, re-grades the fact and the line goes
  (`POST /api/facts/:id/regrade`). `Reject` rejects the match where it stands, which is the
  portfolio winning, and it drops off the card on the next read. Measured is refused without
  evidence, and the refusal is said on the line. A graded match shows neither.
- **The conflict marker:** a mono label `Conflict · number differs` in `text-bright`, on its own line
  above the match's claim. **It takes no semantic colour.** Green, amber and red mean Measured,
  Generated and removed (`05` §9), and a conflict is none of those; its wording and weight carry it.
- **No score and no percentage** (`05` §9, rule 12). Order is the only sign of which match is closer.
- **Nothing on a resolved card.** The flag is settled on the open card; accepted and rejected cards
  keep their collapsed form. A candidate with no employer shows no block, because matching is
  within an employer; picking one on the card brings it.

**Card, resolved state:** collapses to icon + claim + mono `ACCEPTED · MEASURED · PUBLIC` meta line
+ `Undo`, on `card-recessed`. An accepted claim stays `text-strong`; a rejected one is `text-dim`
with a strikethrough. Neither is dimmed with opacity, which was `.78` and `.5` until 2026-10-05 and
took the text under the contrast floor (`05` §1). An accepted card with no
grade adds the same re-grade line as a match (M3, #37): this is the listing the facts no portfolio
matched are graded from, on the 2026-09-04 import's own Fact Review, under `To re-grade`. It carries
the same `Reject`, beside the three grades.

**Card treatments:** Generated cards use a dashed amber border and a 135° hatch background. Private
cards use `card-recessed` with a large low-opacity padlock watermark at bottom-right. Selected cards
use the lifted elevation with a tone-matched ring.

**Footer:** legend — `N shareable` (green) · `N private` (grey) · `N need promotion` (amber). Then a
full-width primary button: `Add N facts to record`, disabled reading `Nothing accepted yet` at zero.

### After automatic acceptance · 2026-10-08, #57

An import is **sorted** when no fact of it is a candidate and the importer accepted at least one.
A sorted import changes the words of a review for the words of a record:

| Where | Reviewed by hand | Sorted |
|---|---|---|
| Header, right | `N of M reviewed`, the progress bar, **Finish review** | `N facts, already in your record` and **Done**. No progress bar: nothing is in progress |
| Rail title | `Candidate facts` | `Facts`, whenever no candidate is left |
| `Next:` line | as above | `Next: nothing is waiting. N of these are flagged; check them when you want.`, or with none flagged `Next: nothing is waiting. Every fact here is in your record.` While the document is still being read: `Next: the facts found so far are already in your record. The rest of the document is still being read.` |
| Filter pills | `All` · `To review` · `Reviewed` | `All`, and `Flagged N` while any fact has an open flag. `To review` and `Reviewed` are left out |
| Extraction progress, last sentence | `You can review the facts already found.` | `The facts already found are in your record.` |
| Footer button | `Add N facts to record` | `Done` |

**The accepted card.** Collapsed as before: icon, claim, the mono `ACCEPTED · MEASURED · RESTRICTED`
line. Then, in this order:

1. **`Change`**, a bare text button on the meta line, which opens the card's controls in place: the
   quoted passage, the claim (editable, commits on blur), Worth, Who and a ghost **Reject**. It
   reads `Close` while open. They are behind a press of their own because a card must not change
   height by being selected. **Setting Worth here records the grade as the author's**
   (`POST /api/facts/:id/regrade`), so the fact stops being one the importer graded.
2. **`Undo`** only on a fact the author accepted or rejected. A fact the importer accepted has
   nothing to undo; rejecting it is under `Change`, and `Undo` on the rejected card puts it back
   accepted, as the importer left it.
3. **Its open flags**, one block each, under the meta line: the kind as a mono label, **the reason
   in a sentence**, and the two controls of Screen 9, `Explain this` and `Mark as checked`. A fact
   with no open flag shows no block.
4. **The overlap block**, when the fact has an open `Likely a repeat` flag: the same block a
   candidate shows, with the other fact's claim and document. Marking the flag checked removes it.

**Waiting facts, on an import made before the change.** While the import has a candidate and is not
still being read, the rail header carries, under the `Next:` line:
`These were found before facts were accepted for you. Sort them in one go: the AI grades each, keeps
every one, and flags the ones worth a look.` and a primary **`Sort N facts`**. While it runs the
button reads `Sorting…` and a status line beside it counts `N sorted, M to go`. A failure is said
under it, and what was sorted before the failure stays sorted. Reviewing them one card at a time
still works exactly as specified above.

**Opened from elsewhere.** `/imports/:importId?fact=:id` selects that fact once its card exists,
with the filter set to `All` so the card cannot be filtered out. Screen 9 and Screen 10 link here.

**`How to review`** gains one line: `A flagged fact says why. Press Explain this for more, in plain
words.`

### Rules

- **The importer never rejects, and never leaves a fact out.** What it is unsure of is accepted as
  Generated and flagged. The one thing it discards is a candidate whose quote is not in the
  document, which is counted and was never a fact (`03` §5).
- **A Generated fact can be accepted.** It is accepted, flagged, and excluded at render time. The prototype blocks acceptance outright; that is wrong — see the decision log entry of 2026-08-12. Accept must remain enabled, with the card clearly marked as not renderable.
- **Private facts are accepted normally.** The accept button reads `Accept · private`.
- **No confidence score.** The prototype shows `p 0.96`; it is cut.
- Re-importing an updated document must not re-surface facts already accepted or rejected.

### States

| State | Behaviour |
|---|---|
| **Loading (extracting)** | Document renders immediately; the rail shows the extraction progress block pinned above the cards (Shared chrome), and cards appear as they are found. Extraction is visibly incremental |
| **Zero facts extracted** | Rail shows a failure, not an empty success: *"No facts could be extracted from this document."* Actions: retry, or capture manually. Document is retained |
| **Nothing new (re-import)** | A re-import that is `ready` with zero candidates, version 2 or later. Two causes, both a success and never the failure above (Flow 4). **No changed text** (zero chunks): the rail's card list shows one bordered block: `Nothing new to review` (row, strong) and *"vN adds no new or changed passages since vN−1, so there was nothing to extract. Your record is unchanged."* (smaller, dim). The wording avoids "no changes" because a version that only removes text also lands here. **Only repeats** (chunks ran, every candidate suppressed): the same block, with *"Everything in the changed passages of vN is already in your record (N facts), so there is nothing new to review. Your record is unchanged."* No actions in either; `Finish review` and the footer keep their zero states |
| **Repeats suppressed** | Whenever `candidatesSuppressed` is above zero, the rail header carries a faint line under the description, beside the discarded-quote line: *"N candidates repeated facts already in your record and were not offered again."* A count, never which facts |
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
| Header (46px) | Breadcrumb `Outputs / <render name>` + mono `proposed v<n>` chip · right: regeneration reason (`Regenerated after N new facts entered your record`, `… after N facts could no longer be used`, or both) + **Version history** (ghost) |
| Toolbar (38px) | `N additions` (green dot) · `N removals` (red dot) · section summary · right: `Change N of M` + prev/next icon buttons |
| Guide (34px) | One line under the toolbar, at the small role in `text-secondary` (#56): `Left is your document as it stands. Right is what it would become. Read the highlighted changes, then keep the current version or accept the proposed one.` |
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
| **Generation failed** | Current version untouched and readable. Error states the reason; action is retry. Never a blank proposed column with no explanation. Retry and **Back to your record** both dismiss the failed proposal, so none is left pending |
| **No changes proposed** | Do not open the diff. Report `Already up to date with your record` on the overview |
| **Every line changed** | Renders normally. Reject-all remains one action |

---

## Screen 3 — Home

**Purpose.** Home, and the first thing the author sees. In this order: what to do next, what the
record holds, what the documents say. **Rewritten 2026-10-05 (#58)**: the screen it replaces led
with four counts and a chart of `Facts by provenance`, and the author could not say what they were
looking at. The test of this screen is that a first-time author and a returning one can both say
what it shows and what to do, without knowing a word of the product's vocabulary.

### Layout

Sidebar + header (`Home`, note `Last import <relative time>`, action `Import a document`
(primary)). The title was `Your record`, which is Screen 4's title and the sidebar's `Record` row.
`Quick capture` (ghost) joins the header when it is built (M3). Content column: `max-width 940px`,
centred. Each section is a panel with a heading and, under it, one sentence saying what the
section is.

**Readable by rule.** No text on this screen is set in `text-dimmer`, `text-faint` or `text-ghost`.
On the panel surface they measure 3.35, 2.70 and 1.83 to 1, under the 4.5 to 1 a reader needs, and
the screen this replaces set its counts, its notes and its section label in them. Supporting text is
`text-muted` (5.94 to 1) or brighter and descriptions are `text-body`. Nothing the author reads is
smaller than `text-small`, so a count is set as text, never as a 9.5px mono label. A section's
heading is 14.5px/600 in `text-bright` and its sentence is the UI default, 13px.

**Section 1 — Next step.** One panel that says the single thing most worth doing now: a title at
the page-heading size, one sentence of why, and one button. **It holds the only primary button in
the content column**, so the eye has one place to go. The step is the first of these that applies.

| When | Title | Sentence | Button |
|---|---|---|---|
| Candidates are waiting (facts imported before 2026-10-08, #57) | `Sort N waiting facts` | `Found in <filename> before facts were accepted for you. One press grades each, keeps every one, and flags the ones worth a look.` With more than one document holding any: `Found in N documents before …` | `Sort them`. It sorts where it stands and opens nothing: the button reads `Sorting…`, and a status line under the step counts `N sorted, M flagged. K to go; keep this page open.` The step goes when none are left. Until 2026-10-08 this row was `Review N facts` with `Review facts` into Fact Review |
| An import is running and has found none yet | `Wait for the first facts` | `The import is still reading. Open the review to watch the facts arrive.` | `Open review`, into that import's Fact Review |
| A proposal is waiting | `Check the new <document>` | `A new version is ready. Nothing changes until you accept it.` | `Review changes`, into Diff Review |
| A proposal is still being written, and none is ready | `Wait for the new <document>` | `It is still being written. Open it to watch it arrive.` | `Open it`, into Diff Review |
| Facts **the author accepted on a card** are still Generated. One the importer accepted is not counted: it carries a `Not sure` flag, and a flag is never a step (#57) | `Confirm N facts`, N counting only the newest version that holds any | `The importer wrote them and you have not confirmed them, so no document uses them.` With more in older versions: `… M more are in older imports.` | `Open them`, into Fact Review on that version |
| No accepted fact can be used in a document | `Import a document` | `Your documents are generated from facts, and facts come from a document you already have.` | `Import a document`, the header's control |
| A buildable document was never generated | `Generate your <document>` | `Your record holds facts it can use. This makes the first version for you to check.` | `Generate` |
| A document is out of date | `Update your <document>` | `N new facts since it was generated.` When it is out of date only by facts it may no longer use: `N facts it was generated from can no longer be used.` Both: `N new facts since it was generated, and M it was generated from can no longer be used.` | `Update` |
| None of the above | `You are up to date` | `Nothing is waiting for you. Import another document to add to your record.` | None |

Every other step that applies is listed under it, below the line `Also waiting`, as one row each:
its title and a ghost button. So a returning author reads the whole of what is waiting in one
place, in the order to take it. `Wait for the first facts`, `Import a document` and
`You are up to date` are answers to "what now" and never appear in that list. One document stands
for all of them in the two document steps, the first in the list that needs it; Section 4 says the
rest. **The two document steps need a fact a document may use**; without one they are not offered,
and `Import a document` stands only when nothing else is waiting, because the way to a usable fact
is then to deal with what is. A Generate or Update pressed here that the server refuses says the
server's reason in this panel, under the step.

**Section 2 — Your record.** Heading `Your record`, sentence `What you entered by hand: where you
worked, and what you hold.`, and a link `Open Record` to Screen 4. Under it a four-tile grid, 1px
gaps over a `border` background so the tiles read as one object. Each tile: label, 23px value,
sub-note (`2 current, 2 past` / `4 with measured outcomes` / `1 expires Mar 2027`). Entities:
Employers · Roles · Projects · Credentials. **Credentials counts educations and certifications
together** — the split is a storage decision (`04-database-schema.md` §3.8–3.9), not an interface
one. **A tile at zero says so in words**: its sub-note reads `None added yet`, so a `0` reads as an
answer and not as a failure to load.

**Section 3 — Facts in your record.** Heading `Facts in your record`, sentence
`A fact is one claim about your work, quoted from a document you imported. N accepted.` Then an
8px stacked bar (green / accent / amber, 2px gaps) and one row per provenance value. **The row
leads with plain words and names the product's term second**, because `Measured`, `Attested` and
`Generated` are the words on the fact card and mean nothing at a glance (#58):

| Row | Term | Description | At zero |
|---|---|---|---|
| `Backed by a number` | `Measured` | `A result with a figure, and the passage that proves it.` | `None yet` |
| `Stated by you` | `Attested` | `True, and yours, with no figure behind it.` | `None yet` |
| `Not confirmed` | `Generated` | `Written by the importer. Left out of every document until you confirm it.` | `Nothing waiting` |

**Flags are a line under the rows, not a row and not a step** (#57). While any flag is open:
`N are flagged for you to check when you want. Each says why.` and a ghost `Open the list` to Screen
9. The section's heading carries a quiet `Open master document` link to Screen 10 once the record
holds an accepted fact.

Each row: dot, the plain words, the term in a chip, the description, and the count at the row-title
size. **A zero is written as words, never as `0`.** `Measured 0` in the faintest text on the screen
read as something broken; `None yet` is a state. **The Not confirmed row is the action row** — while
the author has a fact of their own to confirm (above zero, until 2026-10-08) it takes an amber tint, an amber inset ring, and a ghost `Confirm N` that opens the same Fact
Review the Next step does, N being that version's facts as it is in the step. With no accepted fact
at all, the bar and the rows give way to one line:
`No accepted facts yet. They are accepted for you as a document you import is read.`

**Section 4 — Your career documents.** Heading `Your career documents`, sentence
`Generated from your accepted facts, in English and in Japanese. Each one is a file you can
download.` The heading is not `Documents`: that is the sidebar's word for the files facts are quoted
*from*, and this section is what is generated *out*. **Japanese titles render in the mixed font
stack.**

**Two tabs separate the languages** (2026-10-10, #59). The section was one list of five that mixed
two readers' documents. It is now a tab list, `English` and `日本語`, each tab named in its own
language, and one panel under it:

| Tab | Rows, in order |
|---|---|
| `English` | The English master document, Résumé (English), the English career story |
| `日本語` | The 日本語 master document, 履歴書, 職務経歴書, 職務経歴ストーリー |

- **The tab list is a WAI-ARIA tab list**: one tab stop, the arrow keys, Home and End inside it,
  selection following focus, and the panel named by the tab that is open. It is drawn as the
  segmented control's track with chip-radius segments, at the row-title size.
- **`English` is open on a first visit, and the choice is kept for this browser** under the
  `localStorage` key `track-record:document-language`, as the theme is. It is not a column: it says
  which tab is open, and nothing about the record. **Screen 10 reads the same choice**, so the
  language open here is the language of the master document that opens.
- **The first row of each tab is that language's master document** (Screen 10). Title
  `Master document` or `マスタードキュメント`, note `English · everything in your record, and what
  every English document is written from` (or `Japanese · … every Japanese document …`), the count
  `N facts` (`No facts yet` at zero) and one secondary `Open`. It is not generated and has no
  versions, so it has no status dot, no `History`, no button and no `Download`: the file is
  downloaded on Screen 10, beside the note that it holds Private facts.

**One line above the rows says which to act on** (#58), and it speaks for the rows of the tab that
is open. Five rows each reading `N new facts since it was generated` beside the same three buttons
said nothing about where to start, and the honest answer is that they do not depend on each other:

- No accepted fact can be used → `Nothing can be generated until your record holds an accepted fact a document may use.` No row then offers Generate, Update or Regenerate; the line is their reason, said once
- A proposal waiting → `<Document> has a new version waiting for you. Check it first.`
- A proposal still being written, and none ready → `A new version of <Document> is being written. Check it when it is ready.`
- One out of date → `<Document> is out of date. Update it when you next need it.`
- More than one → `N of M are out of date. Update the one you need next; each is updated on its own, and the rest can wait.`, M being the documents on that tab
- None generated → `None generated yet. Generate the one you need first; each is made on its own.`
- Otherwise → `Every document you have generated is up to date with your record.`

Each row: name, `<language> · generated <relative time>`, status dot + text, then the quiet links
`History` (Screen 5) and `Download`, offered once a version exists, and **one** button.

| Status | Dot and text | Button |
|---|---|---|
| Never generated | muted, `Not generated yet` | `Generate` (secondary) |
| Proposal waiting | accent, `New version waiting` | `Review changes` (secondary) |
| Proposal being written | accent, `Writing a new version` | `Open it` (secondary) |
| Out of date | accent, `N new facts`, `N facts no longer usable`, or `N new facts, M no longer usable` | `Update` (secondary) |
| Up to date | green, `Up to date` | `Regenerate` (ghost) |
| Not built | muted, `Not available yet` | None |

`Download` reads the same on every row so the rows line up; the file's type is the document's own
and is in the name of what is saved. A Generate or Update the server refuses says the server's
reason above the rows.

**Section 5 — Backup.** Heading `Backup`, sentence `Your whole record as one JSON file: everything
you entered, every fact, and where each fact is quoted from. The imported documents themselves are
not included.`, and a secondary `Export my record`, which is `GET /api/export` (S15).

### Importing a document

`Import a document` opens a file picker restricted to the types that import, the same list the
empty state names. What happens next depends on whether the record holds any projects or employers,
because `POST /api/imports` takes an optional `projectId` and an optional `employerId`
(`07-api-design.md` §5) and Flow 2 step 2 offers the choice. Both lists are read when the file is
chosen, and a failed read imports nothing: `Your projects and employers could not be read, so this
document was not imported. Try again.`

- **Neither.** The import starts on the file choice alone and Fact Review opens. A select whose
  only option is `No project` is not a choice, and a step with nothing in it is worse than no step
- **Projects or employers.** Choosing a file does not upload it. A confirmation row appears at the
  top of the content column, above anything else there: the chosen filename in a mono chip, then
  the label `File it under` and a project select defaulting to `No project` when the record holds a
  project, then the label `Employer` and an employer select defaulting to `No employer` when it
  holds an employer, then `Cancel` (bare) and `Import` (primary). A select is left out when its
  only option would be the default, for the reason the row is. `Import` sends `POST /api/imports`
  with the chosen `projectId` and `employerId`, leaving out whichever select is at its default, and
  opens Fact Review on the new version

**The employer choice · M3, #35.** It exists so a per-employer portfolio is filed once instead of
fact by fact. Every fact extracted from the document is filed under that employer, and the card's
employer picker still changes any one of them. An employer reads as its Latin name, or its 日本語
name when it has none, as the card's picker reads it. The document's employer can be changed later
(Screen 8, "Refiling a document").

The same row and the same rule serve the empty state's drop target and Screen 8's
`Import a document`, which is the same control. **The choice is offered only for a new document.**
A re-import keeps the document's project and employer, which are stored on the document and not on
the version (`04-database-schema.md` §3.6), so Screen 8's re-import row carries no select.

### Refiling a document

**The project and the employer are the only things about a document that change after import**, so
the label on the document's header row *is* the control rather than a sixth button competing with
`Re-import` on the right. It reads the project's name, or `No project`, followed by ` · ` and the
employer's name when the document has one, and clicking it opens a refile row under the header:
the label `File it under` and a project select set to where the document is filed now, the label
`Employer` and an employer select set to the document's employer, the line `Its facts move with it.`,
then `Cancel` (bare) and `Refile` (primary).

- **The projects and the employers are read when the row opens**, not off the listing, for the
  reason the import picker reads them when a file is chosen: a select built from a query still in
  flight offers `No project` and nothing else, which reads as a record with no projects in it. A
  failed read shows `Your projects and employers could not be read. Try again.` and does not open
  the row. With no project and no employer in the record it shows
  `There are no projects or employers to file this document under.`
- **A select is left out when it has nothing to offer**: the project select when the record holds
  no project and the document is filed under none, and the employer select likewise. The row never
  offers a choice with one answer
- **With the employer select, the line under it says what stays.** `Its facts move with it.` becomes
  `Its facts move with it, except a fact whose employer you set on its card.` A hand-set employer,
  `No employer` included, is a judgement about that one fact, and a change to the document is not
  (`04-database-schema.md` §3.12)
- **`Refile` sends only what changed** and is disabled while both selects still name where the
  document is filed, with the reason `This document is already filed there.`
- **The label is not a control while a version is extracting** — the same `reimportable` flag that
  disables `Re-import`, because `PATCH /api/source-documents/:id` refuses in the same window and for
  the same reason (`07-api-design.md` §5)
- **`No project` is an answer, not an absence.** It is how a document filed by mistake gets unfiled

Refiling moves the document's facts with it, which is what makes Screen 4's project `Delete`
reachable at all: its `409` says `Refile them from Documents before deleting.` and means it.

**The document's employer · M3, #35.** Changing it moves no row but the document's, so the server
does not refuse it while a version extracts (`07` §5). The row still cannot open then, because it
changes the project in the same step and one control is clearer than a row that is half disabled.

### Empty state

Not a variant of the populated screen — a different screen. The header keeps its title, `Home`,
so the frame does not change under a first-time author; it carries no note and no action.

- Heading `Your record is empty`
- One sentence, `Three steps turn a document you already wrote into a résumé.`, and the steps as a
  numbered list, each a bold word and a sentence (#58): **Import** `a document about your work: a case
  study, a project write-up, a portfolio.` **Check** `the facts found in it. They are added to your record
  for you, and the ones worth a look are flagged with the reason.` (until 2026-10-08, **Review**
  `the facts found in it, one at a time, and keep the ones you stand behind.`) **Generate** `your résumé, 履歴書 and 職務経歴書 from the facts you kept.`
  A paragraph said the same thing and was not read as an instruction
- A dashed drop target: icon tile, `Import your first document`, and a `Choose a file` primary button.
  **The copy names only the types that actually import** — M1 is `Markdown and plain text`; the line
  grows as `07-api-design.md` §5 grows. Offering Word or PDF here and rejecting them at upload is a
  worse empty state than a narrower one
- Footnote: `Document generation opens up once your record holds its first facts.`
- `Quick capture` is **hidden**, not disabled — there is nothing to capture against yet
- The sections of the populated screen are absent entirely

### States

| State | Behaviour |
|---|---|
| **No profile** | Redirect to the profile form. Every render needs a name |
| **Loading** | **The frame is drawn at once and filled as the reads answer** (#58): the sidebar, the header with `Home` and the note `Loading your record…`, and the four section headings over blank blocks the height of what they will hold. Nothing animates (`05` §8). It replaced a bare `Loading your record…` on an empty page that stood for about ten seconds. The session, the profile and the overview are read at the same time, not one after the other, and the screen shows this frame until all three have answered. After four seconds the note becomes `Still loading. This is taking longer than usual.` |
| **Could not be read** | Centred in the content area, with the sidebar beside it and the header above it: the server's reason for a refusal, or `The server could not be reached.`, with a ghost `Retry` beside it that reads again. While it reads the loading frame returns. Only a first read shows this. |
| **Could not refresh** | The overview, populated or empty, stays on screen. A later read that fails puts one dim line above it, at the top of the content, `Could not refresh:` then the same reason then `What is shown may be out of date.`, as a status rather than an alert, with a ghost `Retry` beside it that is disabled (`Retrying…`) while it reads. The line goes when a read succeeds |
| **Import in progress** | A panel above the Next step, which carries the way into the review. First line: `Reading`, the document's filename in a mono chip, and the share done as a percentage at the row-title size. Then an 8px progress bar, twice the control's 4px because here it is the status and not a detail of a row. Then the sentence `Still working, please wait. N of M parts read.`, or `Still working, please wait. Getting the document ready.` before the document has been split; a part is a chunk, in the author's word for it. Then `A long document takes several minutes. You can leave this page and it carries on.` The percentage is how much of the document has been read, which is not the model certainty `05` §9 rule 12 forbids. The screen reads again every 1.5 s while it runs, so the bar moves. The first line stays one line: a filename too long for it is cut short with an ellipsis and shown whole on hover, and nothing else in it gives way |
| **Read again after a write** | A write that changes what Home says (finishing a review, deciding a proposal, starting an import) marks the overview untrue. Until the read after it answers, the Next step and the import panel are **held back**: in their place stands the Next step's frame, its heading over a blank block, with the status line `Checking what is waiting for you now…`. The other sections stay as they were. A poll, during an import or while a proposal is being written, and a plain return to the page hold nothing back. Without this Home told the author to wait for an import they had just finished reviewing, for as long as the read took |
| **All documents stale** | Normal. Five accent dots is a valid state, not an error, and the line above the rows says the rest can wait |
| **Zero Generated facts** | The Not confirmed row renders in the resting style with `Nothing waiting` — no amber, no call to action |

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

**Intro** (Shared chrome, #56): `Your employers, roles, projects, education and certifications,
entered by hand. Your documents take their headings and dates from here.` Then
`Next: add an employer. Roles and imported documents are filed under one.` while the record holds no
employer, and `Next: nothing is waiting here. Add or correct an entry when something changes.` once
it does. The `Next:` line waits for the employers to be read: telling a record with three employers
to add one is worse than saying nothing for a moment.

Two rules the screen makes visible: **Add** on Roles is disabled with a stated reason until an
employer exists, because a role belongs to one; and deleting an entry something still references
surfaces the server's `409` message in place, rather than being pre-empted by a check the client
would have to keep in step with the server. **Every one of the five collections deletes**, and each
refusal names counts and never content: an employer counts the facts, roles and projects on it, and
a project counts the facts and the source documents imported under it (Screen 3).
**A project that has been imported under is refused until its documents are refiled**, and its
refusal names Screen 8 rather than asking for a reassignment: a document's facts follow its project,
so refiling the document from Documents is what moves them (`docs/06`, 2026-09-21).

**Per-render inclusion** (S13, added 2026-09-13). Employer, project and education rows carry an
`Appears in` line beneath the row: one checkbox per render, labelled with the render's name and
checked unless the author has unchecked it. Unchecking leaves the entry out of that render's
generation input and nothing else — the row stays on this screen, every other render still reads it,
and the facts filed under it leave that render with it. A project under an unchecked employer leaves
too. Saving is immediate, as it is for the forms. Roles and certifications carry no setting: a role
follows its employer, and S13 does not name certifications. Changing a setting does not mark a
document out of date, because staleness compares facts a document may use, whatever one render
leaves out (`docs/06`, 2026-09-13 and 2026-10-08). Deleting an entry
takes its settings with it (`docs/06`, 2026-09-21).

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

Reached from the `History` link on a document's row on Screen 3 and from the `Version history` ghost button already
specced in the Screen 2 header. Route: `/renders/:kind/history`.

### Layout

| Region | Spec |
|---|---|
| Header (46px) | Title `<render name> · version history` · contextual note `N versions · current v<n>` in `text-dimmer` · right: `Download current` (ghost) |
| Content column | `max-width 940px`, centred. One `Panel`, one row per entry, `border-inner` separators, newest first |

**Japanese render names use the mixed font stack**, as on Screen 3.

**Intro** (Shared chrome, #56): `Every saved version of this document, newest first. Nothing here is
ever deleted.` Then `Next: download the current version, or press Compare on an older one to see
what restoring it would change.`, shortened to `Next: download the current version.` when there is
only one, and absent while there is none, where the state below already names the action.

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
5. **Actions**, right-aligned — `Download` (ghost), `Compare` (ghost) and `Edit` (ghost).
   `Compare` opens the restore preview; it is absent on the current version, which has nothing to
   be restored from. `Edit` opens Screen 6 and is present **only** on the current version, because
   the route refuses an edit made against any other and a control that is refused is not offered.

**Dismissed proposals** render on `card-recessed` at `.5` opacity with the mono meta
`DISMISSED · not a version`, their dismissal date, and a single `View diff` action pointing at the
existing proposal diff. They carry no version chip, because they never received a version number.

**Download honours the existing rules** — `?versionId=` serves any version, and a 履歴書 offers
`.docx` only.

**A download can be refused, so it is a button and not a link.** Every download re-checks the facts
its version cites, and a version citing a fact that is now Private, now Generated provenance, or no
longer accepted comes back `409` (`docs/07` §7). A link would land that refusal in a browser tab as
JSON, so the control fetches and states the refusal in a small dialog over the screen: the server's
sentence, then one line per fact id in the mono IDENTIFIER role (case preserved, `docs/05` §2) with its reason, then `A document obeys your record as
it is today, not as it was when this version was accepted. Change the fact in your record, or edit
the block out into a new version.` `Escape` or a click outside closes it; the button returns to its
label and nothing has been downloaded. The same control and the same dialog serve the download on
Screen 1 and Screen 2 (issue #17).

### Restore

**Restore is never a button on a row.** The action is `Compare`, which opens the preview; the
commit lives there. Replacing a document with one the author may not remember, in one click, is the
failure mode this screen exists to prevent.

**The preview is Screen 2's split view**, read-only, with three differences:

- Columns read **Current** `v<n>` and **Restoring** `v<m>` — the current version is *before*, the
  target is *after*, so the diff reads as the change the commit will make.
- The toolbar, rationale bar and per-change navigation behave as specced. A change's rationale is
  the fact behind the *target* version's text.
- The guide line under the toolbar (#56) reads `Left is your document as it stands. Right is the
  version you would restore. Read the highlighted changes, then cancel or restore.`
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

- **No editing here — the editor is its own screen.** This screen reads versions and restores
  them; `Edit` is a link to Screen 6 and nothing on this one is typeable. The earlier rule said
  the hand-edit route stays API-only "until the editing surface gets its own specification", and
  the reason it gave for keeping a textarea off this screen — the route's attribution warnings
  would have nowhere to land — is what Screen 6 §Saved answers.
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
| **Restore refused — the target cites a fact that can no longer be rendered** | The server's `422` in place, listing the fact ids in the mono IDENTIFIER role (`docs/05` §2) and the reason per id (unknown · not accepted · Private · Generated). Stated as a dead end with a route out — fix the fact, or restore a different version — never as a retry |
| **Restore succeeded** | Return to the history with the new version at the top, marked `Current`, its ancestry line reading `Restored from v<m>` |
| **Staleness after a restore** | Screen 3 may now report the document as stale where it did not before. This is correct and is not an error state — the content moved back to an older era of the record |

---

## Screen 6 — Edit a version

**Added 2026-09-12** (issue #18). S16. The hand-edit route landed on 2026-09-11 and Screen 5
deliberately refused to host it; this is the surface it was waiting for.

**Purpose.** Change the current version of one document by hand and save the change as a new
version. It is the only place in the app where the author's own sentence enters a render, and the
only place a block citing a fact that can no longer be rendered can be edited out.

**Interaction model:** a **focused task** — no sidebar, like fact review and diff review. There is
unsaved work on this screen, and a nav row that discards it on a click is the failure mode.

Reached from `Edit` on the current-version row of Screen 5. Route: `/renders/:kind/edit`.

**It always edits the current version.** The route refuses an edit made against any other
(`docs/07` §7), so the screen never asks which version it is editing; it reads the current one and
says so in the header.

### Layout

| Region | Spec |
|---|---|
| Header (46px) | Title `<render name> · editing v<n>` · contextual note `Saving creates v<n+1>. v<n> stays readable and downloadable.` in `text-dimmer` · right: `Cancel` (secondary) and `Save as v<n+1>` (primary) |
| Content column | `max-width 940px`, centred. One `Panel` per section, newest-to-oldest order untouched — the document's own order is the only order |
| Block text | Capped at the long-form reading measure, **740px**. Its controls sit in the gutter to the right of that measure |

**Japanese render names and Japanese block text use the mixed font stack**, as everywhere a render
is shown.

### The section

A section is its **heading**, editable inline, and its blocks. Section `key` is never shown and
never editable: it is how the builder finds a section (`PROSE_SECTION_KEYS` for 履歴書), and an
author cannot be asked to preserve a value they are not shown.

**Sections are not added or removed on this screen.** A section is a property of the render's
shape, not of one version of it.

**A section with no blocks disappears from the document and keeps its heading.** Both builders skip
an empty section (`src/render/markdown.ts`, `src/render/docx.ts`), so emptying one is a legal way
to drop a section from the output without losing the ability to refill it. The panel states this
where it happens, rather than leaving a heading that looks broken: `This section is empty and will
not appear in the document.`

### The block

| Part | Spec |
|---|---|
| Text | Inline `contenteditable`, not a boxed input — the fact-claim control of `05-design-system.md` §7, at the render body size. Commits on blur |
| Kind | A bullet shows its `•`; a paragraph shows nothing. The kind is not a control |
| Citations | Below the text: each cited fact id in the mono IDENTIFIER role (`05` §2), each with a bare `×` labelled `Remove citation`. A block citing nothing shows nothing |
| Controls (gutter) | `Move up` · `Move down` · `Delete`, all bare. Each is absent, not disabled, where it cannot apply — the first block has no `Move up` |

**`Escape` inside a block's text abandons that block's uncommitted change** and restores the text
as it was when focus entered. Every other screen commits on blur with no way back; here a block is
the unit of work and it needs one.

### What an edit may change, and what it may not

- **Text, freely.** What a hand-typed sentence *says* is not checkable by any code — the author is
  the discloser, and a check that pretended otherwise would read as a guarantee it is not.
- **Structure, freely within a section.** A block added, deleted, or moved up and down. This is the
  S16 acceptance verbatim, and both real hand edits were structural.
- **A block does not move between sections.** Moving it changes which employer heading it sits
  under, which changes what the document claims about whose work it was. Deleting it and typing it
  where it belongs is one action longer and says what happened.
- **Citations are removed, never added.** Removal is the stated way out of a version citing a fact
  that has since gone Private, Generated or un-accepted (Screen 5, `docs/07` §7). Adding is a fact
  picker, which S16 does not ask for and which an empty `factIds` list makes unnecessary: empty is
  legal by construction. **A hand-typed block therefore cites nothing**, which is the honest
  reading of it — it is the author's sentence, not a fact's.
- **New blocks are paragraphs or bullets.** `row` is a legal kind that no generator produces and
  that both builders render as a paragraph; it is not offered. An existing `row` block is edited as
  prose and keeps its kind.
- **Block ids are never the client's to choose.** An id is a handle on a block's history and the
  diff addresses blocks by it. A new block carries a client-local key that the server discards and
  replaces (`src/render/edit.ts`).

### 履歴書 only — the same caveat as Screen 5

`Editing changes the summary text only — the education, employment and qualification tables always
reflect your record as it is now.` Stated below the header, for the same reason Screen 5 states it:
without the line the screen promises a document it does not produce.

### Saving

`Save as v<n+1>` is **disabled with its reason stated** (`05` §6) until the draft differs from the
loaded version. Sameness is decided by `sameContent` from `src/render/edit.ts` — **the client
imports the server's own comparison** rather than writing a second one, so "That edit changes
nothing" cannot mean two different things on the two sides of the request.

`Cancel` with unsaved work asks in place — `Discard your changes?` with `Discard` and
`Keep editing`. With no unsaved work it returns to the version history without asking.

### Saved

**This is where the route's attribution warnings land**, and the reason the editor is a screen
rather than a control on Screen 5.

`POST /api/renders/:kind/versions` returns `201` with `warnings`: a fact filed to no employer
sitting under an employer heading, a fact filed to a different employer than its heading names, a
heading naming no employer in the record. They are **advisory and never refusals** — an author
restructuring a section by hand may be right where the checker is wrong (`docs/07` §7).

- **No warnings:** the work is done and there is nothing to say. Go to the version history, where
  the new version is at the top marked `Current`, its ancestry line reading `Edited from v<n>`.
- **Warnings:** stay, and replace the editor with a saved panel — `Saved as v<n+1>.`, then
  `Worth checking:` and one line per warning, then `Back to version history` (primary) and a
  `Download v<n+1>` control. The version is already saved and nothing here can undo it; the panel
  informs, it does not ask.

### States

| State | Behaviour |
|---|---|
| **Loading** | Panel skeletons. The header shows the render name and waits for the version number rather than rendering `v0` |
| **Not generated yet** | `This document has not been generated yet.` — the Screen 5 sentence, because reaching the editor for a render with no current version is the same nothing. The action is `Go to version history` rather than a second `Generate`: generation belongs on the screen that reads what it produced, and a second copy of that control is a second place to keep right |
| **Refused — a proposal is waiting** | The server's `409` in the footer, naming the proposal and linking to it. The author decides the proposal first. The draft is **kept**: nothing was saved, and discarding the author's typing to report someone else's proposal would be the second loss |
| **Refused — the version moved underneath** | The server's `409`, with `Reload and edit again` as the action. The draft cannot be carried across: it was made against a document that no longer exists as current |
| **Refused — a block cites a fact that can no longer be rendered** | The server's `422` in the footer, then the way out: `Remove the citation, or delete the block, and save again.` **The blocks citing those ids are marked in place** — amber, which is "not usable yet" (`05` §1) and not a generic warning — so the author reads the refusal and sees where it lives. The ids are listed under the message, in the mono IDENTIFIER role with the reason per id (unknown · not accepted · Private · Generated), **only when there are two or more**: with one fact the server's own sentence already names it, and repeating it says the same thing twice. With two or more the message names the first plus `(and N others)`, so the list is the only place the rest are said |
| **Refused — the edit empties the document** | Prevented rather than reported: `Save` is disabled, stating `An edit cannot empty the document.` |

---

## Screen 7 — Skills

S9 (added 2026-09-13). The skills section of the English résumé and the 職務経歴書's 活かせるスキル・経験
come from here once the author has curated anything. **Nothing on this screen is typed as a skill**:
every name is a technology some accepted fact or certification already carries (`04`
`skill_curations`), and the screen only chooses, groups and orders them.

Sidebar chrome, with a `Skills` row under `Record`. Header title `Skills`, contextual note
`Chosen from the technologies your facts and certifications name`.

**Intro** (Shared chrome, #56): `Which technologies your documents list, and in what order. Every
name comes from an accepted fact or a certification; nothing is typed here.` Then
`Next: add a group on the left, then add skills to it from the candidates on the right.` while
nothing is curated, and `Next: nothing is waiting here. Every change saves at once.` once something
is. Absent in the `No candidates` state, which says the same thing itself.

### Layout

Two panels side by side, each half the content width.

**Curated** (left). One block per group, in order. A group heading is its name, editable in place,
with `↑` `↓` to move the group and nothing else. Beneath it, one row per skill: the name, a
right-aligned mono count (`4 FACTS`, or `CERT` when only a certification names it), then `↑` `↓`
and `Remove`. `↑` is disabled on the first row and `↓` on the last, stating why. Below the last
group, a name field and `Add group`.

**Candidates** (right). Every candidate not yet curated, most facts first, then by name. Each row:
the name, the same mono count, and an `Add to` select listing the groups. The select is disabled
with a stated reason while no group exists.

### The stale skill

A curated skill that no accepted, render-eligible fact and no certification names any longer is
**flagged and kept**: its row carries an amber dot and `IN NO FACT` in place of the count, and it
keeps its position. It does not reach a render — a document may not name a technology no fact
states — but the author's choice is not undone by the record changing underneath it. `Remove` is
the only way it leaves.

### Rules

- **Saving is immediate**, as it is on Screen 4. Every change sends the whole curated list; there is
  no draft and no `Save`.
- A group exists on the server only while it holds a skill. A group just added holds none, and
  reads `Add a skill to keep this group.` beneath its heading until one arrives; leaving the screen
  first discards it.
- Removing a group's last skill removes the group.
- One curated list serves every render with a skills section. There is no per-render setting here.

### States

| State | Behaviour |
|---|---|
| **Loading** | Panel skeletons |
| **Could not be read** | Both panels replaced by one line: the server's reason for a refusal, or `The server could not be reached.`, with a ghost `Retry` beside it that reads again. While it reads the Loading state returns. Only a first read shows this. |
| **Could not refresh** | Both panels stay on screen. A later read that fails puts one dim line above them, `Could not refresh:` then the same reason then `What is shown may be out of date.`, as a status rather than an alert, with a ghost `Retry` beside it that is disabled (`Retrying…`) while it reads. The line goes when a read succeeds |
| **No candidates** | Both panels replaced by one: `No skills yet. They come from the technologies named on accepted facts and on certifications.` |
| **Not curated** | Curated panel reads `Not curated. Documents list the technologies their facts name.` above the `Add group` field. This is the default and not an error |
| **Save refused** | The server's `422` beneath the panel that caused it. The list re-reads from the server, so what is shown is what is stored |

---

## Screen 8 — Documents

Added 2026-09-15. Every file the record's facts are quoted from, with every version of it. This is
where a re-import starts (Flow 4) and where an import the author walked away from is found again.
Source text never appears here; the screen shows names, dates and counts.

Sidebar chrome, reached from the `Documents` row at `/documents`. The row carries the total of
candidates waiting across every version, written out as `N facts to sort` (`N facts to review` until
2026-10-08) and shown only when it is above zero (Shared chrome). Header title
`Documents`, contextual note `The files your facts are quoted from`, and on the right the same
`Import a document` primary Screen 3 has. That button always creates a **new** document, and it
offers the project and employer choice Screen 3 describes, under the same rule: only when the record
holds a project or an employer to offer.

### Layout

**Intro** (Shared chrome, #56), at the top of the content column: `Every file you have imported,
and every version of it. Importing reads a file and finds candidate facts in it; nothing enters
your record until you review them.` Then the `Next:` line, the first of these that applies:

| State | `Next:` |
|---|---|
| No documents | `Next: import your first document.` |
| A version is being read | `Next: <filename> is still being read. You can start reviewing the facts found so far.` |
| Facts are waiting | `Next: N facts are waiting for you. Press Review on a row marked to review.` |
| Otherwise | `Next: nothing is waiting. Import another document, or go Home to generate a document from your record.` |

Under it, one line at the smaller role in `text-dim` saying what the counts on each row mean:
`accepted: in your record · rejected: set aside and never used · to review: waiting for your
decision`. It is absent with no documents.

One block per source document, the most recently imported first. Content column `max-width 940px`,
centred, as on Screen 3. Nothing collapses: a document's versions are always listed under it.

**The document row.** Filename in a mono chip · project name, or `No project` in `text-dimmer`,
then ` · ` and the employer's name when the document has one ·
mono `N versions` · `last imported <relative time>` · amber mono `N to review` when any version of
it has candidates waiting · right: `Re-import` (ghost).

**The version rows**, newest first, indented beneath it:

| Part | Spec |
|---|---|
| Version | Mono `v3` |
| When | `imported <date>` |
| Size | Mono `N words` |
| Change | `15% changed` from `changed_region_share`, or `first import` when it is null. Removed text counts as changed, so a version that only deletes passages reads its real share, never `0%` |
| Outcome | By status, below |
| Action | By status, below |

| Status | Outcome | Action |
|---|---|---|
| `queued` · `extracting` | `Reading…` on the row, and the extraction progress block (Shared chrome) under it, across the row's width. Its last sentence here is `Press Review to start on the facts already found.` | `Review`, into Fact Review, which renders incrementally |
| `ready` | `N accepted · N rejected · N to review` at the small role in `text-secondary`, in sentence case and not as an uppercase mono label; the to-review count is amber and 500 when above zero | `Review` |
| `ready` with `changed_region_share` of `0` | `No changes · nothing to review`. The share is `0` only when the text is identical | None |
| `failed` | The stored `import_error` reason, in the error tone | `Retry` (ghost), which is `POST /api/imports/:id/retry` |

`Review` opens Fact Review for **that** version. An older version's candidates stay waiting after
a newer version exists, and they are decided there as on any import.

### Re-import

`Re-import` opens a file picker restricted to the types that import, the same list the empty state
names. Choosing a file does not upload it. The row first shows one confirmation line:
`This becomes v4 of <filename>`, with `Import` (primary) and `Cancel`. When the chosen file's name
differs, a second line reads `The file is named <chosen name>. The document keeps its name.`
`Import` sends `POST /api/imports` with this document's `sourceDocumentId` and opens Fact Review on
the new version, as Flow 4 describes.

- **No project select.** The document keeps the project it was imported under, or stays under none.
  The project is stored on the document, not the version, so a re-import has nothing to decide. A
  `projectId` sent with a re-import anyway is **ignored, not refused**: the client never sends one,
  and an error for a field no screen offers would be an error the author could not act on
- **A different filename or type is accepted.** The document's `filename` and `mime_type` do not
  change, so every earlier breadcrumb still names the same document.
- **Refused while the newest version is `queued` or `extracting`.** The button is disabled with the
  reason `Wait for v3 to finish extracting.` The server refuses the same case at `409`, because the
  diff baseline would still be incomplete.
- **Allowed after a `failed` newest version.** Its text was stored before extraction began, so the
  baseline exists.
- **Identical content is still stored as a version** and reads `No changes · nothing to review`.
  An unchanged re-import is a success with zero candidates (Flow 4, `11` §2.6), not a failure and
  not a refusal.

### Re-extract · specified, not built

No button exists until a second extractor version does. The only extractor today is `plaintext-1`,
and re-running it can only reproduce the same text. This section fixes the behaviour before anyone
needs it.

- `Re-extract` (ghost) appears beside `Re-import` only when the document's newest version carries an
  `extractor_version` other than the current one, and that version is not `queued` or `extracting`.
- It creates a **new** version from the newest version's `original_bytes`, run through the current
  extractor. Nothing is uploaded and the confirmation line reads
  `This becomes v4 of <filename>, read by <extractor version>`.
- The new version is diffed against the newest one like any re-import, so only passages the new
  extractor emits differently reach the model.
- The old version is untouched. Its text, its offsets and the facts quoted from it stay exactly as
  they were verified (`03` §5.1).

### Rules

- **Review state is derived from facts, never stored.** `N to review` is the count of that version's
  facts still in `candidate`. Finishing a review writes nothing, so an abandoned review and an open
  one are the same thing and read the same way.
- Nothing on this screen deletes. Source document versions are never deleted (`04` §3.6).

### States

| State | Behaviour |
|---|---|
| **Loading** | Skeleton document blocks |
| **Could not be read** | The list replaced by one line: the server's reason for a refusal, or `The server could not be reached.`, with a ghost `Retry` beside it that reads again. While it reads the skeleton returns. Only a first read shows this. |
| **Could not refresh** | The list stays on screen. A later read that fails, such as a poll while an import runs, puts one dim line above it, `Could not refresh:` then the same reason then `What is shown may be out of date.`, as a status rather than an alert, with a ghost `Retry` beside it that is disabled (`Retrying…`) while it reads. The line goes when a read succeeds |
| **No documents** | The list is replaced by Screen 3's empty-state drop target, **the same component**, so the types it names cannot drift |
| **Re-import refused** | The server's `409` or `422` reason beneath the document row. The list re-reads from the server |
| **Retry refused** | The server's reason beneath the version row |

---

## Screen 9 — Flagged

Added 2026-10-08 (issue #57). What replaced accepting facts one at a time: the list of the facts the
importer thinks are worth a look, each with its reason. **Nothing on it waits on the author.** A
flagged fact is already in the record and stays there whatever is done here.

Sidebar chrome, at `/flagged`. Header title `Flagged`, note `Facts worth a look, each with the
reason`. Content column as Screen 3.

### Layout

1. **The screen intro** (Shared chrome). Body: `Facts are accepted into your record as they are
   imported. The ones listed here are the ones worth checking, and each says why. A flagged fact
   stays in your record whatever you do here.` `Next:` is `open one when you want to check it.
   Nothing here is waiting on you.`, or `nothing is flagged.` Legend: `Explain this asks the AI to
   say more about one flag. It is the only button here that uses the AI, and only when you press it.`
2. **Two pills:** `To check N` and `Checked N`.
3. **One panel a kind that has any**, in this order, headed with the kind's label and its count, and
   under the heading one sentence saying what the kind means for the fact:

| Kind | Label | What the panel says |
|---|---|---|
| `confidential` | `Kept private` | `These look like they name a client, a person or an internal system. Each is stored Private, so no document uses it. To use one, open it and change who may read it.` |
| `unsure` | `Not sure` | `The importer was not confident in these. Each is kept in your record; the reason says what it doubted.` |
| `repeat` | `Likely a repeat` | `These likely say again what another fact in your record already says. Both are kept; open one to see the pair, and reject one if they are the same.` |
| `number` | `States a number` | `A wrong number on a résumé is costly. These can already be used; check the number when you want to.` |

### The row

- The fact's claim, at the claim size in `text-strong`.
- A mono line, `<provenance> · <disclosure>`, and a link `Open it in <filename>, line N` to that
  fact on Screen 1. A fact with no source document has no link.
- **The flag:** its label as a mono chip (`private` tone for `Kept private`, `text-dim` otherwise)
  and **its reason, always**, as a sentence. A flag with no reason cannot be stored (`04` §3.13).
- **`Explain this`** (ghost). Pressing it makes one model call and puts a few plain sentences under
  the reason, behind a left rule in `border-strong`. While it runs it reads `Explaining…`. Once an
  explanation exists the button is gone and the text is shown on every later read, here and on the
  fact's card. **Nothing on this screen calls the model except this press.**
- **`Mark as checked`** (ghost). The row leaves the list. Under `Checked` the same button reads
  `Put back on the list`.

### Rules

- **Checking a flag changes nothing about the fact.** A `Kept private` fact is still Private after
  its flag is checked. Making it usable is done on the fact, one at a time.
- **No "mark all checked", and no bulk un-Private.** A list cleared unread was not checked.
- **A flag is never required.** No document and no step on Home waits on this list.
- **No source text.** A row shows the claim and where it was read, never the passage; the passage is
  one click away, on the card.
- A rejected fact's flags are not listed; undoing the rejection brings them back.

### States

| State | Behaviour |
|---|---|
| **Loading** | `Loading the list…` |
| **Nothing flagged** | One panel: `Nothing is flagged. Facts that need a look appear here as documents are imported.` Under `Checked`: `Nothing is marked as checked yet.` |
| **Explain failed** | A line under the row, in the removed tone: the explanation could not be written, try again. The flag and its reason are unchanged and the button is still there |
| **Read failed** | The shared read failure, with retry. A refresh that fails over a list already shown keeps the list and says so above it |

---

## Screen 10 — Master document

Added 2026-10-08 (issue #57). Everything in the record in one long readable piece: every accepted
fact from every imported document, **Private and Generated ones included**, under the employer and
project it belongs to. Every résumé is written from this.

**There is one per language** (2026-10-10, #59), and both are this one view. The language decides
what the record is *called*: an employer, a role, a project, a school and a certification each by
the name a document of that language uses (the renders' own rule, `nameInLanguage`), the section
headings, and how a month is written. **It never decides what a fact says.** A claim reads as it was
written in the document it was imported from, in both, because turning it into the other language
is a model's work and no model writes this.

**It is a view.** It is built from the record each time it is opened, by no model, and stored
nowhere (`07` §9). It cannot be edited here, and there is no second copy to fall out of step: a fact
is changed on its own card.

Sidebar chrome, at `/master`. Header title `Master document`, note `Everything in your record, in
one place`, and on the right, once the record holds anything the page lists, the note `The file includes
Private facts. It is your copy.` and **`Download .md`**.

### Layout

0. **The tabs `English` and `日本語`**, the tab list of Screen 3's documents section and the same
   stored choice: the one open on Home is the one open here, and choosing here changes it there.
   Everything under the intro is the tab's panel.
1. **The screen intro.** Body: `Every fact you have accepted, from every document you imported,
   including the ones a résumé leaves out. Your résumé and your career story are written from this.`
   (under `日本語`: `Your 履歴書, 職務経歴書 and 職務経歴ストーリー are written from this.`) `It is
   built from your record each time you open it, so it cannot be edited here: change a fact on its
   own card. The tabs change the names and headings to the ones a document of that language uses;
   each fact reads as it was written, and none is translated.`
   Legend: `Private facts and Generated facts are listed here and marked. No résumé uses them.`
2. **One line of counts:** `N facts: N a document may use, N Private, N Generated.` Then, when any,
   `N flagged to check` as a link to Screen 9, and `N more are waiting to be sorted and are not
   listed yet. Sort them from Home.`
3. **One panel an employer**, headed with its name in the document's language, and its name in the
   other language in brackets when the record holds both. Under it: its period to the month and its industry, its roles with
   their periods, then each project as a sub-heading with its summary and its facts, then the facts
   filed under the employer and no project, under `Other work here` when there are projects above.
4. **`Work outside employment`**, for projects and facts under no employer.
5. **`Education`** and **`Certifications`**, each a list, when the record holds any.

**Under `日本語` the document's own words are Japanese**, on the page and in the file, from one
table (`MASTER_WORDS` in `src/shared/master-document.ts`):

| English | 日本語 |
|---|---|
| `Work outside employment` | `雇用外の活動` |
| `Other work here` | `その他の業務` |
| `Not filed under a project` | `プロジェクト未分類` |
| `Education` | `学歴` |
| `Certifications` | `資格` |
| `No facts filed here yet.` | `まだ事実がありません。` |
| `2022-04 to present` | `2022年4月〜現在` |
| `graduated`, `completed`, `withdrawn`, `expected` | `卒業`, `修了`, `中退`, `卒業見込み` |
| `issued 2019-06` | `2019年6月取得` |

The intro, the count line and the header stay English, as the application's own chrome is on every
screen. `Measured`, `Attested`, `Generated`, `Public`, `Restricted`, `Private` and `Flagged` stay as
they are in both: they are the words on the fact card, and a second word for each would be a second
vocabulary.

### The fact

The claim, then one mono line: its Worth (`Measured` in the measured tone, `Generated` in the
generated tone), its Who (`Private` in the private tone), `Flagged` when a flag is open on it, and
its document and line as a link to that fact on Screen 1. **A Private or Generated fact's claim is
set in `text-dim`**: it is here, and it is not what a résumé is written from.

### Rules

- **Everything accepted is listed, and nothing else.** A rejected fact is not, and a fact still
  waiting to be sorted is not yet; the count line says how many.
- **The download is the page**, as Markdown, **Private facts included**, by the owner's decision
  (`docs/06`, 2026-10-08). The page says so beside the button and the file says so in its first
  lines, with an instruction not to send it to an employer.
- **No source text**, on the page or in the file. A fact names its document and line.
- **Month precision.** A period is `2022-04 to 2024-09`, or `2022年4月〜2024年9月`; the day is never
  shown.
- **Nothing is translated.** The two documents hold the same facts with the same claims. Only the
  record's names, the headings and the dates differ.
- **`Download .md` saves the file of the tab that is open**, `master-document-en-<date>.md` or
  `master-document-ja-<date>.md`. The 日本語 file opens with the same two warnings in Japanese, and
  says that the claims are in the language they were written in.

### States

| State | Behaviour |
|---|---|
| **Loading** | `Building the master document…`, again on the first visit to the other tab |
| **Nothing to list** (no accepted fact, employer, project, education or certification) | The intro's `Next:` reads `import a document. Its facts appear here.` No Download |
| **An employer or project with no fact** | Listed, with `No facts filed here yet.` |
| **Download failed** | The reason replaces the note beside the button; the button stays |

---

## Screen 11 — Tailored résumés

**Replaced by Screens 12 to 14** (decided 2026-10-10, #60; retired by #70). The screen, its sidebar
row and Home's `Tailored résumés` section are gone. Existing tailored résumés appear on their
application pages, under **Résumé for this job**; their generation, review, history and download
still use Screens 2, 5 and 6. Making a new tailored résumé from an application belongs to #71. Its
Rules outlive it: they are the rules of the tailored résumé made from an application (Screen 14).

### Rules

- **The job description is never a source of facts.** It reaches the model as text to read, and the
  résumé is written from the facts alone. A requirement the record does not meet is not written in.
- **It is given exactly the facts the main résumé is given.** No Private fact, no Generated fact.
  Tailoring chooses and orders; it does not widen what may be used.
- **A refusal to generate leaves the résumé stored**, on its application, to generate later.
- **Screens 2, 5 and 6 serve a tailored résumé unchanged**, addressed by its id where a main
  document is addressed by its kind. Their titles carry the résumé's name.

---

## Screens 12 to 15 — Applications

Specified 2026-10-11 (issues #60 and #69; decision log, that date). Not built yet: each part names
the issue that builds it. Every job the author is looking at or has applied for, each with its job
description, the résumé sent, where it stands and how the interviews went (`02` §3a, S20 to S24).

**What all four share:**

- **Sidebar chrome, under `/applications`**: the list at `/applications`, adding a job at
  `/applications/new`, one application at `/applications/<id>`, a sent copy under its application.
  Everything under that prefix, and nothing else, works at phone width (Responsive behaviour).
- **Screens 13 to 15 keep the sidebar and put a breadcrumb in the header**, `Applications / <title>`,
  with `Applications` linking to Screen 12. They are not the focused two-pane screens, which drop
  the sidebar.
- **A status has no colour of its own** (`05` §9, rule 9). An open application past Not applied
  shows its status with the `accent` dot and text. Not applied, Rejected and Withdrawn are
  `text-muted` with a muted dot. No green, no amber, no red, anywhere on these screens.
- **Dates are days**, written `2026-10-02`, in mono where they stand alone. A count is `1 day` or
  `N days`, of calendar days. This is the one place a day is shown (decision log, 2026-10-11).
- **What a change is.** Each application keeps one last-activity timestamp, set when it is added
  and when the owner changes its record: setting, closing, reopening or undoing a status; adding
  or correcting a step or close date; adding or editing an interview entry; choosing a document
  or recording a sent copy; editing the job fields; attaching or removing a recording. Event dates
  do not stand in for this timestamp. The list order, last-change count and **gone quiet** use it.
  Gone quiet is 14 days or more since that activity while the status is Applied, Résumé passed or
  one of the three interviews and it is not closed. The mark is worked out on each read and stored
  nowhere. The résumé-passed and first-interview counts use their event dates. This specification
  governs where the prototype derives last change from event dates.
- **A short confirmation after an action is one line with `role="status"`**, at the foot of the
  content column, which leaves by itself: `Saved as Not applied.`, `Date corrected. The day counts
  follow it.`, `Undone.` A status change is said in the panel instead, where its Undo is.
- **No text of a job description, a company, a position, an interviewer or a question is logged**
  (`AGENTS.md`), and the list is served without job description text, as the tailored listing is.

### Screen 12 — Applications · built by #70

Header title `Applications`, note `Jobs, the résumé sent for each, and how it went`, and on the
right **`Add a job`** (primary), to Screen 13.

**Layout**

1. **The screen intro.** Body: `Every job you are looking at or have applied for. Each one keeps
   its job description, the résumé you sent, where it stands and how the interviews went.` `Next:`
   is `add the first job you are looking at.` with none; `N applications have gone quiet. Follow
   up, or close them as rejected or withdrawn.` (`1 application has`) when any is gone quiet;
   otherwise `nothing is waiting here. Add a job, or open one to note how an interview went.`
2. **The filter**, a group labelled `Show`: pressed-state pills, each with its count: `All`, `Not
   applied`, `Applied`, `Résumé passed`, `Interviews` (the three interview steps together),
   `Offer`, `Rejected`, `Withdrawn`. A closed application counts under Rejected or Withdrawn and
   not under the step it had reached. Then a rule, and **`Gone quiet N`**, a toggle that narrows
   whichever status is chosen; choosing `All` clears it.
3. **One panel, one row an application, newest last change first.** The whole row is one button
   that opens Screen 14.
4. **One line under the panel**, `text-muted`: `Newest activity first. Gone quiet means nothing has
   changed for 14 days while you are waiting to hear back. Nothing is emailed and nothing is sent
   to anyone.`

**The row**

- Left: the company at the row-title size; the position under it in `text-muted`; then one line of
  small items: **the résumé** and the two figures.
  - The résumé reads `<title> v<N>` for the latest sent copy of each document, joined with ` + `
    (`履歴書 v4 + 職務経歴書 v6`); earlier copies of the same document are on the application page
    only. With documents chosen and nothing sent, the same followed by `, not sent`; with none,
    `No résumé yet`.
  - `N days since the résumé passed` and `N days since the first interview`, each only when that
    step has a date and the application is not closed.
- Right: the status, then **either** the chip `Gone quiet · N days` (chip surface, `border-active`,
  `text-strong`, weight 500) **or** `Last change N days ago` (`today`, `1 day ago`) in
  `text-muted`.
- A closed application's row is set wholly in `text-muted`; its list position still follows last
  activity, including later edits to its record.

**States**

| State | Behaviour |
|---|---|
| **Loading** | The header and intro at once; `Loading your applications…` in the panel |
| **None yet** | In place of the filter and panel, a dashed block: heading `No applications yet`; `Paste a job description to start. The company, the position and the key requirements are read out of it for you to check. After that the application holds the résumé you send, each step and its date, and a note of every interview.`; **`Add a job`** (primary); and `A job description is kept with its application. It is never a source of facts about you.` Until #73 the second sentence reads `Type in the company and the position.` |
| **The filter matches none** | `No application matches.` and the link `Show all` |
| **Could not load** | The reason in the panel, with `Try again` |

### Screen 13 — Add a job · built by #70 by hand, #73 adds the reading

Header `Applications / Add a job`. Two steps on one screen. **Nothing is saved until `Save
application`.**

**Step 1, the text.** Intro: `Paste the job description. The company, the position and the key
requirements are read out of it, and you check them before anything is saved.` `Next:` `paste the
text of the posting below.` Panel `New application`:

- `Job description`, a twelve-row text area, placeholder `Paste the posting here.` At most 20,000
  characters.
- `Link to the posting, if you have one`, a URL field, placeholder `https://`. It is only stored;
  nothing is fetched from it.
- `It is kept with this application and is never a source of facts about you.`, then `Cancel` (bare,
  to Screen 12) and **`Read it`** (primary).
- While it is read, the two fields are read-only and the actions give way to a `role="status"`
  line with the working dot: `Reading the job description. This takes a few seconds.`

**Step 2, the check.** Intro: `This is what was read from the job description. Correct anything
that is wrong, then save.` `Next:` `check the three fields, then save the application.` Panel
`Check what was read`, with `Back to the text` (bare) in its header, which keeps what was typed:

- `Company` and `Position`, side by side, each a text field.
- `Key requirements`: one text field a requirement with `Remove` (bare) beside it, and **`Add a
  requirement`** (ghost) under them. With none: `None found. Add the ones that matter to you, or
  leave this empty.` An empty requirement is dropped on save.
- `Link: <the link>` when one was given.
- `Saved as Not applied. You choose its résumé next.`, then `Cancel` and **`Save application`**
  (primary). Saving opens Screen 14 and says `Saved as Not applied.`

**Rules**

- **What was read is a proposal.** Every field is editable, and the model's output goes nowhere
  but these fields (decision log, 2026-10-11).
- **Until #73 there is no reading.** #70 builds one step: the job description and the link, then
  Company, Position and Key requirements to type, then `Save application`. The intro's first
  sentence reads `Paste the job description and type in the company and the position.` #73 splits
  it into the two steps above and changes nothing about what is saved.
- **A failed or empty reading is the hand-typed path**, not a dead end: Step 2 opens with the
  fields empty.

**States**

| State | Behaviour |
|---|---|
| **Text missing or under 40 characters** | `Paste the job description first. A few lines is enough.` under the actions, `role="alert"`, in the `removed` tone |
| **Text over 20,000 characters** | `Read it` is refused with the limit and the length named |
| **Company and position not found** | Step 2 with both fields empty, placeholder `Not found in the text. Type it in.`, and `Next:` `the company and the position could not be found in the text. Type them in, then save.` |
| **The reading failed** | Step 2 as above, with one line above the fields: `The job description could not be read just now. Type the fields in; your text is kept.` |
| **Saving without a company or a position** | `Give it a company and a position first.` |
| **Save failed** | The reason under the actions; nothing typed is lost |

### Screen 14 — One application · built by #70, with #71, #72, #74, #76 and #77

Header `Applications / <company>`. The content column, top to bottom:

1. **The head.** The company as a Page heading, the position under it, then one line: the
   status, the chip `Gone quiet · N days` when it applies, and `Open the posting` when a link was
   given, which opens it in a new tab.
2. **`Next:`**, one line, the first that applies:

   | When | It reads |
   |---|---|
   | Closed | `this application is closed. Reopen it if that changes.` |
   | Gone quiet | `nothing has changed for N days. Follow up, or close it as rejected or withdrawn.` |
   | Not applied, no document | `choose the résumé for this job: make a tailored one, or use a document you already have.` |
   | Not applied, with a document | `when you have sent it, move this to Applied. The résumé is frozen as sent at that moment.` |
   | Offer | `nothing is waiting here.` |
   | An interview step | `after the next interview, add how it went while you still remember it.` |
   | Applied, Résumé passed | `wait to hear back. When you do, move it to the next step.` |

3. Five panels: `Where it stands`, `Résumé for this job`, `Interviews`, `The job`, `Practise for
   this job`.

#### Where it stands · #70

**The seven steps as an ordered list**, left to right, joined by a line: a 10px node, the step's
name, and its date under it. Steps before the current one have a filled `accent` node and line. The
current one has a ringed node and its name in `text-bright` at weight 600, unless the application
is closed, when it is drawn as one already passed. Steps not reached are plain.

Under each step reached:

- **Its date, as a button** titled `Correct this date`. Not applied reads `added <date>`, the day
  the application was added.
- **`skipped`** in `text-muted` and `add a date` (bare) for a step that was passed over.
- Pressing either opens, in place, a date field (no later than today), `Save` (ghost) and `Cancel`
  (bare). Saving says `Date corrected. The day counts follow it.`; saving a date that
  was not changed closes the field and says nothing. A sent copy frozen on the Applied
  date follows a correction of that date.

**Three figures**, as tiles, the number in the Stat value role (`05` §2) with `days` small beside it:

| Tile | Label | When it has no number |
|---|---|---|
| Since the résumé passed | `since the résumé passed` | `–` in `text-ghost`, labelled `since the résumé passed: not reached, or no date` |
| Since the first interview | `since the first interview` | `–`, labelled `since the first interview: not reached, or no date` |
| Since the last change | `since the last change`, and while waiting to hear back `since the last change. Gone quiet at 14` | Always has one, counted from last activity. Closed, it is labelled `since it was closed` and counted from the close date, even if its record changed later |

**The controls, open:**

- **`Move to <the next step>`** (primary). Absent at Offer.
- `or set`, and a select `another step…` listing every other step, earlier ones included.
- Right: **`Mark as rejected`** and **`Withdraw`** (both ghost).
- Under them: `A step saves today's date when you set it, and you can correct the date afterwards.
  A step you never went through can be skipped.` At Not applied with documents that have no sent
  copy yet it adds `It also freezes <title> v<N> and <title> v<N> as sent.`, naming those.

**After a change**, a notice inside the panel, `role="status"`: `Moved to <step>. Date saved as
<date>.`, with `<title> v<N> was frozen as sent.` (`were`, for several) when the move froze
documents, or `Marked as rejected. Date saved as <date>.` On its right `Change the date` and
**`Undo`** (both bare). Undo puts back the status, the dates and, if the move froze them, the sent
copies, and says `Undone.` It is offered for the last change only, until the application is left.

**The controls, closed:** one notice, `Rejected on <date>, after <step>.` (`Withdrawn on`), the date
a button to correct it, and **`Reopen`** (ghost), which returns the application to that step and
says `Reopened at <step>.`

**Rules**

- **Any step can be set from any other.** Setting an earlier step leaves the later ones not
  reached and without a date on the screen; sent copies stay.
- **A step set saves today's date**, a step skipped over saves none.
- **Moving from Not applied to any later step freezes every document on the application that has
  no sent copy yet** (#71). One that already has a copy, after a move back, is not frozen again by
  the move; `Record another sent copy` is for that.
- **Closing is not a step.** It keeps the step reached, and the list counts the application under
  Rejected or Withdrawn.

#### Résumé for this job · #71

**With no document, at Not applied**, two cards side by side:

- **`Make a tailored résumé`**: `Written for this job from the same facts as your main résumé. The
  job description decides what leads and what is left out; it never adds a claim that is not in
  your record. You read it as a set of changes before it becomes a version. English only for now.`
  and the button of that name (primary).
- **`Use a document you already have`**: `Tick the ones you are sending. A Japanese application
  usually sends 履歴書 and 職務経歴書 together.` Three ticks, `Main résumé`, `履歴書`, `職務経歴書`,
  each noted `<English|日本語> · version N, the one current today`, and **`Use the ticked
  documents`** (secondary).

**With documents**, a row each:

- The title, `Tailored résumé for <company>` for a tailored one. Under it `Version N · written for
  this job`, or `Version N · the same document as on Home`.
- `History` (Screen 5) and `Download` (the current version), as links; `Regenerate` (ghost) on a
  tailored one; and before Applied, `Take off` (bare), which removes the document from the
  application and deletes nothing.
- Under the rows: `Make a tailored résumé` (ghost) while there is none, and `Add a document you
  already have`, which from Applied onward is replaced by **`Record another sent copy`**. Either
  opens the tick card in place, with `Cancel`. From Applied onward the card lists every document
  the owner could have sent: the three, whether or not they are on the application or were sent
  before, and the application's tailored résumé when it has one, as a fourth tick.

**`What you sent`**, under a rule, once anything is frozen: `A frozen copy is the file exactly as it
was on the day. It does not change when the résumé or your record changes later.` A row for every
copy, earlier copies of the same document included, most recently recorded first: the title, the chip `vN · frozen`,
`Sent <date>`, and the links `Read it` (Screen 15) and `Download`.

**Rules**

- **Making a tailored résumé is the 2026-10-08 flow, started here.** It stores the résumé from this
  application's job description, generates, and opens Diff Review (Screen 2, unchanged, titled with
  the résumé's name). Accept or Reject returns here. Screens 5 and 6 serve it as they did. Screen
  11's Rules hold word for word.
- **An application holds at most one tailored résumé**, and any of the three documents beside it.
- **Freezing takes the file as generated at that moment** and stores it (decision log, 2026-10-11).
  The stored file is never changed: a sent copy has no edit, no regenerate and no remove of its
  own. Its sent date follows a correction of the Applied date when that move froze it, and Undo of
  that move removes the copies it froze (Status).
- **Copies are frozen at two moments and no other.** The move out of Not applied freezes the
  documents that have no sent copy yet (Status). From Applied onward, **`Record another sent copy`** freezes each ticked
  document as a further sent copy, dated today, and says `<title> v<N> frozen as sent today.` It
  takes any document: one not yet on the application, which is added to it; one already sent, the
  same one again; or a tailored résumé made after Applied.
- **Recording a copy never compares anything.** The application does not work out whether a
  document has changed since it was sent, and says nothing about it; a ticked document is always
  frozen, and the owner decides what was sent. Each copy remains in `What you sent` with its own
  date, including earlier copies of the same document.
- **Each copy carries the time it was recorded, and `latest` means most recently recorded.** The
  sent date can be corrected and does not order copies; the list row and `What you sent` both go
  by the recorded time.
- **`Download` on a sent copy returns the stored file**, never a fresh one.

**States**

| State | Behaviour |
|---|---|
| **A document with no version yet** | Listed in the tick card, cannot be ticked, noted `No version yet. Generate it from Home first.` |
| **Applied or later, nothing frozen** | `No sent copy is recorded. Use “Record another sent copy” to add one.` |
| **Applied or later, no document at all** | `No résumé is recorded for this application.` above the same two buttons |
| **Generating refused** (no usable fact, a missing profile field) | The reason Screen 3 gives, in the same words; the tailored résumé stays on the application to generate later |
| **Freezing failed** | The move to Applied is not made, and the reason is said in the panel. A status that says Applied with nothing kept would be the wrong half to save |

#### Interviews · #72, recordings #74 and #76

Panel header **`Add an interview`** (ghost). One card an interview entry, newest date first:

- One line: the round at the row-title size, the date in mono, and `with <who>` when given.
- How it went, as a paragraph in `text-body`.
- `Questions asked`, then the questions as a numbered list.
- Its recordings, a row each, then **`Attach a recording`** (ghost).

**The form**, a card titled `New interview`, opened at the top of the panel:

- `Date`, no later than today, today by default. `Round`: `First interview`, `Second interview`,
  `Final interview`, `Other conversation`, set by default to the earliest round at or after the
  status that has no entry yet, or `Other conversation`.
- `Who you spoke with`, placeholder `Names or roles. Kept only here.`
- `How it went`, four rows, placeholder `What it was like, what landed, what you would answer
  differently.`
- `Questions asked`: the list so far, each with `Remove` (bare), then a field, placeholder `One
  question, then Enter`, and `Add` (ghost). `Pasting several lines adds them all at once.` A
  leading bullet or number on a pasted line is dropped.
- `A recording is attached after you save, from the interview's own card.`
- **`Save interview`** (primary) and `Cancel`. What is in the question field is added on save.

**Rules**

- **An entry needs how it went or at least one question**: `Write how it went, or add at least one
  question.`
- **Saving an entry for a later round moves the status** to that round with the entry's date, when
  the application is open and the round is not `Other conversation`. It is said where a status
  change is said: `Interview saved, and the status moved to <step> to match. Date saved as <date>.`
  with `Change the date` and `Undo`. Undo puts the status back and keeps the entry. Otherwise it
  says `Interview saved.`
- **Each question is its own item, in the order given.**
- **No model reads an entry or writes one.**

**A recording row**

| Kind | Reads | Actions |
|---|---|---|
| Uploaded audio | chip `Audio`, the file's name, `46 MB · 52 min · uploaded <date> · only you can play it` | `Play` (ghost; plays in the page, with seeking), `Download`, `Remove` |
| Link | chip `Link`, its label or `Recording kept elsewhere`, the address under it, wrapping anywhere | `Open` (a new tab), `Remove` |
| Removed | `A recording was removed on <date>.` in `text-muted` | None |

**`Attach a recording`** opens a card in place:

- **`Upload audio`** (secondary; #76), **`Add a link instead`** (ghost; #74) and `Cancel`. Under
  them: `Audio, up to <the limit> a file. It is stored privately and only you, signed in, can play
  it. Other people's voices are on it, so nothing here shares it or sends it anywhere.` **Until #76
  the card is the link form alone.**
- **The link form:** `Link to the recording` (placeholder `https://`), `What it is, in a few words`
  (placeholder `Their recording of the call`), `Only the link is kept. If the recording is taken
  down where it lives, it is gone here too.`, **`Add the link`** (secondary) and `Cancel`. Saved,
  it says `Link added.`
- **Uploading**, a `role="status"` row: `Uploading <name>`, the progress bar of `05` §7, and `N of
  M MB. Keep this page open.` Done, it says `Recording uploaded.`

**`Remove` asks once, in place of the row**, as an alert dialog: `Remove <name> for good?`, then
for a file `The file is deleted from storage and cannot be brought back.` and for a link `Only the
link is removed; the recording stays where it lives.`, then `The interview keeps a line saying one
was removed.` **`Remove it`** (secondary) and `Keep it` (bare). Removed, it says `Recording removed.`

**Recording rules**

- **Audio only.** No video, and no transcript (decision log, 2026-10-11). The prototype's `Upload
  audio or video`, its `Video` chip and its `2 GB` are not the spec; #76 sets the size and type
  limits and writes them into the sentence above.
- **A link is `http` or `https`**, or it is refused: `That does not look like a link. It should
  start with https://`
- **Only the owner, signed in, can play or download an upload.** Nothing here shares one.
- **A recording is the only thing on these screens that can be removed.** An entry cannot, and an
  application cannot.

**States**

| State | Behaviour |
|---|---|
| **No entries** | `None yet. After each one, note the date, who you spoke with, how it went and the questions they asked.` |
| **File too large, or not audio** | Refused before anything is sent, with the file's name, its size or type, and the limit |
| **Upload interrupted** | The row says so with `Try again`; nothing is listed as a recording |

#### The job · #70

Header **`Edit`** (ghost), which opens the Company, Position and Key requirements fields of Screen
13 in place. A definition list: `Company`, `Position`, `Posting` (the link, when given), `Key
requirements` as a list or `None noted`. Under it a disclosure, closed by default: `The full job
description, as you pasted it`, the text as compact Document body in `text-body` with its line
breaks kept.

**The job description is not edited after saving.** A tailored résumé may have been written from
it, and it is what the application was for.

#### Practise for this job · #77

`Suburi, your interview practice app, can take a job description as the role for a practice round.
Nothing is sent to it from here: you carry the file or the text across yourself.` Then:

- **`Download the job description (.txt)`** (ghost): a text file holding the job description and
  nothing else.
- **`Copy the N questions asked`** (ghost): every question from every interview entry of this
  application, one a line, oldest interview first. With none: `Questions asked show up here once an
  interview has some.`

**Nothing connects the two apps** (`AGENTS.md`). These are two pieces of text in the author's
hands.

### Screen 15 — A sent copy · built by #71

Header `Applications / <company> / <title> as sent`. Read-only.

1. **One notice:** the chip `vN · frozen`, then `Sent to <company> on <date>. This is the file as
   it was that day. It cannot be edited, and later changes to the résumé or to your record do not
   reach it.` On its right **`Download`** (ghost), the stored file, and `Back to the application`
   (bare).
2. **The document**, as it was sent, at the reading measure: the name and contact line it carried
   that day, then its sections. A 履歴書 or 職務経歴書 is set with the Japanese stack.

There is no edit, no history and no regenerate here. Another user's copy, or one asked for under
another application, is a 404.

### What the prototype leaves open

Named so that nobody reads an unwired button as a decision.

- **`Play`, every `Download`, `History`, `Open` and `Edit` are stand-ins** in the prototype. Their
  behaviour is what this document says.
- **Its tailored-résumé screen is a stand-in for Screen 2**, and stacks the two columns at phone
  width. That is not a decision about Screen 2 (Responsive behaviour).
- **Correcting an interview entry after saving** is not shown. #72 settles it; until it is
  specified here, an entry is saved once.
- **`Prototype only:` controls** (the sample postings, the sample file) and the bar above the frame
  are not part of any screen.

---

## Screens not yet designed

Needed before their milestones; not blocking M1.

| Screen | Milestone | Note |
|---|---|---|
| Profile form | M2 | 履歴書 identity fields incl. PII. **Field list is now fixed** — see `04-database-schema.md` §4 |
| Quick capture | M3 | Two sentences in, short interrogation, Attested facts out |

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

### Applications at phone width · specified 2026-10-11, built by #75

**The one exception** (decision log, 2026-10-11). Screens 12 to 15, everything under
`/applications`, are not behind the wider-window message. Every other route keeps it under 1024px.
Designed at **390px**; the prototype's `Phone` width is the reference.

Under **720px** of width these screens change as follows, and above it they are the desktop layout:

| Part | At phone width |
|---|---|
| Sidebar | Hidden. The header gains **`Menu`** (ghost, `aria-expanded`), first in the header |
| Menu | A sheet under the header: `Applications` first and active, then the other rows; the sentence `On a phone, Applications is the part that works. The other screens still ask for a wider window.`; then the Theme control |
| Header | 12px side padding; the contextual note is not shown |
| Content column | `16px 12px` padding, 16px between blocks |
| List row (Screen 12) | The status and the gone-quiet chip move under the text, left-aligned |
| Steps | A vertical list: the node and line down the left, the name, the date on the line under it |
| Figures, side-by-side cards, paired fields | One column |
| Document and sent-copy rows | Their links move under the text, left-aligned |
| The job's definition list | One column, the term above its value |
| Buttons | Primary, secondary and ghost are at least 36px tall |

**Nothing scrolls sideways** at 390px, in either theme, with Japanese company and position names.

**Screens 2, 5 and 6 are not Applications screens and keep the message.** So on a phone `Make a
tailored résumé`, `Regenerate` and `History` lead to a screen that asks for a wider window. #75
settles what those three controls do at phone width (say so beside them, or hold them back with the
reason); it does not make Diff Review a phone screen.
