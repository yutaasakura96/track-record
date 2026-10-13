/**
 * The recordings of one interview entry, on its card
 * (`docs/10-screen-specifications.md`, Screen 13; issue #74).
 *
 * A recording is a link to one kept somewhere else: a row with `Open` and
 * `Remove`, and under the rows `Attach a recording`, which opens the link form
 * in place. Uploading an audio file (#76) is a second choice in that same card
 * and a second kind of row here.
 *
 * Remove asks once, in place of the row. A removed recording leaves a line
 * saying so and the day, since it is the one thing the author can remove.
 */
import { useState, type KeyboardEvent } from "react";
import { failureText, useRecordings } from "../api";
import { useFlashStore } from "../stores/flash";
import type { Interview } from "~/shared/interview";
import { LABEL_MAX, LINK_MAX, NOT_A_LINK, UNLABELLED_LINK, isWebLink, type Recording } from "~/shared/recording";
import { CONTROL } from "./application-chrome";
import { QUIET } from "./document-row";
import { Button, Chip } from "./ui";

const ROW =
  "min-w-0 flex flex-wrap items-center gap-10 bg-surface-raised border border-border-control rounded-control px-10 py-8";

export function InterviewRecordings({ applicationId, entry }: { applicationId: string; entry: Interview }) {
  const { addLink, remove } = useRecordings(applicationId, entry.id);
  const flash = useFlashStore((state) => state.show);
  const [attaching, setAttaching] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const removeIt = async (recording: Recording) => {
    setFailure(null);
    try {
      await remove.mutateAsync(recording.id);
      setRemoving(null);
      flash("Recording removed.");
    } catch (error) {
      setFailure(failureText(error));
    }
  };

  return (
    <>
      {entry.recordings.map((recording) =>
        recording.kind === "removed" ? (
          <p key={recording.id} className="text-small text-text-muted">
            A recording was removed on {recording.removedOn}.
          </p>
        ) : removing === recording.id ? (
          <div key={recording.id} role="alertdialog" aria-label="Remove this recording" className={ROW}>
            <span className="min-w-0 flex-1 text-small text-text-secondary break-words">
              Remove {recording.label || "this link"} for good? Only the link is removed; the recording stays where it
              lives. The interview keeps a line saying one was removed.
            </span>
            <Button
              variant="secondary"
              onClick={() => void removeIt(recording)}
              disabled={remove.isPending}
              disabledReason="Removing…"
            >
              Remove it
            </Button>
            <Button
              variant="bare"
              autoFocus
              onClick={() => {
                setRemoving(null);
                setFailure(null);
              }}
            >
              Keep it
            </Button>
            {failure ? (
              <p role="alert" className="basis-full text-smaller text-removed">
                {failure}
              </p>
            ) : null}
          </div>
        ) : (
          <div key={recording.id} className={ROW}>
            <Chip>Link</Chip>
            <span className="min-w-0 flex-1">
              <span className="block text-row text-text-strong break-words">{recording.label || UNLABELLED_LINK}</span>
              <span className="block text-small text-text-muted wrap-anywhere">{recording.url}</span>
            </span>
            {/* Checked again where it becomes an address: only `http` and `https` are ever opened. */}
            {isWebLink(recording.url) ? (
              <a
                href={recording.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${recording.label || UNLABELLED_LINK}`}
                className={QUIET}
              >
                Open
              </a>
            ) : null}
            <button
              type="button"
              aria-label={`Remove ${recording.label || UNLABELLED_LINK}`}
              onClick={() => {
                setRemoving(recording.id);
                setFailure(null);
              }}
              className={QUIET}
            >
              Remove
            </button>
          </div>
        ),
      )}
      {attaching ? (
        <LinkForm
          pending={addLink.isPending}
          onCancel={() => setAttaching(false)}
          onSave={async (link) => {
            await addLink.mutateAsync(link);
            setAttaching(false);
            flash("Link added.");
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-8">
          <Button variant="ghost" onClick={() => setAttaching(true)}>
            Attach a recording
          </Button>
        </div>
      )}
    </>
  );
}

/** The link form. Until upload is built it is all `Attach a recording` opens. */
function LinkForm({
  pending,
  onSave,
  onCancel,
}: {
  pending: boolean;
  onSave: (link: { url: string; label: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [failure, setFailure] = useState<string | null>(null);

  const save = async () => {
    const link = { url: url.trim(), label: label.trim() };
    // Refused here as the server refuses it, so nothing but a web link is ever sent.
    if (!isWebLink(link.url)) return setFailure(NOT_A_LINK);
    setFailure(null);
    try {
      await onSave(link);
    } catch (error) {
      setFailure(failureText(error));
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Not while an input method is composing: that Enter confirms a conversion, not the form.
    if (event.key !== "Enter" || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    if (!pending) void save();
  };

  return (
    <div className="min-w-0 bg-card border border-border rounded-tile px-14 py-12 grid gap-8">
      <label className="grid gap-4 min-w-0">
        <span className="text-small text-text-secondary">Link to the recording</span>
        <input
          type="url"
          inputMode="url"
          name="recordingUrl"
          autoFocus
          value={url}
          maxLength={LINK_MAX}
          placeholder="https://"
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={onKeyDown}
          className={CONTROL}
        />
      </label>
      <label className="grid gap-4 min-w-0">
        <span className="text-small text-text-secondary">What it is, in a few words</span>
        <input
          name="recordingLabel"
          value={label}
          maxLength={LABEL_MAX}
          placeholder="Their recording of the call"
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={onKeyDown}
          className={CONTROL}
        />
      </label>
      <p className="text-small text-text-muted">
        Only the link is kept. If the recording is taken down where it lives, it is gone here too.
      </p>
      <div className="flex flex-wrap items-center gap-8">
        <Button variant="secondary" onClick={() => void save()} disabled={pending} disabledReason="Adding…">
          {pending ? "Adding…" : "Add the link"}
        </Button>
        <Button variant="bare" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {failure ? (
        <p role="alert" className="text-smaller text-removed">
          {failure}
        </p>
      ) : null}
    </div>
  );
}
