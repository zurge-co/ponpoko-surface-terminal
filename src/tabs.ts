export const TAB_TITLE_MAX = 40;

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (!Number.isInteger(from) || from < 0 || from >= next.length) return next;
  if (!Number.isInteger(to)) return next;
  const target = Math.min(next.length - 1, Math.max(0, to));
  if (target === from) return next;
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

export function dropTargetIndex(from: number, slot: number, length: number): number {
  if (length <= 0) return 0;
  const adjusted = slot > from ? slot - 1 : slot;
  return Math.min(length - 1, Math.max(0, adjusted));
}

export function cleanTabTitle(value: string, fallback: string): string {
  const cleaned = Array.from(
    value
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  )
    .slice(0, TAB_TITLE_MAX)
    .join("")
    .trim();
  return cleaned.length > 0 ? cleaned : fallback;
}
