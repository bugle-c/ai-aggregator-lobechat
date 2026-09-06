/**
 * Russian display labels for preset category slugs.
 *
 * This is a *label* map, not a category list — the list of categories the
 * gallery renders comes from `presets.facets` (the DB), so a category the
 * ingest cron invents is still reachable. Anything missing here falls back to
 * the capitalized slug rather than disappearing from the UI.
 *
 * Slugs are never renamed here: `derive.ts` rules, the facets query, the
 * `?category=` URL and the tests all key on them. Only the wording changes.
 */
export const CATEGORY_LABELS: Record<string, string> = {
  '3d': '3D и анимация',
  'action': 'Экшн',
  'ad': 'Реклама и товары',
  'ambient': 'Атмосфера',
  'anime': 'Аниме',
  'artistic': 'Иллюстрация',
  'camera': 'Движение камеры',
  'character': 'Персонажи',
  'cinematic': 'Кино',
  'effects': 'Эффекты',
  'fantasy': 'Фэнтези',
  'landscape': 'Пейзажи',
  'portrait': 'Портреты',
  'product': 'Товары и реклама',
  'realistic': 'Фотореализм',
  // Fallback slug used by the ingest cron when no keyword rule matches — it
  // is "everything else", not a trend signal, and is labelled as such.
  'trends': 'Разное',
  'vlog': 'Влог и селфи',
};

/**
 * Fixed display order for the category chips, so the strip does not
 * reshuffle after every nightly ingest changes the counts. Video slugs
 * first, then image slugs (a gallery only ever shows one modality, so the
 * two halves never meet). Slugs not listed here go after these, ordered by
 * count; the fallback `trends` is always last.
 */
export const CATEGORY_ORDER: readonly string[] = [
  // video
  'cinematic',
  'action',
  'vlog',
  'character',
  '3d',
  'anime',
  'effects',
  'ad',
  'fantasy',
  'camera',
  'ambient',
  // image
  'portrait',
  'realistic',
  'artistic',
  'landscape',
  'product',
];

/** Slug that must sort last regardless of its count. */
export const FALLBACK_CATEGORY = 'trends';

/** Synthetic "no category filter" tab key. */
export const ALL_CATEGORIES_KEY = '__all';

const capitalize = (s: string): string =>
  s.length === 0 ? s : s[0].toUpperCase() + s.slice(1).replaceAll(/[_-]/g, ' ');

export const categoryLabel = (slug: string): string => CATEGORY_LABELS[slug] ?? capitalize(slug);

/**
 * Comparator implementing `CATEGORY_ORDER`: known slugs by their position,
 * unknown slugs after them by descending count, `trends` last.
 */
export const compareCategories = (
  a: { category: string; count: number },
  b: { category: string; count: number },
): number => {
  const rank = (slug: string): number => {
    if (slug === FALLBACK_CATEGORY) return Number.MAX_SAFE_INTEGER;
    const i = CATEGORY_ORDER.indexOf(slug);
    return i === -1 ? CATEGORY_ORDER.length : i;
  };
  const ra = rank(a.category);
  const rb = rank(b.category);
  if (ra !== rb) return ra - rb;
  if (b.count !== a.count) return b.count - a.count;
  return a.category.localeCompare(b.category);
};
