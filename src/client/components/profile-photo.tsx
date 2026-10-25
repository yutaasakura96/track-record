/**
 * The 履歴書's 写真 on the profile (issue #117, review issue 8).
 *
 * Optional. A photo chosen here is cropped to 3:4 in the browser — moved by
 * dragging or with the arrow keys, zoomed with the slider — and sent as a JPEG
 * of the cropped part alone, which the 履歴書 places in its 写真 cell at
 * 30 × 40 mm. It appears in no other document, and Remove takes it off for
 * good. A sent copy keeps the file it was sent as, photo included.
 *
 * Saved on its own, apart from the form: the photo is a column of the profile
 * row, so it is offered once that row exists.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ApiError, failureText, useProfile, useProfilePhotoSrc, useRemoveProfilePhoto, useSaveProfilePhoto } from "../api";
import { INITIAL_CROP, MAX_ZOOM, clampCrop, cropToJpeg, drawnSize, sourceRect, type Crop, type Size } from "../photo-crop";
import { Button, Panel } from "./ui";
import { PHOTO_ACCEPT, PHOTO_MIN_WIDTH, PHOTO_TOO_SMALL } from "~/shared/photo";

/** How far one arrow key moves the photo, in frame pixels. */
const STEP = 8;

const CANNOT_OPEN = "This browser cannot open that image. Choose a JPEG or PNG.";

interface Chosen {
  url: string;
  image: HTMLImageElement;
  size: Size;
}

export function ProfilePhoto() {
  const profile = useProfile();
  const src = useProfilePhotoSrc();
  const save = useSaveProfilePhoto();
  const remove = useRemoveProfilePhoto();
  const chooser = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  // The chosen file's address lives as long as the cropper does.
  useEffect(() => () => {
    if (chosen) URL.revokeObjectURL(chosen.url);
  }, [chosen]);

  if (!profile.data) {
    return (
      <Panel heading="写真 · Photo">
        <p className="text-small text-text-dim">Optional. Save your details first, then add a photo here.</p>
      </Panel>
    );
  }

  function choose(file: File | undefined) {
    if (!file) return;
    setRefusal(null);
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => setChosen({ url, image, size: { width: image.naturalWidth, height: image.naturalHeight } });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setRefusal(CANNOT_OPEN);
    };
    image.src = url;
  }

  async function keep(crop: Crop, frame: Size) {
    if (!chosen) return;
    if (sourceRect(chosen.size, frame, crop).width < PHOTO_MIN_WIDTH) {
      setRefusal(PHOTO_TOO_SMALL);
      return;
    }
    try {
      await save.mutateAsync(await cropToJpeg(chosen.image, chosen.size, frame, crop));
      setChosen(null);
    } catch (error) {
      // A refusal from the server, or the browser failing to draw the photo.
      setRefusal(error instanceof Error && !(error instanceof ApiError) ? error.message : failureText(error));
    }
  }

  async function takeOff() {
    setRefusal(null);
    try {
      await remove.mutateAsync();
    } catch (error) {
      setRefusal(failureText(error));
    }
  }

  return (
    <Panel heading="写真 · Photo">
      <p className="text-small text-text-dim">
        Optional. Placed in the 履歴書's 写真 cell at 30 × 40 mm, and in no other document. Without one the cell is left
        empty for you to fill in Word.
      </p>
      <input
        ref={chooser}
        type="file"
        accept={PHOTO_ACCEPT}
        hidden
        aria-label="Choose a photo"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          choose(file);
        }}
      />
      {chosen ? (
        <Cropper
          key={chosen.url}
          chosen={chosen}
          saving={save.isPending}
          onKeep={(crop, frame) => void keep(crop, frame)}
          onCancel={() => {
            setChosen(null);
            setRefusal(null);
          }}
        />
      ) : (
        <div className="mt-14 flex flex-wrap items-end gap-16">
          {src ? (
            <img src={src} alt="Your 履歴書 photo" className="w-photo-preview aspect-photo object-cover border border-border-control rounded-control" />
          ) : (
            <div className="w-photo-preview aspect-photo flex items-center justify-center bg-shade border border-dashed border-border-control rounded-control text-small text-text-dim">
              写真
            </div>
          )}
          <div className="flex flex-wrap items-center gap-8">
            <Button type="button" variant="secondary" onClick={() => chooser.current?.click()}>
              {src ? "Replace photo" : "Add a photo"}
            </Button>
            {src ? (
              <Button type="button" variant="ghost" onClick={() => void takeOff()}>
                {remove.isPending ? "Removing…" : "Remove photo"}
              </Button>
            ) : null}
          </div>
        </div>
      )}
      {src && !chosen ? (
        <p className="mt-8 text-smaller text-text-faint">A copy already recorded as sent keeps the photo it was sent with.</p>
      ) : null}
      {refusal ? (
        <p role="alert" className="mt-8 text-smaller text-removed">
          {refusal}
        </p>
      ) : null}
    </Panel>
  );
}

/**
 * The 3:4 frame over the chosen image. The frame's own size is read from the
 * page, so what is kept is what was shown at whatever size the screen drew it.
 */
function Cropper({
  chosen,
  saving,
  onKeep,
  onCancel,
}: {
  chosen: Chosen;
  saving: boolean;
  onKeep: (crop: Crop, frame: Size) => void;
  onCancel: () => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<Size>({ width: 240, height: 320 });
  const [crop, setCrop] = useState<Crop>(INITIAL_CROP);
  const drag = useRef<{ x: number; y: number; from: Crop["offset"] } | null>(null);

  useEffect(() => {
    const box = frameRef.current?.getBoundingClientRect();
    if (box && box.width > 0) setFrame({ width: box.width, height: box.height });
    frameRef.current?.focus();
  }, []);

  const held = clampCrop(chosen.size, frame, crop);
  const drawn = drawnSize(chosen.size, frame, held.zoom);
  const move = (x: number, y: number) => setCrop((c) => clampCrop(chosen.size, frame, { ...c, offset: { x, y } }));

  function onKeyDown(event: KeyboardEvent) {
    const by = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] }[event.key];
    if (!by) return;
    event.preventDefault();
    move(held.offset.x + by[0]!, held.offset.y + by[1]!);
  }

  function onPointerDown(event: PointerEvent) {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, from: held.offset };
  }

  function onPointerMove(event: PointerEvent) {
    if (!drag.current) return;
    move(drag.current.from.x + event.clientX - drag.current.x, drag.current.from.y + event.clientY - drag.current.y);
  }

  return (
    <div className="mt-14 grid gap-12 justify-items-start">
      <div
        ref={frameRef}
        role="img"
        aria-label="The part of the photo that is kept. Drag it, or use the arrow keys, to move it."
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        className="relative w-photo max-w-full aspect-photo overflow-hidden bg-shade border border-border-active rounded-control cursor-move touch-none outline-none focus:shadow-ring"
      >
        <img
          src={chosen.url}
          alt=""
          draggable={false}
          className="absolute max-w-none select-none pointer-events-none"
          style={{
            width: drawn.width,
            height: drawn.height,
            left: (frame.width - drawn.width) / 2 + held.offset.x,
            top: (frame.height - drawn.height) / 2 + held.offset.y,
          }}
        />
      </div>
      <label className="grid gap-6 w-photo max-w-full">
        <span className="text-smaller text-text-dim">Zoom</span>
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={held.zoom}
          onChange={(event) => setCrop((c) => clampCrop(chosen.size, frame, { ...c, zoom: Number(event.target.value) }))}
        />
      </label>
      <p className="text-smaller text-text-faint">Cropped to 3:4, the 履歴書 photo's 30 × 40 mm. Only the part in the frame is kept.</p>
      <div className="flex flex-wrap items-center gap-8">
        <Button type="button" variant="primary" onClick={() => onKeep(held, frame)}>
          {saving ? "Saving…" : "Save photo"}
        </Button>
        <Button type="button" variant="bare" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
