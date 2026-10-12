/**
 * Recordings on an interview entry (issue #74).
 *
 * A recording here is a link to one kept somewhere else: only the link is
 * held, and it is opened only when the author clicks it. Uploading an audio
 * file is a later kind (#76) and adds to this module. These rules are read by
 * the route that saves a link and by the form that writes one.
 *
 * A recording is the one thing the author can remove. What is left of one is a
 * line saying so and the day, which is the third shape below.
 */

export const LINK_MAX = 2_000;
export const LABEL_MAX = 200;

/** What a link reads as when the author gave it no label. */
export const UNLABELLED_LINK = "Recording kept elsewhere";

export const NOT_A_LINK = "That does not look like a link. It should start with https://";

/** A recording as it is read back, oldest first on its entry. */
export type Recording =
  | { id: string; kind: "link"; url: string; label: string }
  /** `removedOn` is `YYYY-MM-DD`, the day in Japan it was removed. */
  | { id: string; kind: "removed"; removedOn: string };

/**
 * Whether a piece of text is a link this app will keep and open: `http` or
 * `https`, with a host, and nothing else. `javascript:`, `data:`, `file:` and a
 * bare `example.com` are all refused, since the link becomes an `href`.
 */
export function isWebLink(text: string): boolean {
  if (!/^https?:\/\/\S+$/i.test(text)) return false;
  try {
    const { protocol, hostname } = new URL(text);
    return (protocol === "http:" || protocol === "https:") && hostname !== "";
  } catch {
    return false;
  }
}
