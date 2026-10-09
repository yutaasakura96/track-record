/**
 * Screen 9 — Flagged (`docs/10-screen-specifications.md`, issue #57).
 *
 * What replaced accepting facts one at a time. The importer accepts every fact
 * and grades it; this is the list of the ones it thinks are worth a look, each
 * with its reason. Nothing on it is waiting on the author: a flagged fact is
 * already in the record and stays there whatever happens here.
 *
 * Reading the list calls no model. `Explain this` on an item does, once.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useFlags, useProfile, type FlaggedItem } from "../api";
import { FLAG_LABEL, FLAG_MEANING, FlagLine } from "../components/flags";
import { ReadFailure, RefreshFailure } from "../components/read-failure";
import { ScreenIntro } from "../components/screen-intro";
import { Sidebar } from "../components/sidebar";
import { FilterPill, Mono, MonoId, Panel } from "../components/ui";

/** What keeps a fact out of documents first, then what only asks for a look. */
const KINDS = ["confidential", "unsure", "repeat", "number"] as const;

export function FlaggedScreen() {
  const profile = useProfile();
  const [state, setState] = useState<"open" | "checked">("open");
  const flags = useFlags(state);
  const data = flags.data;
  const counts = data?.counts ?? { open: 0, checked: 0 };

  return (
    <div className="min-h-screen flex">
      <Sidebar name={profile.data?.nameLatin ?? ""} />
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-header shrink-0 flex items-center gap-12 px-20 bg-surface border-b border-border">
          <h1 className="text-panel font-semibold tracking-snug text-text-strong">Flagged</h1>
          <span className="text-smaller text-text-dimmer">Facts worth a look, each with the reason</span>
        </header>

        <div className="flex-1 overflow-y-auto px-20 py-26 grid gap-20 content-start">
          <ScreenIntro
            next={
              counts.open === 0
                ? "nothing is flagged."
                : "open one when you want to check it. Nothing here is waiting on you."
            }
            legend="Explain this asks the AI to say more about one flag. It is the only button here that uses the AI, and only when you press it."
          >
            Facts are accepted into your record as they are imported. The ones listed here are the
            ones worth checking, and each says why. A flagged fact stays in your record whatever you
            do here.
          </ScreenIntro>

          <div className="flex gap-4">
            <FilterPill active={state === "open"} onClick={() => setState("open")}>
              To check {counts.open}
            </FilterPill>
            <FilterPill active={state === "checked"} onClick={() => setState("checked")}>
              Checked {counts.checked}
            </FilterPill>
          </div>

          {data && flags.isError ? <RefreshFailure query={flags} /> : null}
          {!data && flags.isError ? (
            <ReadFailure query={flags} />
          ) : !data ? (
            <p className="text-smaller text-text-dim">Loading the list…</p>
          ) : data.items.length === 0 ? (
            <Panel>
              <p className="text-smaller text-text-dim">
                {state === "open"
                  ? "Nothing is flagged. Facts that need a look appear here as documents are imported."
                  : "Nothing is marked as checked yet."}
              </p>
            </Panel>
          ) : (
            KINDS.map((kind) => {
              const items = data.items.filter((item) => item.kind === kind);
              if (items.length === 0) return null;
              return (
                <Panel key={kind} heading={`${FLAG_LABEL[kind]} · ${items.length}`}>
                  <p className="mb-12 text-smaller text-text-dim">{FLAG_MEANING[kind]}</p>
                  <ul className="grid gap-12">
                    {items.map((item) => (
                      <FlaggedRow key={item.id} item={item} />
                    ))}
                  </ul>
                </Panel>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function FlaggedRow({ item }: { item: FlaggedItem }) {
  const { fact } = item;
  return (
    <li className="border-t border-border-subtle pt-12 grid gap-8">
      <p className="text-claim text-text-strong">{fact.claim}</p>
      <div className="flex flex-wrap items-center gap-10">
        <Mono className="text-text-faint">
          {fact.provenance} · {fact.disclosure}
        </Mono>
        {fact.importId && fact.filename ? (
          // Clicking in is the author's choice, never a step: the fact opens on
          // its own card, beside the passage it was read from.
          <Link
            to="/imports/$importId"
            params={{ importId: fact.importId }}
            search={{ fact: fact.id }}
            className="text-smaller text-text-dim hover:text-text-secondary"
          >
            Open it in <MonoId>{fact.filename}</MonoId>
            {fact.lineNumber === null ? "" : `, line ${fact.lineNumber}`}
          </Link>
        ) : null}
      </div>
      <FlagLine flag={item} />
    </li>
  );
}
