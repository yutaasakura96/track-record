/**
 * Display formatting. Shared so that "3 d ago" means the same thing on every
 * screen.
 */

/** A relative time, coarse on purpose — the record is measured in months. */
export function relative(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  // Older than a month, the month itself is the useful unit — and the day is
  // never displayed anywhere in this product.
  return new Date(iso).toISOString().slice(0, 7);
}
