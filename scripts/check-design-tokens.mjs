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

walk(CLIENT);
checkMarkBase();

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
