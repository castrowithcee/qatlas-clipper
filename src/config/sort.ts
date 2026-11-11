export type SortMode = 'manual' | 'nameAsc' | 'nameDesc';

/**
 * Items in display order. `manual` keeps the given order; the name orders compare by the UI language without regard to
 * case. Equal names keep their given order, so the stored manual order never changes by sorting (a new array is returned).
 */
export function sortByLabel<T>(items: readonly T[], mode: SortMode, language: string, label: (item: T) => string): T[] {
  if (mode === 'manual') return [...items];
  const collator = new Intl.Collator(language, { sensitivity: 'accent' });
  const sign = mode === 'nameAsc' ? 1 : -1;
  return [...items].sort((a, b) => sign * collator.compare(label(a), label(b)));
}
