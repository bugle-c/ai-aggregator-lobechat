import type { PresetModality } from '@/types/preset';

export interface CategoryDef {
  /** Displayed to user (Russian). */
  label: string;
  /** Matches `presets.category` in DB. `'__all'` is the synthetic "no filter" tab. */
  slug: string;
}

export const VIDEO_CATEGORIES: CategoryDef[] = [
  { label: 'Все', slug: '__all' },
  { label: 'Камера', slug: 'camera' },
  { label: 'Эффекты', slug: 'effects' },
  { label: 'Персонажи', slug: 'character' },
  { label: 'Атмосфера', slug: 'ambient' },
  { label: 'Экшн', slug: 'action' },
];

export const IMAGE_CATEGORIES: CategoryDef[] = [
  { label: 'Все', slug: '__all' },
  { label: 'Портрет', slug: 'portrait' },
  { label: 'Пейзаж', slug: 'landscape' },
  { label: 'Аниме', slug: 'anime' },
  { label: 'Реализм', slug: 'realistic' },
  { label: 'Продукт', slug: 'product' },
  { label: 'Арт', slug: 'artistic' },
];

export const getCategories = (modality: PresetModality): CategoryDef[] =>
  modality === 'video' ? VIDEO_CATEGORIES : IMAGE_CATEGORIES;
