# 05 — Design System

**Status:** Phase 3 · written 2026-08-12 · extracted from `design/prototype/` · light theme, contrast floor and rendered Markdown added 2026-10-05 (issue #56)

The dark values here were taken **from the prototype**, not invented. Where the prototype was
inconsistent, this document picks one value and that value wins — the prototype is a visual
reference, this file is the contract. The light values have no prototype behind them: they were
chosen for this document on 2026-10-05 and are held to the contrast floor in §1.

**Reference products:** [Linear](https://linear.app) is the sole aesthetic reference.
[Grammarly's editor](https://grammarly.com) supplies the fact-review interaction model.
[GitHub pull-request review, split view](https://github.com) supplies the diff-review model.

**Theme: light by default, dark as an option** (issue #56, decision log 2026-10-05). The prototype
is dark only and the first build followed it. The author's first real import found it too dark to
read, so the light theme is now the one a new browser gets and dark is a choice.

- **One set of token names, two sets of values.** A screen never names a theme. It names `bg`,
  `text-dim` or `measured`, and the value under that name changes with the theme. A colour that
  exists in one theme and not the other is a defect.
- **The choice is the author's, per browser.** `data-theme="dark"` on `<html>` selects dark; its
  absence is light. It is kept in `localStorage` under `track-record:theme`, not in the record, and
  the operating system's preference is not read: the default is light for everyone until they say
  otherwise. The attribute is set before first paint, so a dark reader never sees a light flash.
- **The control** is a two-segment `Light` / `Dark` control in the sidebar footer (`10` Shared
  chrome).

---

## 1. Color

Every table gives the light value first, because light is the default.

### Surfaces

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#ffffff` | `#08090a` | Page background, document reading pane |
| `surface` | `#f7f8fa` | `#0a0b0c` | Header, sidebar, side rail, footer |
| `surface-raised` | `#f3f4f7` | `#0d0e10` | Panels, stat tiles, segmented-control track |
| `card` | `#ffffff` | `#101113` | Default card |
| `card-selected` | `#f4f5fe` | `#13141a` | Selected card (neutral state only) |
| `card-recessed` | `#eef0f3` | `#0b0c0d` | Private cards, resolved cards |
| `chip` | `#eceef2` | `#131416` | Inline chips, file badges, icon tiles |
| `hover` | `#e8eaee` | `#17181b` | Hover fill on ghost controls and rows |
| `disabled-bg` | `#eef0f3` | `#141518` | Disabled button fill |
| `progress-track` | `#dfe2e7` | `#1c1d20` | Progress bar track |

### Borders

| Token | Light | Dark | Use |
|---|---|---|---|
| `border` | `#dcdfe5` | `#1a1b1e` | Primary divider — panel edges, column split |
| `border-subtle` | `#e9ebef` | `#141517` | Internal dividers inside a surface |
| `border-inner` | `#e4e6eb` | `#17181b` | Row separators inside a panel |
| `border-control` | `#c9ced6` | `#1f2023` | Inputs, chips, segmented-control track |
| `border-strong` | `#b9bfc9` | `#232427` | Ghost button border, scrollbar thumb |
| `border-active` | `#9aa1ad` | `#2c2e33` | Active filter/toggle border |
| `border-dashed` | `#b3b9c4` | `#26282c` | Empty-state drop target (1px dashed) |

### Text

| Token | Light | Dark | Use |
|---|---|---|---|
| `text-bright` | `#0d0e12` | `#f2f3f5` | Headings, selected mark text, stat values |
| `text` | `#1a1c21` | `#e8e8ea` | Default body text in chrome |
| `text-strong` | `#22252b` | `#e2e4e7` | Card claims, row titles |
| `text-secondary` | `#383c45` | `#c9ccd1` | Hover text, secondary button label |
| `text-body` | `#2e3138` | `#c4c8ce` | Long-form document body |
| `text-muted` | `#4a4f59` | `#a6abb4` | Ghost button label, helper text |
| `text-dim` | `#525762` | `#9da2ab` | Section labels, descriptions |
| `text-dimmer` | `#595e69` | `#9398a2` | Metadata, timestamps |
| `text-faint` | `#5f6470` | `#8a8f99` | Tertiary notes, control labels |
| `text-ghost` | `#8a909b` | `#5d6169` | Disabled rows, empty-row labels, zero counts |
| `on-accent` | `#ffffff` | `#ffffff` | Text on an `accent` fill. Never `text-bright`, which is near-black in light |

**Every text token from `text-bright` down to `text-faint` reads at 4.5:1 or better on every surface
in the table above, in both themes.** That is WCAG AA for body text, and it is checked by
`npm run lint` rather than remembered (§8b). The dark values of `text-body` through `text-faint`
were raised on 2026-10-05 to meet it: `text-dimmer` and `text-faint` had measured 3.4:1 and 2.7:1,
and they carried the chunk counts and status labels the author could not read. `text-ghost` is the
one exception. It is for a disabled row or a zero, which says "nothing here", and it is never the
only carrier of information.

**Opacity is not a text colour.** A surface that dims its text by lowering `opacity` drops below the
ratio above without any token changing, so a resolved or dismissed item is carried by its surface,
its text token and a strikethrough, not by transparency.

### Accent and semantics

| Token | Light | Dark | Use |
|---|---|---|---|
| `accent` | `#5e6ad2` | `#5e6ad2` | Primary buttons, Attested tone, selection, progress |
| `accent-text` | `#3f4bb3` | `#a3abf0` | Accent text on a surface (status text, draft badge) |
| `accent-link` | `#4450bd` → `#323c9c` hover | `#8b93e8` → `#a8afef` hover | Links |
| `accent-gradient` | `linear-gradient(160deg,#5e6ad2,#3d4699)` | same | App mark only |
| `measured` | `#1f8a55` | `#4cb782` | Measured provenance, accepted, up-to-date, diff additions |
| `measured-text` | `#146c43` | `#5ec99a` | Measured label text |
| `generated` | `#b97a14` | `#e0a851` | Generated provenance, "needs promotion" |
| `generated-text` | `#7d5207` | `#d1ab6e` | Generated warning body text |
| `generated-claim` | `#6b5a36` | `#b3ab97` | A Generated claim, set italic |
| `removed` | `#b3363c` | `#e07a7f` | Diff removals, refusals and failures said in place |
| `restricted` | `#374c6e` on `rgba(84,110,150,.16)` | `#a6b3c6` on `rgba(126,146,178,.16)` | Restricted disclosure |
| `private` | `#33373f` on `#dfe2e7` | `#cfd2d6` on `#2b2d31` | Private disclosure |

**Semantic rule that must not be broken:** green means *verified or added*, amber means *not usable
yet*, red means *removed*. Never use green for a generic success toast or amber for a generic
warning — those colors carry provenance meaning in this product.

### Selection and marks

`accent` is `94,106,210` in both themes. The tone bases differ by theme: measured is `31,138,85`
light and `76,183,130` dark, generated `185,122,20` and `224,168,81`, removed `179,54,60` and
`194,90,95`. A tint is a fraction of its base, and the fraction is slightly higher on white, where a
7% wash disappears.

| Mark | Light | Dark |
|---|---|---|
| Text selection | `rgba(accent,.25)` | `rgba(accent,.35)` |
| Source mark, idle | `rgba(accent,.10)`, `border-bottom 1px solid rgba(accent,.55)` | `rgba(accent,.07)`, rule `.40` |
| Source mark, selected | `rgba(accent,.24)`, glow (§5), text `text-bright` | `rgba(accent,.26)`, glow, text `text-bright` |
| Generated mark | `1px dashed rgba(generated,.75)` on `rgba(generated,.10)` | `1px dashed rgba(generated,.6)` on `.07` |
| Private mark | `1px dotted #8a909b` on `rgba(13,14,18,.05)`, text `#555a64` | `1px dotted #4a4d53` on `rgba(255,255,255,.04)`, text `#9a9fa8` |
| Rejected mark | no border, `line-through` in `#9aa1ad`, text `text-faint` | `line-through` in `#3a3d42`, text `text-faint` |
| Diff add | `rgba(measured,.13)` idle → `.28` selected; row tint `.06` | `.11` → `.26`; row `.05` |
| Diff remove | `rgba(removed,.11)` idle → `.26` selected; row tint `.05` | the same fractions |

---

## 2. Typography

**Family (Latin):** `"Geist", system-ui, -apple-system, sans-serif`
**Family (mixed JA/EN):** `"Geist", "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic Medium", "Yu Gothic", "Meiryo", system-ui, sans-serif`
**Family (mono):** `"Geist Mono", ui-monospace, monospace`

Weights in use: **400, 500, 600** only. `-webkit-font-smoothing: antialiased` globally.

**Any surface that can contain Japanese must use the mixed stack** — that includes every render
preview, every fact claim, and every document title. Geist has no Japanese coverage; without the
fallback the browser picks one for you and the result is inconsistent between screens.

| Role | Size / line-height / weight | Tracking |
|---|---|---|
| Document title (reading pane) | 22px / 1.25 / 600 | `-.02em` |
| Page heading | 19px / 1.3 / 600 | `-.02em` |
| Stat value | 23px / 1.1 / 500 | `-.02em` |
| Render section heading (in output) | 11px / 1 / 600, uppercase | `.08em` |
| Panel heading | 12.5px / 1.3 / 600 | `-.01em` |
| Row title | 13px / 1.3 / 500 | — |
| Card claim | 13px / 1.55 / 400 | — |
| Document body (comfortable) | 14.5px / 1.78 / 400 | — |
| Document body (compact) | 13.5px / 1.72 / 400 | — |
| Render body / bullet | 13.5px / 1.68 / 400 | — |
| UI default | 13px / 1.4 / 400 | — |
| Small | 11.5px / 1.5 / 400 | — |
| Smaller | 11px / 1.55 / 400 | — |
| Button label | 12px / 1.4 / 500 | — |
| Micro | 11px / 1.4 / 500 | — |
| Mono label (uppercase) | 11px / 1 / 400–500 | `.05em` |
| Mono identifier (case preserved) | 11px / 1.55 / 400 | — |

**Nothing is set below 11px.** The mono label was 9.5px and the micro role 10.5px until 2026-10-05.
At those sizes, in the two dimmest text tokens, they were the chunk counts and status labels the
author reported as unreadable (issue #56). Size and contrast were both short, so both moved.

**Mono is for machine facts only** — line references, counts, file names, timestamps, version ids,
status labels. Never for prose.

**A mono LABEL and a mono IDENTIFIER are two roles, not one with a variant.** The label is uppercase
by definition, which is right for `EDITED BY HAND` and destructive for a fact id — an id is
case-sensitive, so uppercasing it displays a string that matches nothing in the record. Anywhere an
id is shown for the author to act on, it takes the identifier role: case preserved, no
letter-spacing, set at the body size around it rather than the 9.5px label size, and `select-all` so
one click takes the whole id. `v3` and similar short version tags stay labels; they carry no case to
lose.

**Long-form reading measure: `max-width: 740px`**, centred. Renders and source documents both.

`text-wrap: pretty` on every prose block.

### Rendered Markdown

A source document written in Markdown is shown rendered (`10` Screen 1). Its elements take roles
already in the table above, so a rendered document adds one size and no colour.

| Element | Spec |
|---|---|
| Heading 1 | Document title role, 22px / 1.25 / 600, `text-bright` |
| Heading 2 | Page heading role, 19px / 1.3 / 600, `text-bright`, with a `border-subtle` rule under it |
| Heading 3 | **16px / 1.4 / 600**, `text-bright`. The one size this section adds |
| Heading 4 to 6 | Document body size, 600, `text-strong` |
| Paragraph, list item | Document body role, `text-body` |
| List | `disc` or `decimal` markers, `20px` indent, `4px` between items |
| Strong / emphasis / strikethrough | 600 / italic / `line-through`, in the surrounding colour |
| Inline code | Mono on `chip`, `radius-chip`, at `.92em` of the text it sits in, so it stays in proportion inside a heading or a card |
| Code block | Mono at the compact body size on `chip`, `radius-chip`, `10px 12px` padding. It scrolls sideways rather than wrapping |
| Blockquote | A `border-strong` left rule, `12px` in, `text-secondary` |
| Table | Compact body size. `border` cell rules, `6px 10px` cell padding, header row on `surface-raised` at 600. A wide table scrolls sideways inside the measure |
| Rule | A `border` line with `20px` above and below |
| Link | `accent-link`, underlined, **not followed**: see below |

**Space between blocks is `14px`**, with `26px` above a heading 1 or 2 and `20px` above a heading 3.

**The rendered view loads and runs nothing.** A link is shown and not navigable, its address in the
`title`. An image is shown as its alt text. Raw HTML is shown as the text it is. A source document
holds internal addresses, and a reading pane that fetches an image or follows a link sends one out.

---

## 3. Spacing

**Scale: 2 · 4 · 6 · 8 · 10 · 12 · 14 · 16 · 20 · 26 · 32 · 40 · 60** (px)

The prototype drifted to odd values (9, 11, 13, 15, 22, 34, 44). **Round to the scale.** Nothing
off-scale ships.

Common applications:
- Card padding: `12px 14px` (comfortable), `10px 12px` (compact)
- Panel padding: `14px 16px`
- Rail padding: `10px`
- Reading-pane padding: `40px 20px`
- Gap between cards: `8px`
- Header height: **46px**. Sub-toolbar height: **38px**. Pane label strip: **34px**
- Sidebar width: **212px**. Fact rail width: **412px** comfortable / **380px** compact
- Contents column, beside a rendered document: **212px**, the sidebar's width and the same token
- Label column, where a row aligns its notes behind a word: **80px**. The longest label
  this has to hold is `Generated` at 13px/medium, which measures 67.33px; 60px broke it
  mid-word (issue #9). Composed from the scale, 40 + 40
- Form control height: **36px**, the height a text input takes from `text-ui` (13px / 1.4) with
  `8px` vertical padding and a 1px border. A native `<select>` gets it as a minimum height, because
  Chrome sets its line height to `normal` whatever the class says and it measured 33px beside 36px
  inputs. Composed from the scale, 26 + 10
- Inline control height: **28px**, for a control that stands in a card's label rows beside a
  segmented control rather than in a form. The segmented track measures 28.70px, from 2px of
  padding and a 1px border around a 22.70px segment; 28px is the value on the scale under it and
  the 0.7px does not read. Composed from the scale, 14 + 14

---

## 4. Radius

| Token | Value | Use |
|---|---|---|
| `radius-mark` | `2px` | Inline text marks, legend swatches |
| `radius-chip` | `4px` | Chips, segmented-control segments, badges |
| `radius-control` | `6px` | Buttons, inputs, nav rows |
| `radius-tile` | `8px` | Cards, icon tiles |
| `radius-panel` | `10px` | Panels, stat groups, empty-state box |
| `radius-full` | `50%` | Avatar, bullet dot |

---

## 5. Elevation

Only three, and two of them are rings rather than shadows.

| Level | Light | Dark |
|---|---|---|
| **Ring (active control)** | `inset 0 0 0 1px rgba(13,14,18,.12)` | `inset 0 0 0 1px rgba(255,255,255,.06)` |
| **Ring (selected item)** | `0 0 0 1px rgba(<tone>,.5)` | the same. Tone = accent, measured, generated, removed, or `#6c7078` for private |
| **Lifted (selected card)** | `0 0 0 1px rgba(<tone>,.4), 0 10px 26px rgba(13,14,18,.12)` | `0 0 0 1px rgba(<tone>,.18), 0 10px 26px rgba(0,0,0,.5)` |
| **Glow (selected source mark)** | `0 0 0 1px rgba(<tone>,.55), 0 0 22px rgba(<tone>,.2)` | `0 0 0 1px rgba(<tone>,.5), 0 0 22px rgba(<tone>,.18)` |

No other shadows. No drop shadows on static surfaces.

---

## 6. Buttons

Height comes from padding; no fixed heights. Colours are named by token, so each variant is right
in both themes.

| Variant | Default | Hover | Disabled |
|---|---|---|---|
| **Primary** | `bg accent` · `color on-accent` · no border · `6px 12px` · `radius 6px` · button label, `500 12px` | `filter: brightness(1.1)` | `bg disabled-bg` · `color text-faint` · `border 1px solid border-control` · `cursor: not-allowed` |
| **Secondary** | `transparent` · `border 1px solid border-strong` · `color text-secondary` · `8px 14px` · button label | `bg hover` | same as primary disabled |
| **Ghost** | `transparent` · `border 1px solid border-strong` · `color text-muted` · `6px 10px` · `500 11.5px` | `bg hover` · `color text-secondary` | — |
| **Bare** | `transparent` · no border · `color text-dim` · `4px 6px` | `bg border` · `color text-secondary` | — |
| **Icon** | `24×22px` · `border 1px solid border-strong` · `radius 5px` · `color text-muted` | `bg hover` · `color text-secondary` | — |

**A disabled primary must state why.** Every disabled action in the prototype carries a `title`
or an adjacent hint (`Needs promotion`). Disabled without a reason is not permitted.

---

## 7. Controls

**Segmented control** (provenance, disclosure, filters):
- Track: `bg surface-raised` · `border 1px solid border-control` · `radius 6px` · `padding 2px` · `gap 2px`
- Segment: `padding 4px 8px` · `radius 4px` · micro, `500 11px` · no border
- Inactive: `transparent` / `color text-dim`; hover `color text-secondary`
- Active: background and foreground come from the **semantic tone of that value** (see §1), plus the active-control ring (§5)
- Transition: `background .12s ease, color .12s ease`

**Editable text (fact claim)** — inline `contenteditable`, not a boxed input:
- Rest: no border, `padding 2px 4px`, `margin-left -4px`, `radius 6px`, `cursor: text`
- Focus: the private-mark wash (§1) · the active-control ring (§5) · no outline
- Commits on blur

**Filter pill:** `padding 4px 8px` · `radius 6px` · active `bg hover` + `border 1px solid border-active` + `color text-secondary`; inactive transparent + `color text-dim`.

**Progress bar:** track `progress-track`, `radius 2px`; fill `accent`, `transition: width .25s ease`.
Two heights: **4px** inline, where it sits in a row beside a count, and **8px** in the extraction
progress block below.

**Extraction progress** (issue #56). The block shown wherever the author waits for a document to be
read (`10` Shared chrome). On `surface-raised` with a `border-control` edge and `radius-tile`,
`12px 14px` padding:

1. A row: the working indicator (§8), a title at the row-title role in `text-strong`, and the
   percentage right-aligned at the row-title role, 600, `text-bright`, in tabular figures.
2. The 8px bar, full width.
3. One line at the small role in `text-secondary`: the count in plain words, then what the author
   can do meanwhile.

It is a `role="progressbar"` with `aria-valuenow`, and its line is a polite live region, so the wait
is said and not only drawn.

**Scrollbar:** `width 10px`, thumb `border-strong` with a `3px solid bg` border and `radius 6px`, transparent track.

---

## 8. Motion

| Property | Duration |
|---|---|
| Color / background | `.12s ease` |
| Border / box-shadow / opacity | `.14s ease` |
| Button surface | `.15s ease` |
| Progress width | `.25s ease` |
| Scroll-into-view | `behavior: smooth`, target at ~34–40% from top of the pane |

| Working indicator | `1.4s ease-in-out`, looping |

Nothing animates on load. No entrance animations, no spinners longer than the work they represent.

**The working indicator is the one looping animation**, and it exists because of that last rule's
other half: work that takes minutes must look like work. It is a 6px `accent` dot whose opacity
moves between 1 and .35, shown only while an import is `queued` or `extracting` and gone the moment
it is not. Under `prefers-reduced-motion: reduce` it holds still at full opacity, and the words
beside it carry the state.

---

## 8b. How this document is enforced

The rules below are not conventions to remember. Two mechanisms make most of them structural:

**1 · `@theme` with the default theme switched off.** Tailwind v4 accepts `--*: initial` inside
`@theme`, which **disables every default theme variable**. With it set, only the tokens defined from
this document generate utilities — so `bg-red-500`, `p-7` and `rounded-xl` **do not exist**. Rule 1
("no new colors") and rule 7 ("no off-scale spacing or radii") stop being things to check in review.

```css
@theme {
  --*: initial;                    /* nothing survives except what follows */
  --color-bg: #ffffff;             /* the light value; dark overrides it */
  --color-card: #ffffff;
  --color-measured: #1f8a55;
  --spacing: 2px;                  /* the scale in §3 */
  --radius-chip: 4px;
  /* … every value in this document, and nothing else … */
}
```

Namespaces map as: `--color-*` → color utilities · `--spacing-*` → padding, margin, gap, size ·
`--radius-*` → border radius · `--font-*` → family · `--text-*` → size · `--font-weight-*` ·
`--tracking-*` · `--leading-*` · `--shadow-*` · `--breakpoint-*`.

**2 · Arbitrary values are lint-banned.** `--*: initial` closes the named-utility route; `p-[13px]`
and `text-[#ff0000]` are the remaining escape hatch, closed by `scripts/check-design-tokens.mjs`,
which `npm run lint` runs. The same script bans a raw colour literal anywhere outside `theme.css`.

**3 · Both themes are checked, not trusted.** The script reads `theme.css` and fails the build when
a colour token has a value in one theme and not the other, and when a text token falls under 4.5:1
on any surface in either theme (§1). "Higher contrast" is a number the build holds, not a review
comment. `@theme` carries the light values and `:root[data-theme="dark"]` overrides them: a v4
colour utility compiles to `var(--color-…)`, so redefining the variable re-themes every utility
without a `dark:` variant at any call site.

**What stays human-enforced:** rule 5 (three font weights per screen), rule 6 (no emoji), rule 9
(green/amber/red carry provenance meaning and are never decorative), rule 11 (no disabled control
without a stated reason), rule 12 (no confidence scores) and rule 13 (border style carries meaning).
No tool can check those; they are on the manual design-conformance checklist
(`11-testing-plan.md` §3).

---

## 9. The forbidden list

1. **No new colors.** If a state needs a color it does not have, it is reusing the wrong semantic — fix the semantics.
2. **No gradients** except the 16px app mark.
3. **No shadows** beyond the four in §5.
4. **No font other than Geist / Geist Mono**, and the Japanese fallback stack in §2. Never Geist alone on a surface that can hold Japanese.
5. **Never more than three font weights on a screen** (400 / 500 / 600).
6. **No emoji in the interface.**
7. **No off-scale spacing** (§3). No off-scale radii (§4).
8. **No colour that exists in one theme only.** Light is the default and dark is the option; a token with one value is half a theme, and the build refuses it (§8b).
9. **Never use green, amber or red decoratively.** They mean Measured/added, Generated/blocked, and removed.
10. **No character-level diffing on Japanese.** Marks sit on phrase spans. Body copy uses `word-break: normal; line-break: strict; overflow-wrap: break-word`.
11. **No disabled control without a stated reason.**
12. **No confidence scores or model certainty in the UI, as a number or a percentage.** Provenance is the only trust signal (see decision log, 2026-08-12). A percentage that counts work done or text changed, `40% read` or `15% changed`, is a count and is allowed.
13. **No borders on inline marks other than those in §1** — solid = normal, dashed = Generated, dotted = Private. The border style carries meaning.
14. **No text dimmed by `opacity`**, and no text below 11px (§1, §2).
