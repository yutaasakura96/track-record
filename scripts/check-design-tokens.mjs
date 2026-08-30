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

walk(CLIENT);

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
