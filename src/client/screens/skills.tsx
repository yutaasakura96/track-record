/**
 * Screen 7 — Skills (S9, issue #114, `docs/10-screen-specifications.md`).
 *
 * The Skills section of the English résumé and the 活かせるスキル of the
 * 職務経歴書, shown first as the next résumé prints it and then as the groups
 * that make it. Nothing here is typed as a skill: every name is a technology an
 * accepted fact or a certification already carries, and the screen chooses,
 * groups and orders.
 *
 * A skill is a chip. It is dragged, or picked up — by Enter, Space or a tap —
 * and moved with the arrow keys or the bar under the groups, then placed. A
 * move is held on this screen until it is placed, so the preview follows it
 * and the server is written once. Saving is immediate after that, and every
 * save sends the whole list, as `PUT /api/skills/curation` expects.
 *
 * A group exists on the server only while it holds a skill, so a group just
 * added lives in this screen's state until its first skill arrives.
 */
import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import {
  failureText,
  useSaveSkillCuration,
  useSkillCuration,
  type SkillCuration,
  type SkillCurationInput,
} from "../api";
import { PhoneFrame } from "../components/application-chrome";
import { DocumentSection } from "../components/document-page";
import { Button, Dot, Panel } from "../components/ui";
import { ReadFailure, RefreshFailure } from "../components/read-failure";
import { ScreenIntro } from "../components/screen-intro";
import { moved } from "../reorder";
import { resumeSkills, skillsSectionPage } from "~/render/resume";
import {
  FOLD_YEARS,
  isFolded,
  placeOf,
  placeSkill,
  stepSkill,
  type CuratedGroup,
  type LastUsed,
  type SkillPlace,
} from "~/shared/skills";

const CONTROL =
  "min-h-control bg-surface-raised border border-border-control rounded-control px-10 py-8 text-ui text-text-strong outline-none focus:shadow-ring disabled:bg-disabled-bg disabled:text-text-faint";

const CHIP =
  "inline-flex items-center gap-6 min-h-control-inline max-phone:min-h-control px-8 py-2 rounded-control border text-row motion-tone outline-none focus-visible:shadow-glow";

type PanelName = "groups" | "suggestions";

type Step = Parameters<typeof stepSkill>[2];

const KEY_STEP: Record<string, Step> = {
  ArrowLeft: "earlier",
  ArrowRight: "later",
  ArrowUp: "previous group",
  ArrowDown: "next group",
};

interface Evidence {
  factCount: number;
  certificationCount: number;
  lastUsed: LastUsed;
  stale?: boolean;
}

/** `3 · 2020`, `2 + 1 cert · now`, `2 certs · 2023`: what backs a chip, and when it was last used. */
const shortEvidence = ({ factCount, certificationCount, lastUsed }: Evidence) =>
  [
    [factCount > 0 ? String(factCount) : null, certificationCount > 0 ? `${certificationCount} ${certificationCount === 1 ? "cert" : "certs"}` : null].filter(Boolean).join(" + "),
    lastUsed === null ? null : String(lastUsed),
  ]
    .filter(Boolean)
    .join(" · ");

/** The same, in words, for a chip's name. */
const longEvidence = ({ factCount, certificationCount, lastUsed, stale }: Evidence) => {
  if (stale) return "named by no achievement or certification any more";
  const backing = [
    factCount > 0 ? `${factCount} ${factCount === 1 ? "achievement" : "achievements"}` : null,
    certificationCount > 0 ? `${certificationCount} ${certificationCount === 1 ? "certification" : "certifications"}` : null,
  ].filter(Boolean);
  const when = lastUsed === "now" ? "in use now" : lastUsed === null ? null : `last used ${lastUsed}`;
  return [backing.join(" and "), when].filter(Boolean).join(", ");
};

const nonEmpty = (groups: CuratedGroup[]) => groups.filter((g) => g.skills.length > 0);

/** A skill picked up: which one, the list it is being moved through, and whether it is being added. */
interface Held {
  skill: string;
  groups: CuratedGroup[];
  /** Picked up from the suggestions and not yet in a group. */
  adding: boolean;
}

export function Skills() {
  const curation = useSkillCuration();
  const data = curation.data;

  return (
    <PhoneFrame title="Skills" note="The Skills section of your résumé and the 活かせるスキル of your 職務経歴書">
      {data && curation.isError ? <RefreshFailure query={curation} /> : null}
      {!data && curation.isError ? (
        <ReadFailure query={curation} />
      ) : !data ? (
        <>
          <Panel heading="How it reads on your résumé">
            <p className="text-smaller text-text-dim">Loading…</p>
          </Panel>
          <div className="grid grid-cols-2 max-phone:grid-cols-1 gap-20 max-phone:gap-16">
            <Panel heading="Your groups">
              <p className="text-smaller text-text-dim">Loading…</p>
            </Panel>
            <Panel heading="Found in your record, not listed yet">
              <p className="text-smaller text-text-dim">Loading…</p>
            </Panel>
          </div>
        </>
      ) : data.candidates.length === 0 && data.groups.length === 0 ? (
        <Panel>
          <p className="text-smaller text-text-dim">
            No skills yet. They come from the technologies named on accepted facts and on certifications.
          </p>
        </Panel>
      ) : (
        <Curation data={data} />
      )}
    </PhoneFrame>
  );
}

function Curation({ data }: { data: SkillCuration }) {
  const save = useSaveSkillCuration();
  const [drafts, setDrafts] = useState<string[]>([]);
  const [newGroup, setNewGroup] = useState("");
  const [failedIn, setFailedIn] = useState<PanelName | null>(null);
  const [held, setHeld] = useState<Held | null>(null);
  const [dragging, setDragging] = useState<{ skill: string; from: PanelName } | null>(null);
  const [dropAt, setDropAt] = useState<SkillPlace | null>(null);
  const [showFolded, setShowFolded] = useState(false);
  const [said, setSaid] = useState("");
  const chips = useRef(new Map<string, HTMLButtonElement>());
  // A chip moved to another group is a new element; focus follows it after the render.
  const [focusOn, setFocusOn] = useState<{ skill: string } | null>(null);
  const hint = useId();

  const stored: SkillCurationInput = data.groups.map((g) => ({
    name: g.name,
    nameJa: g.nameJa,
    skills: g.skills.map((s) => s.name),
  }));
  // What was sent is shown until the server answers, so a placed chip does not
  // jump back for the length of a round trip. A refusal re-reads (`useSaveSkillCuration`).
  const saved = save.isPending && save.variables ? save.variables : stored;
  const working: CuratedGroup[] = [
    ...saved,
    ...drafts.filter((d) => !saved.some((g) => g.name === d)).map((name) => ({ name, nameJa: null, skills: [] })),
  ];
  const groupNames = working.map((g) => g.name);
  const moving = held && !held.adding ? held : null;
  // While a chip is held, its list is the one pending change; the group controls wait for Place or Cancel.
  const locked = moving ? `Place or cancel the move of ${moving.skill} first.` : undefined;
  const shown = moving?.groups ?? working;
  const previewed = moving
    ? moving.groups
    : dragging && dropAt
      ? placeSkill(working, dragging.skill, dropAt)
      : working;
  const preview = skillsSectionPage(resumeSkills(nonEmpty(previewed), data.printable));
  const printable = new Set(data.printable);

  const evidence = new Map<string, Evidence>([
    ...data.candidates.map((c) => [c.name, c] as const),
    ...data.groups.flatMap((g) => g.skills.map((s) => [s.name, s] as const)),
  ]);
  const listed = new Set(working.flatMap((g) => g.skills));
  const thisYear = new Date().getFullYear();
  const suggestions = data.candidates.filter((c) => !listed.has(c.name));
  const inView = suggestions.filter((c) => !isFolded(c, thisYear));
  const folded = suggestions.filter((c) => isFolded(c, thisYear));

  const failure = save.error ? `That change was not saved. ${failureText(save.error)}` : null;

  useEffect(() => {
    if (focusOn) chips.current.get(focusOn.skill)?.focus();
  }, [focusOn]);

  const commit = (groups: CuratedGroup[], from: PanelName) => {
    setFailedIn(from);
    setDrafts(groups.filter((g) => g.skills.length === 0 && drafts.includes(g.name)).map((g) => g.name));
    save.mutate(nonEmpty(groups));
  };

  /** Where a skill now sits, said for a screen reader. */
  const whereIs = (groups: CuratedGroup[], skill: string) => {
    const at = placeOf(groups, skill);
    if (!at) return `${skill} is not in a group.`;
    const group = groups[at.group]!;
    return `${skill}: ${group.name}, ${at.index + 1} of ${group.skills.length}.`;
  };

  const pickUp = (skill: string) => {
    const from = moving ? place(moving) : working;
    setHeld({ skill, groups: from, adding: false });
    setSaid(`${skill} picked up. ${whereIs(from, skill)} Arrow keys move it. Enter places it, Escape puts it back.`);
  };

  /** Places what is held, and answers the list it left. */
  const place = (h: Held): CuratedGroup[] => {
    setHeld(null);
    if (JSON.stringify(h.groups) !== JSON.stringify(working)) {
      commit(h.groups, h.adding ? "suggestions" : "groups");
      setSaid(`${h.skill} placed. ${whereIs(h.groups, h.skill)}`);
    } else {
      setSaid(`${h.skill} placed where it was.`);
    }
    return h.groups;
  };

  const putBack = () => {
    if (!held) return;
    setHeld(null);
    setSaid(`${held.skill} put back.`);
    setFocusOn({ skill: held.skill });
  };

  const step = (direction: Step, fromKey: boolean) => {
    if (!held || held.adding) return;
    const next = stepSkill(held.groups, held.skill, direction);
    if (!next) {
      setSaid(`${held.skill} cannot move further that way. ${whereIs(held.groups, held.skill)}`);
      return;
    }
    if (fromKey) setFocusOn({ skill: held.skill });
    setHeld({ ...held, groups: next });
    setSaid(whereIs(next, held.skill));
  };

  const remove = (skill: string) => {
    setHeld(null);
    commit(
      working.map((g) => ({ ...g, skills: g.skills.filter((s) => s !== skill) })),
      "groups",
    );
    setSaid(`${skill} removed from the list.`);
  };

  const addTo = (skill: string, groupName: string) => {
    setHeld(null);
    const group = groupNames.indexOf(groupName);
    commit(placeSkill(working, skill, { group, index: Infinity }), "suggestions");
    setSaid(`${skill} added to ${groupName}.`);
  };

  const onChipKey = (event: KeyboardEvent<HTMLButtonElement>, skill: string) => {
    if (held?.skill !== skill || held.adding) return;
    if (event.key === "Escape") {
      event.preventDefault();
      putBack();
      return;
    }
    const direction = KEY_STEP[event.key];
    if (!direction) return;
    event.preventDefault();
    step(direction, true);
  };

  /* ------------------------------------------------------------- dragging */

  // Read by the handlers from refs: a dragover can arrive before the render
  // that follows dragstart, and a closure over the state would still see none.
  const drag = useRef<{ skill: string; from: PanelName } | null>(null);

  const startDrag = (event: DragEvent, skill: string, from: PanelName) => {
    if (moving) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData("text/plain", skill);
    event.dataTransfer.effectAllowed = "move";
    drag.current = { skill, from };
    setHeld(null);
    setDragging(drag.current);
  };

  const endDrag = () => {
    drag.current = null;
    setDragging(null);
    setDropAt(null);
  };

  /** Where a drop on `group` lands: before or after the chip under the pointer, or at the group's end. */
  const slotAt = (event: DragEvent<HTMLElement>, group: number, skill: string): SkillPlace => {
    const chip = (event.target as HTMLElement).closest<HTMLElement>("[data-chip-index]");
    let index = working[group]!.skills.length;
    if (chip) {
      const box = chip.getBoundingClientRect();
      index = Number(chip.dataset.chipIndex) + (event.clientX > box.left + box.width / 2 ? 1 : 0);
    }
    // The dragged chip's own slot is counted in `index`; leaving it frees that slot.
    const from = placeOf(working, skill);
    if (from && from.group === group && from.index < index) index -= 1;
    return { group, index };
  };

  const overGroup = (event: DragEvent<HTMLElement>, group: number) => {
    if (!drag.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const at = slotAt(event, group, drag.current.skill);
    if (dropAt?.group !== at.group || dropAt.index !== at.index) setDropAt(at);
  };

  const dropOnGroup = (event: DragEvent<HTMLElement>, group: number) => {
    const dragged = drag.current;
    if (!dragged) return;
    event.preventDefault();
    const to = slotAt(event, group, dragged.skill);
    commit(placeSkill(working, dragged.skill, to), dragged.from);
    setSaid(`${dragged.skill} moved to ${working[to.group]!.name}.`);
    endDrag();
  };

  const notice = (panel: PanelName) =>
    failure && failedIn === panel ? (
      <p role="alert" className="mt-12 text-smaller text-removed">
        {failure}
      </p>
    ) : null;

  const addGroup = () => {
    const name = newGroup.trim();
    if (!name || groupNames.includes(name)) return;
    setDrafts((current) => [...current, name]);
    setNewGroup("");
  };

  const heldAt = moving ? placeOf(moving.groups, moving.skill) : null;

  return (
    <>
      <ScreenIntro
        next={
          data.groups.length === 0
            ? "add a group, then add skills to it from the ones found in your record."
            : "nothing is waiting here. Every change saves at once."
        }
      >
        Which technologies your documents list, and in what order. Every name comes from an accepted fact or a
        certification; nothing is typed here.
      </ScreenIntro>

      <Panel heading="How it reads on your résumé">
        <p className="mb-12 text-smaller text-text-dim">
          The Skills section the next English résumé prints, from the groups below. The 職務経歴書 lists its
          活かせるスキル in the same groups and order, under each group's Japanese name.
        </p>
        <div
          aria-label="Résumé preview"
          role="region"
          className="bg-card border border-border rounded-tile px-16 py-14 max-phone:px-12"
        >
          {preview.length > 0 ? (
            preview.map((section) => <DocumentSection key={section.heading} section={section} flush />)
          ) : (
            <p className="text-smaller text-text-dim">
              Nothing to print. No skill in these groups is named by anything the résumé includes, so it has no
              Skills section.
            </p>
          )}
        </div>
      </Panel>

      <p aria-live="assertive" className="sr-only">
        {said}
      </p>
      <p id={hint} hidden>
        Enter picks it up. Then the arrow keys move it, Enter places it and Escape puts it back.
      </p>

      <div className="grid grid-cols-2 max-phone:grid-cols-1 gap-20 max-phone:gap-16 items-start">
        <Panel heading="Your groups">
          <p className="mb-12 text-smaller text-text-dim">
            Order matters: a reader takes in the first line first. Drag a skill, or press Enter on it and move it
            with the arrow keys — left and right in its group, up and down to another — then Enter to place it.
            Each shows the achievements behind it and the last year it was used.
          </p>
          {working.length === 0 ? (
            <p className="mb-12 text-smaller text-text-dim">
              Not curated. Documents list the technologies their facts name.
            </p>
          ) : null}

          <div className="grid gap-10">
            {shown.map((group, gi) => {
              const stored = saved.some((g) => g.name === group.name);
              const target = dragging && dropAt?.group === gi ? dropAt.index : null;
              return (
                <section
                  key={group.name}
                  aria-label={group.name}
                  onDragOver={(event) => overGroup(event, gi)}
                  onDragLeave={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                    setDropAt((at) => (at?.group === gi ? null : at));
                  }}
                  onDrop={(event) => dropOnGroup(event, gi)}
                  className={`grid gap-8 bg-card border rounded-tile px-12 py-10 motion-tone ${
                    target !== null ? "border-border-active bg-card-selected" : "border-border"
                  }`}
                >
                  <div className="flex items-center gap-8">
                    {stored ? (
                      <input
                        aria-label="Group name"
                        defaultValue={group.name}
                        disabled={locked !== undefined}
                        title={locked}
                        className={`${CONTROL} flex-1 min-w-0`}
                        onBlur={(event) => {
                          const name = event.target.value.trim();
                          if (!name || name === group.name) {
                            event.target.value = group.name;
                            return;
                          }
                          commit(working.map((g, i) => (i === gi ? { ...g, name } : g)), "groups");
                        }}
                      />
                    ) : (
                      <span className="flex-1 min-w-0 text-row font-medium text-text-strong">{group.name}</span>
                    )}
                    {stored ? (
                      <MoveButtons
                        index={gi}
                        length={saved.length}
                        what="group"
                        lockedReason={locked}
                        onMove={(by) => commit(moved(working, gi, by), "groups")}
                      />
                    ) : null}
                  </div>
                  {stored ? (
                    <label className="grid gap-4">
                      <span className="text-smaller text-text-dim">
                        Name in the 職務経歴書 — left blank, it is written in Japanese for you
                      </span>
                      <input
                        lang="ja"
                        defaultValue={group.nameJa ?? ""}
                        disabled={locked !== undefined}
                        title={locked}
                        className={CONTROL}
                        onBlur={(event) => {
                          const nameJa = event.target.value.trim() || null;
                          event.target.value = nameJa ?? "";
                          if (nameJa === group.nameJa) return;
                          commit(working.map((g, i) => (i === gi ? { ...g, nameJa } : g)), "groups");
                        }}
                      />
                    </label>
                  ) : null}
                  {group.skills.length === 0 ? (
                    <p className="text-smaller text-text-faint">
                      Add a skill to keep this group. Drag one here, or pick one up and move it here.
                    </p>
                  ) : (
                    <ul className="flex flex-wrap items-center gap-6">
                      {group.skills.map((skill, si) => {
                        const meta = evidence.get(skill) ?? { factCount: 0, certificationCount: 0, lastUsed: null, stale: true };
                        const isHeld = held?.skill === skill;
                        const leftOff = !meta.stale && !printable.has(skill);
                        return (
                          <li
                            key={skill}
                            data-chip-index={si}
                            draggable={!moving}
                            onDragStart={(event) => startDrag(event, skill, "groups")}
                            onDragEnd={endDrag}
                            className="flex items-center gap-6"
                          >
                            {target === si ? <DropMark /> : null}
                            <button
                              type="button"
                              ref={(node) => {
                                if (node) chips.current.set(skill, node);
                                else chips.current.delete(skill);
                              }}
                              aria-label={`${skill}: ${longEvidence(meta)}${leftOff ? ", left off the résumé" : ""}`}
                              aria-pressed={isHeld}
                              aria-describedby={hint}
                              onClick={() => (isHeld ? place(held!) : pickUp(skill))}
                              onKeyDown={(event) => onChipKey(event, skill)}
                              className={`${CHIP} cursor-grab ${
                                isHeld
                                  ? "bg-mark-selected border-border-active shadow-selected text-text-strong"
                                  : meta.stale
                                    ? "bg-generated-mark border-generated-rule text-generated-text"
                                    : "bg-surface border-border-strong text-text-strong hover:bg-hover"
                              } ${dragging?.skill === skill ? "opacity-50" : ""}`}
                            >
                              {meta.stale ? <Dot tone="generated" /> : null}
                              <span>{skill}</span>
                              <span className="text-smaller text-text-faint">
                                {meta.stale ? "in no fact" : leftOff ? `${shortEvidence(meta)} · left off` : shortEvidence(meta)}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                      {target !== null && target >= group.skills.length ? (
                        <li className="flex items-center">
                          <DropMark />
                        </li>
                      ) : null}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>

          {held && !held.adding && heldAt ? (
            <div
              role="group"
              aria-label={`Move ${held.skill}`}
              className="sticky bottom-0 mt-12 flex flex-wrap items-center gap-6 bg-surface-raised border border-border-active rounded-control px-10 py-8"
            >
              <span className="text-smaller text-text-secondary mr-auto">
                Moving <span className="font-medium text-text-strong">{held.skill}</span>
              </span>
              <Button
                variant="ghost"
                disabled={heldAt.index === 0}
                disabledReason="It is already first in its group."
                onClick={() => step("earlier", false)}
              >
                ← Earlier
              </Button>
              <Button
                variant="ghost"
                disabled={heldAt.index === held.groups[heldAt.group]!.skills.length - 1}
                disabledReason="It is already last in its group."
                onClick={() => step("later", false)}
              >
                Later →
              </Button>
              <Button
                variant="ghost"
                disabled={heldAt.group === 0}
                disabledReason="It is already in the first group."
                onClick={() => step("previous group", false)}
              >
                ↑ Group above
              </Button>
              <Button
                variant="ghost"
                disabled={heldAt.group === held.groups.length - 1}
                disabledReason="It is already in the last group."
                onClick={() => step("next group", false)}
              >
                ↓ Group below
              </Button>
              <Button variant="ghost" onClick={() => remove(held.skill)}>
                Remove
              </Button>
              <Button variant="ghost" onClick={putBack}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => place(held)}>
                Place
              </Button>
            </div>
          ) : null}

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
              disabled={locked !== undefined}
              title={locked}
              onChange={(event) => setNewGroup(event.target.value)}
              className={`${CONTROL} flex-1 min-w-0`}
            />
            <Button
              type="submit"
              disabled={locked !== undefined || !newGroup.trim() || groupNames.includes(newGroup.trim())}
              disabledReason={
                locked ?? (newGroup.trim() ? "A group with that name already exists." : "Name the group first.")
              }
            >
              Add group
            </Button>
          </form>
          {notice("groups")}
        </Panel>

        <section
          onDragOver={(event) => {
            if (drag.current?.from !== "groups") return;
            event.preventDefault();
            setDropAt(null);
          }}
          onDrop={(event) => {
            const dragged = drag.current;
            if (dragged?.from !== "groups") return;
            event.preventDefault();
            remove(dragged.skill);
            endDrag();
          }}
          aria-labelledby={`${hint}-suggestions`}
          className="bg-surface-raised border border-border rounded-panel px-16 py-14"
        >
          <h2 id={`${hint}-suggestions`} className="mb-12 text-panel font-semibold tracking-snug text-text-strong">
            Found in your record, not listed yet
          </h2>
          <p className="mb-12 text-smaller text-text-dim">
            Most used first. Once a group holds a skill, each remaining skill is offered the group whose skills its
            achievements name it beside; failing that, the group at the same employers, then the largest. Press it to
            add it there, or drag it to another. Before that, press a skill to choose a group, creating one first if needed.
            Drag a listed skill here to take it off the list.
          </p>
          {suggestions.length === 0 ? (
            <p className="text-smaller text-text-dim">Every skill your record names is listed.</p>
          ) : (
            <>
              <SuggestionChips
                candidates={inView}
                groupNames={groupNames}
                heldSkill={held?.adding ? held.skill : null}
                lockedReason={locked}
                onAdd={addTo}
                onHold={(skill) => {
                  setHeld({ skill, groups: working, adding: true });
                  setSaid(`Choose a group for ${skill}.`);
                }}
                onDragStart={(event, skill) => startDrag(event, skill, "suggestions")}
                onDragEnd={endDrag}
              />
              {folded.length > 0 ? (
                <div className="mt-12 grid gap-8">
                  <p className="text-smaller text-text-dim">
                    {showFolded ? "Also found" : `${folded.length} more`}, each named once and not in the last{" "}
                    {FOLD_YEARS} years.{" "}
                    <Button variant="bare" aria-expanded={showFolded} onClick={() => setShowFolded(!showFolded)}>
                      {showFolded ? "Hide them" : "Show them"}
                    </Button>
                  </p>
                  {showFolded ? (
                    <SuggestionChips
                      candidates={folded}
                      groupNames={groupNames}
                      heldSkill={held?.adding ? held.skill : null}
                      lockedReason={locked}
                      onAdd={addTo}
                      onHold={(skill) => {
                        setHeld({ skill, groups: working, adding: true });
                        setSaid(`Choose a group for ${skill}.`);
                      }}
                      onDragStart={(event, skill) => startDrag(event, skill, "suggestions")}
                      onDragEnd={endDrag}
                    />
                  ) : null}
                </div>
              ) : null}
            </>
          )}

          {held?.adding ? (
            <div
              role="group"
              aria-label={`Add ${held.skill} to`}
              className="mt-12 flex flex-wrap items-center gap-6 bg-surface border border-border-active rounded-control px-10 py-8"
            >
              <span className="text-smaller text-text-secondary mr-auto">
                Add <span className="font-medium text-text-strong">{held.skill}</span> to
              </span>
              {groupNames.length === 0 ? (
                <span className="text-smaller text-text-dim">a group named under Your groups first.</span>
              ) : (
                groupNames.map((name) => (
                  <Button key={name} variant="ghost" onClick={() => addTo(held.skill, name)}>
                    {name}
                  </Button>
                ))
              )}
              <Button variant="ghost" onClick={() => setHeld(null)}>
                Cancel
              </Button>
            </div>
          ) : null}
          {notice("suggestions")}
        </section>
      </div>
    </>
  );
}

/** Where a dragged skill would land. */
function DropMark() {
  return <span aria-hidden className="w-2 h-icon rounded-mark bg-accent" />;
}

function SuggestionChips({
  candidates,
  groupNames,
  heldSkill,
  lockedReason,
  onAdd,
  onHold,
  onDragStart,
  onDragEnd,
}: {
  candidates: SkillCuration["candidates"];
  groupNames: string[];
  heldSkill: string | null;
  lockedReason: string | undefined;
  onAdd: (skill: string, group: string) => void;
  onHold: (skill: string) => void;
  onDragStart: (event: DragEvent, skill: string) => void;
  onDragEnd: () => void;
}) {
  return (
    <ul className="flex flex-wrap items-center gap-6">
      {candidates.map((candidate) => {
        const suggested =
          candidate.suggestedGroup !== null && groupNames.includes(candidate.suggestedGroup)
            ? candidate.suggestedGroup
            : null;
        return (
          <li
            key={candidate.name}
            draggable={lockedReason === undefined}
            onDragStart={(event) => onDragStart(event, candidate.name)}
            onDragEnd={onDragEnd}
          >
            <button
              type="button"
              aria-label={
                suggested
                  ? `Add ${candidate.name} to ${suggested}: ${longEvidence(candidate)}`
                  : `Add ${candidate.name}, choosing a group: ${longEvidence(candidate)}`
              }
              aria-pressed={heldSkill === candidate.name}
              disabled={lockedReason !== undefined}
              title={lockedReason}
              onClick={() => (suggested ? onAdd(candidate.name, suggested) : onHold(candidate.name))}
              className={`${CHIP} cursor-grab border-dashed disabled:cursor-default disabled:text-text-faint ${
                heldSkill === candidate.name
                  ? "bg-mark-selected border-border-active text-text-strong"
                  : "bg-surface border-border-dashed text-text-strong hover:bg-hover"
              }`}
            >
              <span aria-hidden className="font-semibold text-accent-text">
                +
              </span>
              <span>{candidate.name}</span>
              <span className="text-smaller text-text-faint">{shortEvidence(candidate)}</span>
              {suggested ? <span className="text-smaller text-text-dim">→ {suggested}</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function MoveButtons({
  index,
  length,
  what,
  lockedReason,
  onMove,
}: {
  index: number;
  length: number;
  what: string;
  lockedReason: string | undefined;
  onMove: (by: -1 | 1) => void;
}) {
  return (
    <>
      <Button
        variant="bare"
        aria-label={`Move ${what} up`}
        disabled={lockedReason !== undefined || index === 0}
        disabledReason={lockedReason ?? `This ${what} is already first.`}
        onClick={() => onMove(-1)}
      >
        ↑
      </Button>
      <Button
        variant="bare"
        aria-label={`Move ${what} down`}
        disabled={lockedReason !== undefined || index === length - 1}
        disabledReason={lockedReason ?? `This ${what} is already last.`}
        onClick={() => onMove(1)}
      >
        ↓
      </Button>
    </>
  );
}
