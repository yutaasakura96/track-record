/**
 * The recordings of one interview entry, on its card
 * (`docs/10-screen-specifications.md`, Screen 13; issues #74 and #76).
 *
 * A recording is a link to one kept somewhere else, a row with `Open` and
 * `Remove`, or an uploaded audio file, a row with `Play`, `Download` and
 * `Remove`. Under the rows, `Attach a recording` opens a card in place with
 * `Upload audio` and `Add a link instead`.
 *
 * A file is checked here as the server checks it, its size and its first
 * bytes, so one that would be refused is refused before anything is sent. An
 * upload is one request whose progress is shown; one cut off says so with
 * `Try again`, and nothing is listed, since the server lists a recording only
 * once its whole file is stored.
 *
 * Remove asks once, in place of the row. A removed recording leaves a line
 * saying so and the day, since it is the one thing the author can remove.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { UploadInterrupted, failureText, recordingAudioPath, useRecordings, type UploadProgress } from "../api";
import { useFlashStore } from "../stores/flash";
import type { Interview } from "~/shared/interview";
import {
  AUDIO_ACCEPT,
  AUDIO_HEAD_BYTES,
  AUDIO_KINDS,
  LABEL_MAX,
  LINK_MAX,
  NOT_A_LINK,
  RECORDING_MAX_BYTES,
  RECORDING_MAX_MB,
  UNLABELLED_LINK,
  audioTypeOf,
  emptyFile,
  isWebLink,
  megabytes,
  notAudio,
  playingTime,
  tooLarge,
  type Recording,
} from "~/shared/recording";
import { CONTROL } from "./application-chrome";
import { QUIET } from "./document-row";
import { Button, Chip, ProgressBar } from "./ui";

/** A row inside an interview's card: a recording, or a question asked once before something is removed. */
export const ROW =
  "min-w-0 flex flex-wrap items-center gap-10 bg-surface-raised border border-border-control rounded-control px-10 py-8";

/** What `Attach a recording` has open: its two choices, the link form, an upload under way, or one that stopped. */
type Attach =
  | { step: "menu"; refusal: string | null }
  | { step: "link" }
  | { step: "uploading"; name: string; progress: UploadProgress }
  | { step: "interrupted"; file: File; durationSeconds: number | null };

/** A recording's name as Remove and a screen reader say it. */
const nameOf = (recording: Exclude<Recording, { kind: "removed" }>) =>
  recording.kind === "upload" ? recording.fileName : recording.label || UNLABELLED_LINK;

export function InterviewRecordings({ applicationId, entry }: { applicationId: string; entry: Interview }) {
  const { addLink, upload, remove } = useRecordings(applicationId, entry.id);
  const flash = useFlashStore((state) => state.show);
  const [attach, setAttach] = useState<Attach | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const chooser = useRef<HTMLInputElement>(null);
  const uploading = attach?.step === "uploading";

  // Leaving the page cuts an upload off; the browser asks first.
  useEffect(() => {
    if (!uploading) return;
    const hold = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", hold);
    return () => window.removeEventListener("beforeunload", hold);
  }, [uploading]);

  const askRemove = (recordingId: string) => {
    setRemoving(recordingId);
    setFailure(null);
  };

  const removeIt = async (recording: Recording) => {
    setFailure(null);
    try {
      await remove.mutateAsync(recording.id);
      setRemoving(null);
      if (playing === recording.id) setPlaying(null);
      flash("Recording removed.");
    } catch (error) {
      setFailure(failureText(error));
    }
  };

  const send = async (file: File, durationSeconds: number | null) => {
    setAttach({ step: "uploading", name: file.name, progress: { loaded: 0, total: file.size } });
    try {
      await upload.mutateAsync({
        file,
        durationSeconds,
        onProgress: (progress) => setAttach({ step: "uploading", name: file.name, progress }),
      });
      setAttach(null);
      flash("Recording uploaded.");
    } catch (error) {
      if (error instanceof UploadInterrupted) return setAttach({ step: "interrupted", file, durationSeconds });
      setAttach({ step: "menu", refusal: failureText(error) });
    }
  };

  const chosen = async (file: File | undefined) => {
    if (!file) return;
    const refusal = await refusalOf(file);
    if (refusal) return setAttach({ step: "menu", refusal });
    await send(file, await durationOf(file));
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
              Remove {recording.kind === "upload" ? recording.fileName : recording.label || "this link"} for good?{" "}
              {recording.kind === "upload"
                ? "The file is deleted from storage and cannot be brought back."
                : "Only the link is removed; the recording stays where it lives."}{" "}
              The interview keeps a line saying one was removed.
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
            <Chip>{recording.kind === "upload" ? "Audio" : "Link"}</Chip>
            {recording.kind === "upload" ? (
              <span className="min-w-0 flex-1">
                <span className="block text-row text-text-strong break-words">{recording.fileName}</span>
                <span className="block text-small text-text-muted">
                  {[
                    megabytes(recording.byteSize),
                    ...(recording.durationSeconds === null ? [] : [playingTime(recording.durationSeconds)]),
                    `uploaded ${recording.uploadedOn}`,
                    "only you can play it",
                  ].join(" · ")}
                </span>
              </span>
            ) : (
              <span className="min-w-0 flex-1">
                <span className="block text-row text-text-strong break-words">{recording.label || UNLABELLED_LINK}</span>
                <span className="block text-small text-text-muted wrap-anywhere">{recording.url}</span>
              </span>
            )}
            {recording.kind === "upload" ? (
              // Three actions beside the name leave it a few letters wide on a phone, so there they take a line of their own.
              <span className="flex flex-wrap items-center gap-10 max-phone:basis-full max-phone:justify-end">
                {playing === recording.id ? null : (
                  <Button variant="ghost" aria-label={`Play ${recording.fileName}`} onClick={() => setPlaying(recording.id)}>
                    Play
                  </Button>
                )}
                <a
                  href={`${recordingAudioPath(applicationId, entry.id, recording.id)}?download`}
                  download={recording.fileName}
                  aria-label={`Download ${recording.fileName}`}
                  className={QUIET}
                >
                  Download
                </a>
                <RemoveLink recording={recording} onClick={() => askRemove(recording.id)} />
              </span>
            ) : /* Checked again where it becomes an address: only `http` and `https` are ever opened. */
            isWebLink(recording.url) ? (
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
            {recording.kind === "link" ? <RemoveLink recording={recording} onClick={() => askRemove(recording.id)} /> : null}
            {recording.kind === "upload" && playing === recording.id ? (
              // Played from the Worker, which answers ranges: that is what lets it seek.
              <audio
                controls
                autoPlay
                preload="metadata"
                aria-label={`${recording.fileName}, playing`}
                src={recordingAudioPath(applicationId, entry.id, recording.id)}
                className="basis-full w-full min-w-0"
              />
            ) : null}
          </div>
        ),
      )}
      {attach === null ? (
        <div className="flex flex-wrap items-center gap-8">
          <Button variant="ghost" onClick={() => setAttach({ step: "menu", refusal: null })}>
            Attach a recording
          </Button>
        </div>
      ) : attach.step === "link" ? (
        <LinkForm
          pending={addLink.isPending}
          onCancel={() => setAttach(null)}
          onSave={async (link) => {
            await addLink.mutateAsync(link);
            setAttach(null);
            flash("Link added.");
          }}
        />
      ) : attach.step === "uploading" ? (
        <div role="status" className={`${ROW} items-start`}>
          <span className="mt-6 size-6 rounded-full bg-accent motion-working shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 grid gap-6">
            <span className="text-row text-text-strong break-words">Uploading {attach.name}</span>
            <span
              role="progressbar"
              aria-label={`Uploading ${attach.name}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.floor((attach.progress.loaded / Math.max(1, attach.progress.total)) * 100)}
            >
              <ProgressBar size="block" value={attach.progress.loaded / Math.max(1, attach.progress.total)} />
            </span>
            <span className="text-small text-text-muted">
              {Math.floor(attach.progress.loaded / (1024 * 1024))} of {Math.max(1, Math.round(attach.progress.total / (1024 * 1024)))} MB.
              Keep this page open.
            </span>
          </span>
        </div>
      ) : attach.step === "interrupted" ? (
        <div role="alert" className={ROW}>
          <span className="min-w-0 flex-1 text-small text-text-secondary break-words">
            The upload of {attach.file.name} stopped before it finished, so nothing was kept.
          </span>
          <Button variant="secondary" onClick={() => void send(attach.file, attach.durationSeconds)}>
            Try again
          </Button>
          <Button variant="bare" onClick={() => setAttach(null)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="min-w-0 bg-card border border-border rounded-tile px-14 py-12 grid gap-8">
          <div className="flex flex-wrap items-center gap-8">
            <input
              ref={chooser}
              type="file"
              accept={AUDIO_ACCEPT}
              hidden
              aria-label="Choose an audio file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                void chosen(file);
              }}
            />
            <Button variant="secondary" autoFocus onClick={() => chooser.current?.click()}>
              Upload audio
            </Button>
            <Button variant="ghost" onClick={() => setAttach({ step: "link" })}>
              Add a link instead
            </Button>
            <Button variant="bare" onClick={() => setAttach(null)}>
              Cancel
            </Button>
          </div>
          <p className="text-small text-text-muted">
            Audio ({AUDIO_KINDS}), up to {RECORDING_MAX_MB} MB a file. It is stored privately and only you, signed in, can
            play it. Other people's voices are on it, so nothing here shares it or sends it anywhere.
          </p>
          {attach.refusal ? (
            <p role="alert" className="text-smaller text-removed">
              {attach.refusal}
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}

function RemoveLink({ recording, onClick }: { recording: Exclude<Recording, { kind: "removed" }>; onClick: () => void }) {
  return (
    <button type="button" aria-label={`Remove ${nameOf(recording)}`} onClick={onClick} className={QUIET}>
      Remove
    </button>
  );
}

/** Why a chosen file would be refused, said before anything is sent, or null when it would not be. */
async function refusalOf(file: File): Promise<string | null> {
  if (file.size === 0) return emptyFile(file.name);
  if (file.size > RECORDING_MAX_BYTES) return tooLarge(file.name, file.size);
  const head = new Uint8Array(await file.slice(0, AUDIO_HEAD_BYTES).arrayBuffer());
  return audioTypeOf(head) ? null : notAudio(file.name, file.type || undefined);
}

/**
 * How long a file plays, read by the browser from its own header, in whole
 * seconds. Null when it cannot say within a few seconds; the row then leaves
 * the length out rather than guess.
 */
function durationOf(file: File): Promise<number | null> {
  if (typeof URL.createObjectURL !== "function") return Promise.resolve(null);
  let address: string;
  try {
    address = URL.createObjectURL(file);
  } catch {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    const done = (seconds: number | null) => {
      clearTimeout(timer);
      audio.removeAttribute("src");
      URL.revokeObjectURL(address);
      resolve(seconds);
    };
    const timer = setTimeout(() => done(null), 5_000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.duration) : null);
    audio.onerror = () => done(null);
    audio.src = address;
  });
}

/** The link form, opened from `Add a link instead`. */
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
