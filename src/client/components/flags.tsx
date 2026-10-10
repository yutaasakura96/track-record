/**
 * A flag, wherever one is shown: the Flagged list and a fact's own card
 * (`docs/10` Screen 9, issue #57).
 *
 * It always says why. **`Explain this` is the only control in the application
 * that calls the AI on a press and nowhere else**, so it is a button and never
 * an effect: reading a list of flags spends nothing, and an explanation
 * already written is shown as stored.
 *
 * `Checked` takes the flag off the list and changes nothing about the fact.
 */
import { failureText, useFlagAction, type Flag } from "../api";
import { Button, Mono } from "./ui";

/** What each kind is called, in the author's words. */
export const FLAG_LABEL: Record<Flag["kind"], string> = {
  confidential: "Kept private",
  unsure: "Not sure",
  repeat: "Likely a repeat",
  number: "States a number",
};

/** What each kind means for the fact, said once above its group on the list. */
export const FLAG_MEANING: Record<Flag["kind"], string> = {
  confidential:
    "These look like they name a client, a person or an internal system. Each is stored Private, so no document uses it. To use one, open it and change who may read it.",
  unsure: "The importer was not confident in these. Each is kept in your record; the reason says what it doubted.",
  repeat:
    "These likely say again what another fact in your record already says. Both are kept; open one to see the pair, and reject one if they are the same.",
  number: "A wrong number on a résumé is costly. These can already be used; check the number when you want to.",
};

export function FlagLine({ flag }: { flag: Flag }) {
  const { explain, setChecked } = useFlagAction();
  const failure = explain.error ?? setChecked.error;
  // The answer to the press, until the list is read again and carries it.
  const explanation = flag.explanation ?? explain.data?.explanation ?? null;

  return (
    <div className="grid gap-6">
      <p className="text-small text-text-secondary">
        <Mono className={flag.kind === "confidential" ? "text-private" : "text-text-dim"}>{FLAG_LABEL[flag.kind]}</Mono>{" "}
        {flag.reason}
      </p>
      {explanation ? (
        <p aria-label="Explanation" className="border-l border-border-strong pl-10 text-small text-text-secondary whitespace-pre-line">
          {explanation}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-6">
        {explanation ? null : (
          <Button
            variant="ghost"
            disabled={explain.isPending}
            disabledReason={explain.isPending ? "Asking the AI to explain…" : undefined}
            onClick={() => {
              setChecked.reset();
              explain.mutate(flag.id);
            }}
          >
            {explain.isPending ? "Explaining…" : "Explain this"}
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={setChecked.isPending}
          disabledReason={setChecked.isPending ? "Saving…" : undefined}
          onClick={() => {
            explain.reset();
            setChecked.mutate({ id: flag.id, checked: !flag.checked });
          }}
        >
          {flag.checked ? "Put back on the list" : "Mark as checked"}
        </Button>
      </div>
      {failure ? (
        <p role="alert" className="text-smaller text-removed">
          {failureText(failure)}
        </p>
      ) : null}
    </div>
  );
}
