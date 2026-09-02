# 05 — Design System

**Status:** Phase 3 · written 2026-08-12 · extracted from `design/prototype/`

Every value here was taken **from the prototype**, not invented. Where the prototype was
inconsistent, this document picks one value and that value wins — the prototype is a visual
reference, this file is the contract.

**Reference products:** [Linear](https://linear.app) is the sole aesthetic reference.
[Grammarly's editor](https://grammarly.com) supplies the fact-review interaction model.
[GitHub pull-request review, split view](https://github.com) supplies the diff-review model.

**Theme: dark only.** The prototype has no light mode and v1 does not add one.

---

## 1. Color

### Surfaces

| Token | Hex | Use |
|---|---|---|
| `bg` | `#08090a` | Page background, document reading pane |
| `surface` | `#0a0b0c` | Header, sidebar, side rail, footer |
| `surface-raised` | `#0d0e10` | Panels, stat tiles, segmented-control track |
| `card` | `#101113` | Default card |
| `card-selected` | `#13141a` | Selected card (neutral state only) |
| `card-recessed` | `#0b0c0d` | Private cards, resolved cards |
| `chip` | `#131416` | Inline chips, file badges, icon tiles |
| `hover` | `#17181b` | Hover fill on ghost controls and rows |

### Borders

| Token | Hex | Use |
|---|---|---|
| `border` | `#1a1b1e` | Primary divider — panel edges, column split |
| `border-subtle` | `#141517` | Internal dividers inside a surface |
| `border-inner` | `#17181b` | Row separators inside a panel |
| `border-control` | `#1f2023` | Inputs, chips, segmented-control track |
| `border-strong` | `#232427` | Ghost button border, scrollbar thumb |
| `border-active` | `#2c2e33` | Active filter/toggle border |
| `border-dashed` | `#26282c` | Empty-state drop target (1px dashed) |

### Text

| Token | Hex | Use |
|---|---|---|
| `text-bright` | `#f2f3f5` | Headings, selected mark text, stat values |
| `text` | `#e8e8ea` | Default body text in chrome |
| `text-strong` | `#e2e4e7` | Card claims, row titles |
| `text-secondary` | `#c9ccd1` | Hover text, secondary button label |
| `text-body` | `#a8acb3` | Long-form document body |
| `text-muted` | `#8a8f98` | Ghost button label, helper text |
| `text-dim` | `#7c8189` | Section labels, descriptions |
| `text-dimmer` | `#62666d` | Metadata, timestamps |
| `text-faint` | `#54585e` | Disabled labels, tertiary notes |
| `text-ghost` | `#3c3f45` | Empty-row labels, zero counts |

### Accent and semantics

| Token | Hex | Use |
|---|---|---|
| `accent` | `#5e6ad2` | Primary buttons, Attested tone, selection, progress |
| `accent-text` | `#a3abf0` | Accent text on dark (status text, draft badge) |
| `accent-link` | `#8b93e8` → `#a8afef` hover | Links |
| `accent-gradient` | `linear-gradient(160deg,#5e6ad2,#3d4699)` | App mark only |
| `measured` | `#4cb782` | Measured provenance, accepted, up-to-date, diff additions |
| `measured-text` | `#5ec99a` | Measured label text |
| `generated` | `#e0a851` | Generated provenance, "needs promotion" |
| `generated-text` | `#c2a06a` | Generated warning body text |
| `removed` | `#c25a5f` | Diff removals |
| `restricted` | `#a6b3c6` on `rgba(126,146,178,.16)` | Restricted disclosure |
| `private` | `#cfd2d6` on `#2b2d31` | Private disclosure |

**Semantic rule that must not be broken:** green means *verified or added*, amber means *not usable
yet*, red means *removed*. Never use green for a generic success toast or amber for a generic
warning — those colors carry provenance meaning in this product.

### Selection and marks

- Text selection: `rgba(94,106,210,.35)`
- Source mark, idle: `background rgba(accent,.07)`, `border-bottom 1px solid rgba(accent,.40)`
- Source mark, selected: `background rgba(base,.26)`, `box-shadow 0 0 0 1px rgba(base,.5), 0 0 22px rgba(base,.18)`, text `#f2f3f5`
- Generated mark: `1px dashed rgba(224,168,81,.6)` on `rgba(224,168,81,.07)`
- Private mark: `1px dotted #4a4d53` on `rgba(255,255,255,.04)`, text `#8d9198`
- Rejected mark: no border, `line-through` in `#3a3d42`, text `#54585e`
- Diff add: `rgba(76,183,130,.11)` idle → `.26` selected; row tint `.05`
- Diff remove: `rgba(194,90,95,.11)` idle → `.26` selected; row tint `.05`; `line-through` at `rgba(194,90,95,.55)`, 1px

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
| Micro | 10.5px / 1.4 / 500 | — |
| Mono label (uppercase) | 9.5px / 1 / 400–500 | `.05–.07em` |

**Mono is for machine facts only** — line references, counts, file names, timestamps, version ids,
status labels. Never for prose.

**Long-form reading measure: `max-width: 740px`**, centred. Renders and source documents both.

`text-wrap: pretty` on every prose block.

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
- Label column, where a row aligns its notes behind a word: **80px**. The longest label
  this has to hold is `Generated` at 13px/medium, which measures 67.33px; 60px broke it
  mid-word (issue #9). Composed from the scale, 40 + 40

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

| Level | CSS |
|---|---|
| **Ring (active control)** | `inset 0 0 0 1px rgba(255,255,255,.06)` |
| **Ring (selected item)** | `0 0 0 1px rgba(<tone>,.5)` — tone = accent, measured, generated, removed, or `#6c7078` for private |
| **Lifted (selected card)** | `0 0 0 1px rgba(<tone>,.18), 0 10px 26px rgba(0,0,0,.5)` |
| **Glow (selected source mark)** | `0 0 0 1px rgba(<tone>,.5), 0 0 22px rgba(<tone>,.18)` |

No other shadows. No drop shadows on static surfaces.

---

## 6. Buttons

Height comes from padding; no fixed heights.

| Variant | Default | Hover | Disabled |
|---|---|---|---|
| **Primary** | `bg #5e6ad2` · `color #fff` · no border · `6px 11px` · `radius 6px` · `500 12px` | `filter: brightness(1.12)` | `bg #141518` · `color #54585e` · `border 1px solid #1f2023` · `cursor: not-allowed` |
| **Secondary** | `transparent` · `border 1px solid #232427` · `color #c9ccd1` · `7px 13px` | `bg #17181b` | same as primary disabled |
| **Ghost** | `transparent` · `border 1px solid #232427` · `color #8a8f98` · `5px 10px` · `500 11.5px` | `bg #17181b` · `color #c9ccd1` | — |
| **Bare** | `transparent` · no border · `color #7c8189` · `3px 5px` | `bg #1a1b1e` · `color #c9ccd1` | — |
| **Icon** | `24×22px` · `border 1px solid #232427` · `radius 5px` · `color #8a8f98` | `bg #17181b` · `color #c9ccd1` | — |

**A disabled primary must state why.** Every disabled action in the prototype carries a `title`
or an adjacent hint (`Needs promotion`). Disabled without a reason is not permitted.

---

## 7. Controls

**Segmented control** (provenance, disclosure, filters):
- Track: `bg #0d0e10` · `border 1px solid #1f2023` · `radius 6px` · `padding 2px` · `gap 2px`
- Segment: `padding 3px 8px` · `radius 4px` · `500 10.5px` · no border
- Inactive: `transparent` / `color #6d7178`; hover `color #c9ccd1`
- Active: background and foreground come from the **semantic tone of that value** (see §1), plus `inset 0 0 0 1px rgba(255,255,255,.06)`
- Transition: `background .12s ease, color .12s ease`

**Editable text (fact claim)** — inline `contenteditable`, not a boxed input:
- Rest: no border, `padding 2px 4px`, `margin-left -4px`, `radius 5px`, `cursor: text`
- Focus: `bg rgba(255,255,255,.03)` · `inset 0 0 0 1px rgba(255,255,255,.08)` · no outline
- Commits on blur

**Filter pill:** `padding 3px 8px` · `radius 5px` · active `bg #191a1d` + `border 1px solid #2c2e33` + `color #d5d7da`; inactive transparent + `color #6d7178`.

**Progress bar:** track `#1c1d20`, `height 4px`, `radius 3px`; fill `accent`, `transition: width .25s ease`.

**Scrollbar:** `width 10px`, thumb `#232427` with `3px solid #08090a` border and `radius 6px`, transparent track.

---

## 8. Motion

| Property | Duration |
|---|---|
| Color / background | `.12s ease` |
| Border / box-shadow / opacity | `.14s ease` |
| Button surface | `.15s ease` |
| Progress width | `.25s ease` |
| Scroll-into-view | `behavior: smooth`, target at ~34–40% from top of the pane |

Nothing animates on load. No entrance animations, no spinners longer than the work they represent.

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
  --color-bg: #08090a;
  --color-card: #101113;
  --color-measured: #4cb782;
  --spacing: 2px;                  /* the scale in §3 */
  --radius-chip: 4px;
  /* … every value in this document, and nothing else … */
}
```

Namespaces map as: `--color-*` → color utilities · `--spacing-*` → padding, margin, gap, size ·
`--radius-*` → border radius · `--font-*` → family · `--text-*` → size · `--font-weight-*` ·
`--tracking-*` · `--leading-*` · `--shadow-*` · `--breakpoint-*`.

**2 · Arbitrary values are lint-banned.** `--*: initial` closes the named-utility route; `p-[13px]`
and `text-[#ff0000]` are the remaining escape hatch, closed by `no-arbitrary-value` in
`eslint-plugin-tailwindcss` (off by default, and needing tuning for a known false positive on square
brackets in attribute selectors).

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
8. **No light mode** in v1 — do not add half of one.
9. **Never use green, amber or red decoratively.** They mean Measured/added, Generated/blocked, and removed.
10. **No character-level diffing on Japanese.** Marks sit on phrase spans. Body copy uses `word-break: normal; line-break: strict; overflow-wrap: break-word`.
11. **No disabled control without a stated reason.**
12. **No confidence scores, percentages or model certainty in the UI.** Provenance is the only trust signal (see decision log, 2026-08-12).
13. **No borders on inline marks other than those in §1** — solid = normal, dashed = Generated, dotted = Private. The border style carries meaning.
