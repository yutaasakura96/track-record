#!/usr/bin/env node
/**
 * Enforces the two design-system rules a build cannot enforce on its own
 * (`docs/05-design-system.md` §8b, §9).
 *
 *   1. No arbitrary Tailwind values — `p-[13px]`, `text-[#fff]`. `--*: initial`
 *      in `@theme` closes the named-utility route; this closes the remaining
 *      escape hatch.
 *   2. No raw colour literals in client source. Every colour comes from a token,
 *      and the tokens live in exactly one file.
 *   3. `mark-base` declares a `color`. Not a design-system rule but a browser
 *      one: see `checkMarkBase` below.
 *   4. Both themes define every colour, and every text token reads at 4.5:1 on
 *      every surface in each: see `checkThemes` below.
 *
 * Run by `npm run lint`. See docs/06, 2026-08-30, for why this is a script
 * rather than `eslint-plugin-tailwindcss`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const CLIENT = join(ROOT, "src/client");
const THEME = join(CLIENT, "theme.css");

/** `bg-[#fff]`, `p-[13px]`, `w-[calc(100%-2px)]` — a utility with a bracket. */
const ARBITRARY = /(?:^|[\s"'`])(?:-?[a-z][a-z0-9]*(?:-[a-z0-9]+)*)-\[[^\]]+\]/g;
/** `#fff`, `#ff00aa`, `rgb(...)`, `hsl(...)` outside the theme file. */
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/g;

const failures = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(tsx?|css)$/.test(path)) check(path);
  }
}

function check(path) {
  // Comments are prose about the rules, not code that breaks them. Blanked
  // rather than removed, so reported line numbers still point at the file.
  const source = readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/^\s*\/\/.*$/gm, (line) => " ".repeat(line.length));
  const lines = source.split("\n");

  lines.forEach((line, index) => {
    for (const match of line.matchAll(ARBITRARY)) {
      failures.push({
        path,
        line: index + 1,
        rule: "no-arbitrary-value",
        found: match[0].trim(),
        why: "Arbitrary values are how the forbidden list dies. Add a token to theme.css instead.",
      });
    }
    if (path !== THEME) {
      for (const match of line.matchAll(RAW_COLOR)) {
        failures.push({
          path,
          line: index + 1,
          rule: "no-raw-color",
          found: match[0],
          why: "Every colour comes from a token in theme.css. If a state needs a colour it does not have, the semantics are wrong.",
        });
      }
    }
  });
}

/**
 * Chrome's UA stylesheet is `mark { background-color: Mark; color: MarkText }`,
 * and `MarkText` computes to BLACK even with `color-scheme: dark` on the root.
 * Any `<mark>` whose classes set a background but no colour therefore renders
 * black on the near-black page — 1.05:1, and invisible to both of the rules
 * above, because the defect is an OMITTED declaration rather than a wrong one.
 * It cost the whole diff-review screen once (issue #5).
 *
 * The rule checked is deliberately narrow: `mark-base` must declare a `color`.
 * Every `<mark>` in the client carries `mark-base`, so one declaration there
 * makes the UA default unreachable no matter what a variant does or forgets.
 * The broader rule — "every mark-targeting utility declares a colour" — is the
 * wrong shape twice over: it would demand a colour from variants that correctly
 * inherit one (`mark-normal`, `mark-generated`, `mark-accepted`), and it would
 * still miss the plain background utilities the diff pane puts on a `<mark>`
 * (`bg-add-idle`), which are not mark utilities at all.
 */
function checkMarkBase() {
  const source = readFileSync(THEME, "utf8");
  const block = source.match(/@utility\s+mark-base\s*\{([^}]*)\}/);
  if (!block) {
    failures.push({
      path: THEME,
      line: 1,
      rule: "mark-needs-color",
      found: "@utility mark-base",
      why: "The utility every <mark> depends on is gone. Every mark now inherits the UA's black `MarkText`.",
    });
    return;
  }
  if (/(^|;|\{)\s*color\s*:/.test(block[1])) return;
  failures.push({
    path: THEME,
    line: source.slice(0, block.index).split("\n").length,
    rule: "mark-needs-color",
    found: "@utility mark-base { … } declares no color",
    why: "Chrome's `mark { color: MarkText }` computes to black in dark mode. Without a colour here every unstyled mark is black-on-black.",
  });
}

/**
 * The light theme is `@theme`; the dark one is `:root[data-theme="dark"]`
 * redefining the same variables (`docs/05` §1, §8b). Two things can go wrong
 * that no call site would show:
 *
 *   - A colour or shadow defined in one theme only. Half a theme: the token
 *     keeps the other theme's value, which is dark text on a dark surface.
 *   - A text token too faint for a surface. The author's first import found the
 *     dark theme's `text-dimmer` and `text-faint` unreadable, and they measured
 *     3.4:1 and 2.7:1 (issue #56). 4.5:1 is WCAG AA for body text.
 *
 * `text-ghost` is deliberately not in `TEXT`: it is for disabled rows and zeros.
 */
const TEXT = [
  "text-bright",
  "text",
  "text-strong",
  "text-secondary",
  "text-body",
  "text-muted",
  "text-dim",
  "text-dimmer",
  "text-faint",
  "accent-text",
  "accent-link",
  "accent-link-hover",
  "measured-text",
  "generated-text",
  "generated-claim",
  "removed",
  "restricted",
  "private-mark-text",
];
const SURFACES = [
  "bg",
  "surface",
  "surface-raised",
  "card",
  "card-selected",
  "card-recessed",
  "chip",
  "hover",
];
/** Text that sits on one fill of its own rather than on a surface. */
const PAIRS = [
  ["on-accent", "accent"],
  ["private", "private-bg"],
];
const MIN_CONTRAST = 4.5;

function declarations(block) {
  const found = new Map();
  for (const match of block.matchAll(/(--(?:color|shadow)-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    found.set(match[1], match[2].trim());
  }
  return found;
}

function luminance(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [value >> 16, (value >> 8) & 255, value & 255].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

function checkThemes() {
  const source = readFileSync(THEME, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const lightBlock = source.match(/@theme\s*\{([\s\S]*?)\n\}/);
  const darkBlock = source.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);
  if (!lightBlock || !darkBlock) {
    failures.push({
      path: THEME,
      line: 1,
      rule: "two-themes",
      found: lightBlock ? ':root[data-theme="dark"] is missing' : "@theme is missing",
      why: "Light is the default and dark is the option. Both blocks must exist.",
    });
    return;
  }
  const themes = { light: declarations(lightBlock[1]), dark: declarations(darkBlock[1]) };

  for (const [name, other] of [
    ["light", "dark"],
    ["dark", "light"],
  ]) {
    for (const token of themes[name].keys()) {
      if (themes[other].has(token)) continue;
      failures.push({
        path: THEME,
        line: 1,
        rule: "two-themes",
        found: `${token} has a ${name} value and no ${other} one`,
        why: "A colour in one theme only is half a theme (docs/05 §9, rule 8).",
      });
    }
  }

  for (const [name, tokens] of Object.entries(themes)) {
    const pairs = [...TEXT.flatMap((text) => SURFACES.map((surface) => [text, surface])), ...PAIRS];
    for (const [text, surface] of pairs) {
      const fg = tokens.get(`--color-${text}`);
      const bg = tokens.get(`--color-${surface}`);
      if (!/^#[0-9a-f]{6}$/i.test(fg ?? "") || !/^#[0-9a-f]{6}$/i.test(bg ?? "")) {
        failures.push({
          path: THEME,
          line: 1,
          rule: "contrast",
          found: `${name}: ${text} on ${surface} cannot be measured (${fg ?? "missing"} on ${bg ?? "missing"})`,
          why: "A text token and a surface are opaque six-digit hex, so their contrast is a number.",
        });
        continue;
      }
      const ratio = contrast(fg, bg);
      if (ratio >= MIN_CONTRAST) continue;
      failures.push({
        path: THEME,
        line: 1,
        rule: "contrast",
        found: `${name}: ${text} (${fg}) on ${surface} (${bg}) is ${ratio.toFixed(2)}:1`,
        why: `Text reads at ${MIN_CONTRAST}:1 or better on every surface, in both themes (docs/05 §1).`,
      });
    }
  }
}

walk(CLIENT);
checkMarkBase();
checkThemes();

if (failures.length === 0) {
  console.log("design tokens: clean");
  process.exit(0);
}

for (const failure of failures) {
  console.error(
    `${relative(ROOT, failure.path)}:${failure.line}  ${failure.rule}  ${failure.found}\n    ${failure.why}`,
  );
}
console.error(`\n${failures.length} design-system violation(s).`);
process.exit(1);
