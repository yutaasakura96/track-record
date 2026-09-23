/**
 * Move up / Move down, shared by Version Edit's blocks and Skills' groups and
 * skills. The screens offer a move only where one exists (no Move up on the
 * first, no Move down on the last), so `index + by` is always in range here.
 */

/** A copy of `list` with the item at `index` moved one place in the direction `by`. */
export const moved = <T,>(list: readonly T[], index: number, by: -1 | 1): T[] => {
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(index + by, 0, item!);
  return next;
};
