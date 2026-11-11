// FLT-08 photo order rules (docs/06-backend-api.md): pure.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** At most 10 photos per vehicle (FR-VEH-05). */
export const MAX_PHOTOS = 10;

/** The requested order as a list of photo ids, or null when it is not a well-formed list. */
export function parseOrderedIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PHOTOS) return null;
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !UUID.test(item)) return null;
    ids.push(item.toLowerCase());
  }
  return ids;
}

/** True when `ordered` holds exactly the current ids, each once, in any order. */
export function isPermutation(current: readonly string[], ordered: readonly string[]): boolean {
  if (current.length !== ordered.length) return false;
  const remaining = new Set(current);
  for (const id of ordered) {
    if (!remaining.delete(id)) return false;
  }
  return remaining.size === 0;
}

/** The ids with the item at `from` moved to index `to`; null when either index is out of range. */
export function moveTo(ids: readonly string[], from: number, to: number): string[] | null {
  const inRange = (i: number) => Number.isInteger(i) && i >= 0 && i < ids.length;
  if (!inRange(from) || !inRange(to)) return null;
  const next = [...ids];
  const [item] = next.splice(from, 1);
  if (item === undefined) return null;
  next.splice(to, 0, item);
  return next;
}
