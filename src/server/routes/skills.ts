/**
 * Skills curation (`docs/07-api-design.md`, S9).
 *
 * `GET` answers with the curated groups, each skill flagged `stale` when the
 * record no longer names it, and with every candidate marked whether it is
 * curated. Staleness is computed on this read, never stored (`services/skills`).
 *
 * `PUT` replaces the whole list. The screen saves on every change and always
 * sends everything, so there is no partial update for the two sides to disagree
 * about. An empty list clears the curation and hands the section back to the
 * model's derivation.
 */
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { skillCurations } from "../db/schema";
import { validationFailed } from "../http/errors";
import { newId } from "../http/ids";
import { routes } from "../http/registry";
import { parseBody } from "../services/validate";
import { curatedGroups, skillCandidates, type CuratedGroup } from "../services/skills";
import type { AppEnv } from "../env";
import type { Db } from "../db/client";

const curationBody = z.object({
  groups: z.array(
    z.object({
      name: z.string().trim().min(1, "A group needs a name."),
      skills: z
        .array(z.string().trim().min(1))
        .min(1, "A group needs at least one skill."),
    }),
  ),
});

export function registerSkillRoutes(app: Hono<AppEnv>) {
  const api = routes(app);

  api.get("/api/skills/curation", async (c) => {
    return c.json(await curationView(c.get("db"), c.get("user").id));
  });

  api.put("/api/skills/curation", async (c) => {
    const { groups } = await parseBody(c, curationBody);
    const userId = c.get("user").id;
    const db = c.get("db");
    await requireCuratable(db, userId, groups);

    const rows = groups.flatMap((group) =>
      group.skills.map((skillName) => ({ skillName, groupName: group.name })),
    );
    const clear = db.delete(skillCurations).where(eq(skillCurations.userId, userId));
    if (rows.length === 0) {
      await clear;
    } else {
      // One transaction: a list half-replaced would be a curation nobody chose.
      await db.batch([
        clear,
        db.insert(skillCurations).values(
          rows.map((row, sortOrder) => ({ id: newId("skillCuration"), userId, sortOrder, ...row })),
        ),
      ]);
    }
    return c.json(await curationView(db, userId));
  });
}

async function curationView(db: Db, userId: string) {
  const [groups, candidates] = await Promise.all([
    curatedGroups(db, userId),
    skillCandidates(db, userId),
  ]);
  const byName = new Map(candidates.map((candidate) => [candidate.name, candidate]));
  const curated = new Set(groups.flatMap((g) => g.skills));

  return {
    groups: groups.map((group) => ({
      name: group.name,
      skills: group.skills.map((name) => {
        const candidate = byName.get(name);
        return {
          name,
          factCount: candidate?.factCount ?? 0,
          certificationCount: candidate?.certificationCount ?? 0,
          stale: candidate === undefined,
        };
      }),
    })),
    candidates: candidates.map((candidate) => ({ ...candidate, curated: curated.has(candidate.name) })),
  };
}

/**
 * Nothing hand-authors a skill (`docs/04`). A name must be a candidate — or be
 * curated already, because a stale skill is flagged and kept, and a list that
 * could not be saved again while it held one would force the author to remove
 * it to reorder anything else.
 */
async function requireCuratable(db: Db, userId: string, groups: CuratedGroup[]) {
  if (new Set(groups.map((g) => g.name)).size !== groups.length) {
    throw validationFailed("Two groups share a name.", ["groups"]);
  }
  const names = groups.flatMap((g) => g.skills);
  if (new Set(names).size !== names.length) {
    throw validationFailed("A skill appears in more than one place.", ["groups"]);
  }

  const [candidates, existing] = await Promise.all([
    skillCandidates(db, userId),
    curatedGroups(db, userId),
  ]);
  const allowed = new Set([
    ...candidates.map((c) => c.name),
    ...existing.flatMap((g) => g.skills),
  ]);
  const unknown = names.find((name) => !allowed.has(name));
  if (unknown !== undefined) {
    throw validationFailed(
      `"${unknown}" is not named by any accepted fact or certification.`,
      ["groups"],
    );
  }
}
