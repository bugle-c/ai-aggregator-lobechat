/**
 * Russian display labels for preset category slugs.
 *
 * This is a *label* map, not a category list — the list of categories the
 * gallery renders comes from `presets.facets` (the DB), so a category the
 * ingest cron invents is still reachable. Anything missing here falls back to
 * the capitalized slug rather than disappearing from the UI.
 */
export const CATEGORY_LABELS: Record<string, string> = {
  action: 'Экшн',
  ambient: 'Атмосфера',
  anime: 'Аниме',
  artistic: 'Арт',
  camera: 'Камера',
  character: 'Персонажи',
  effects: 'Эффекты',
  landscape: 'Пейзаж',
  portrait: 'Портрет',
  product: 'Продукт',
  realistic: 'Реализм',
};

/** Synthetic "no category filter" tab key. */
export const ALL_CATEGORIES_KEY = '__all';

const capitalize = (s: string): string =>
  s.length === 0 ? s : s[0].toUpperCase() + s.slice(1).replaceAll(/[_-]/g, ' ');

export const categoryLabel = (slug: string): string => CATEGORY_LABELS[slug] ?? capitalize(slug);
