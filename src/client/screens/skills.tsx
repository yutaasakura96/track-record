/**
 * Screen 7 — Skills (S9, `docs/10-screen-specifications.md`).
 *
 * Nothing here is typed as a skill. Every name is a technology an accepted fact
 * or a certification already carries; the screen chooses, groups and orders.
 * Saving is immediate and every change sends the whole list, as `PUT
 * /api/skills/curation` expects.
 *
 * A group exists on the server only while it holds a skill, so a group just
 * added lives in this screen's state until its first skill arrives.
 */
import { useState } from "react";
import {
  failureText,
  useProfile,
  useSaveSkillCuration,
  useSkillCuration,
  type CuratedSkill,
  type SkillCurationInput,
} from "../api";
import { Button, Dot, Mono, Panel } from "../components/ui";
import { ReadFailure, RefreshFailure } from "../components/read-failure";
import { Sidebar } from "../components/sidebar";
import { moved } from "../reorder";

const CONTROL =
  "min-h-control bg-surface-raised border border-border-control rounded-control px-10 py-8 text-ui text-text-strong outline-none focus:shadow-ring";

type PanelName = "curated" | "candidates";

const countLabel = (skill: { factCount: number; certificationCount: number }) =>
  skill.factCount > 0 ? `${skill.factCount} ${skill.factCount === 1 ? "fact" : "facts"}` : "cert";

export function Skills() {
  const profile = useProfile();
  const curation = useSkillCuration();
  const save = useSaveSkillCuration();
  const [drafts, setDrafts] = useState<string[]>([]);
  const [newGroup, setNewGroup] = useState("");
  const [failedIn, setFailedIn] = useState<PanelName | null>(null);

  const data = curation.data;
  const stored: SkillCurationInput =
    data?.groups.map((g) => ({ name: g.name, skills: g.skills.map((s) => s.name) })) ?? [];
  const groupNames = [...stored.map((g) => g.name), ...drafts];
  const failure = save.error ? `That change was not saved. ${failureText(save.error)}` : null;

  const commit = (groups: SkillCurationInput, from: PanelName) => {
    setFailedIn(from);
    save.mutate(groups.filter((g) => g.skills.length > 0));
  };

  const addSkill = (groupName: string, skill: string) => {
    if (stored.some((g) => g.name === groupName)) {
      commit(stored.map((g) => (g.name === groupName ? { ...g, skills: [...g.skills, skill] } : g)), "candidates");
      return;
    }
    setDrafts((current) => current.filter((d) => d !== groupName));
    commit([...stored, { name: groupName, skills: [skill] }], "candidates");
  };

  const addGroup = () => {
    const name = newGroup.trim();
    if (!name || groupNames.includes(name)) return;
    setDrafts((current) => [...current, name]);
    setNewGroup("");
  };

  const editSkills = (groupIndex: number, change: (skills: string[]) => string[]) =>
    commit(stored.map((g, i) => (i === groupIndex ? { ...g, skills: change(g.skills) } : g)), "curated");

  const notice = (panel: PanelName) =>
    failure && failedIn === panel ? (
      <p role="alert" className="mt-12 text-smaller text-removed">
        {failure}
      </p>
    ) : null;

  return (
    <div className="min-h-screen flex">
      <Sidebar name={profile.data?.nameLatin ?? ""} />
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-header shrink-0 flex items-center gap-12 px-20 bg-surface border-b border-border">
          <h1 className="text-panel font-semibold tracking-snug text-text-strong">Skills</h1>
          <span className="text-smaller text-text-dimmer">
            Chosen from the technologies your facts and certifications name
          </span>
        </header>

        <div className="flex-1 overflow-y-auto px-20 py-26">
          {data && curation.isError ? <RefreshFailure query={curation} className="mb-20" /> : null}
          {!data && curation.isError ? (
            <ReadFailure query={curation} />
          ) : !data ? (
            <div className="grid grid-cols-2 gap-20">
              <Panel heading="Curated">
                <p className="text-smaller text-text-dim">Loading…</p>
              </Panel>
              <Panel heading="Candidates">
                <p className="text-smaller text-text-dim">Loading…</p>
              </Panel>
            </div>
          ) : data.candidates.length === 0 && data.groups.length === 0 ? (
            <Panel>
              <p className="text-smaller text-text-dim">
                No skills yet. They come from the technologies named on accepted facts and on certifications.
              </p>
            </Panel>
          ) : (
            <div className="grid grid-cols-2 gap-20 items-start">
              <Panel heading="Curated">
                {data.groups.length === 0 && drafts.length === 0 ? (
                  <p className="mb-12 text-smaller text-text-dim">
                    Not curated. Documents list the technologies their facts name.
                  </p>
                ) : null}

                <div className="grid gap-14">
                  {data.groups.map((group, gi) => (
                    <section key={group.name} aria-label={group.name} className="grid gap-6">
                      <div className="flex items-center gap-8">
                        <input
                          aria-label="Group name"
                          defaultValue={group.name}
                          className={`${CONTROL} flex-1 min-w-0`}
                          onBlur={(event) => {
                            const name = event.target.value.trim();
                            if (!name || name === group.name) {
                              event.target.value = group.name;
                              return;
                            }
                            commit(stored.map((g, i) => (i === gi ? { ...g, name } : g)), "curated");
                          }}
                        />
                        <MoveButtons
                          index={gi}
                          length={data.groups.length}
                          what="group"
                          onMove={(by) => commit(moved(stored, gi, by), "curated")}
                        />
                      </div>
                      <ul>
                        {group.skills.map((skill, si) => (
                          <SkillRow
                            key={skill.name}
                            skill={skill}
                            index={si}
                            length={group.skills.length}
                            onMove={(by) => editSkills(gi, (skills) => moved(skills, si, by))}
                            onRemove={() => editSkills(gi, (skills) => skills.filter((s) => s !== skill.name))}
                          />
                        ))}
                      </ul>
                    </section>
                  ))}
                  {drafts.map((name) => (
                    <section key={name} aria-label={name} className="grid gap-6">
                      <div className="text-row font-medium text-text-strong">{name}</div>
                      <p className="text-smaller text-text-faint">Add a skill to keep this group.</p>
                    </section>
                  ))}
                </div>

                <form
                  className="mt-14 flex items-center gap-8"
                  onSubmit={(event) => {
                    event.preventDefault();
                    addGroup();
                  }}
                >
                  <input
                    aria-label="New group name"
                    placeholder="Group name"
                    value={newGroup}
                    onChange={(event) => setNewGroup(event.target.value)}
                    className={`${CONTROL} flex-1 min-w-0`}
                  />
                  <Button
                    type="submit"
                    disabled={!newGroup.trim() || groupNames.includes(newGroup.trim())}
                    disabledReason={
                      newGroup.trim() ? "A group with that name already exists." : "Name the group first."
                    }
                  >
                    Add group
                  </Button>
                </form>
                {notice("curated")}
              </Panel>

              <Panel heading="Candidates">
                <ul>
                  {data.candidates
                    .filter((candidate) => !candidate.curated)
                    .map((candidate) => (
                      <li
                        key={candidate.name}
                        className="flex items-center gap-12 px-10 py-8 border-b border-border-inner last:border-b-0"
                      >
                        <span className="text-row text-text-strong truncate">{candidate.name}</span>
                        <Mono className="ml-auto text-text-faint">{countLabel(candidate)}</Mono>
                        <select
                          aria-label={`Add ${candidate.name} to`}
                          value=""
                          disabled={groupNames.length === 0}
                          title={groupNames.length === 0 ? "Add a group first." : undefined}
                          onChange={(event) => addSkill(event.target.value, candidate.name)}
                          className={`${CONTROL} disabled:bg-disabled-bg disabled:text-text-faint disabled:cursor-not-allowed`}
                        >
                          <option value="" disabled>
                            Add to
                          </option>
                          {groupNames.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </li>
                    ))}
                </ul>
                {notice("candidates")}
              </Panel>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MoveButtons({
  index,
  length,
  what,
  onMove,
}: {
  index: number;
  length: number;
  what: string;
  onMove: (by: -1 | 1) => void;
}) {
  return (
    <>
      <Button
        variant="bare"
        aria-label={`Move ${what} up`}
        disabled={index === 0}
        disabledReason={`This ${what} is already first.`}
        onClick={() => onMove(-1)}
      >
        ↑
      </Button>
      <Button
        variant="bare"
        aria-label={`Move ${what} down`}
        disabled={index === length - 1}
        disabledReason={`This ${what} is already last.`}
        onClick={() => onMove(1)}
      >
        ↓
      </Button>
    </>
  );
}

function SkillRow({
  skill,
  index,
  length,
  onMove,
  onRemove,
}: {
  skill: CuratedSkill;
  index: number;
  length: number;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-8 px-10 py-6 border-b border-border-inner last:border-b-0">
      <span className="text-row text-text-strong truncate">{skill.name}</span>
      <span className="ml-auto flex items-center gap-6">
        {skill.stale ? (
          <>
            <Dot tone="generated" />
            <Mono className="text-generated-text">In no fact</Mono>
          </>
        ) : (
          <Mono className="text-text-faint">{countLabel(skill)}</Mono>
        )}
      </span>
      <MoveButtons index={index} length={length} what="skill" onMove={onMove} />
      <Button variant="bare" onClick={onRemove}>
        Remove
      </Button>
    </li>
  );
}
