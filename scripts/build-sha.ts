/**
 * The commit a build is made from, as the SPA shell carries it (`docs/12` §3, §7).
 *
 * `GITHUB_SHA` in Actions. Locally, `HEAD`, with `-dirty` when the tree has
 * uncommitted changes: a manual deploy of a dirty tree is not the commit it
 * names, and the shell should not say it is. Read by `vite.config.ts` when it
 * builds and by `./smoke-check.ts` when it checks, so both agree by construction.
 */
import { execFileSync } from "node:child_process";

export function buildSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
    const head = git("rev-parse", "HEAD");
    return git("status", "--porcelain") === "" ? head : `${head}-dirty`;
  } catch {
    return "unknown";
  }
}
