/**
 * `--relabel[=N]`: re-run the LLM classification over rows that were ingested
 * with heuristic labels and rewrite `title`, `description`, `category` and
 * `requires_image`.
 *
 * Rules:
 *   - only ingested rows (`external_id IS NOT NULL`), oldest first, up to N;
 *   - `requires_image` = stored OR regex OR llm — never flips back to false;
 *   - a row that *becomes* i2v while `active` is parked (`active=false`) —
 *     Ф5 re-activates i2v rows with its own script;
 *   - a row the model flags as unsafe is parked as well;
 *   - a failed classification leaves the row untouched;
 *   - DRY-RUN BY DEFAULT — nothing is written unless `apply` is set.
 */
import type { Classifier } from './classify';
import { detectRequiresImage } from './filters';
import {
  loadIngestedPresets,
  type PresetLabelUpdate,
  type Queryable,
  type StoredPreset,
  updatePresetLabels,
} from './upsert';

export const DEFAULT_RELABEL_LIMIT = 100;

export interface RelabelChange {
  after: PresetLabelUpdate;
  before: StoredPreset;
  changed: boolean;
  flags: string[];
}

export interface RelabelOutcome {
  changes: RelabelChange[];
  failed: { reason: string; slug: string }[];
  scanned: number;
  written: number;
}

export interface RelabelOptions {
  apply: boolean;
  limit: number;
  /** Only rows with `ingested_at >= since` (ISO timestamp or date). */
  since?: string;
}

type ClassifierLike = Pick<Classifier, 'classify' | 'stats'>;

export const planRelabel = (
  row: StoredPreset,
  llm: Awaited<ReturnType<Classifier['classify']>>,
): RelabelChange | null => {
  if (!llm.ok) return null;

  const flags: string[] = [];
  const requiresImage =
    row.requires_image || detectRequiresImage(row.prompt_template) || llm.requiresImage;
  const becomesI2v = requiresImage && !row.requires_image;

  let active = row.active;
  if (becomesI2v && active) {
    active = false;
    flags.push('i2v→off');
  }
  if (llm.unsafe) {
    flags.push('unsafe');
    if (active) {
      active = false;
      flags.push('unsafe→off');
    }
  }

  const category = llm.category ?? row.category;
  if (llm.category === null) flags.push(`cat?${llm.rawCategory}`);

  const after: PresetLabelUpdate = {
    active,
    category,
    description: llm.summary,
    requiresImage,
    title: llm.title,
  };

  const changed =
    after.title !== row.title ||
    after.description !== row.description ||
    after.category !== row.category ||
    after.requiresImage !== row.requires_image ||
    after.active !== row.active;

  return { after, before: row, changed, flags };
};

export const runRelabel = async (
  client: Queryable,
  classifier: ClassifierLike,
  options: RelabelOptions,
): Promise<RelabelOutcome> => {
  const rows = await loadIngestedPresets(client, options.limit, options.since);
  const outcome: RelabelOutcome = { changes: [], failed: [], scanned: rows.length, written: 0 };

  if (rows.length === 0) return outcome;

  for (const row of rows) {
    const llm = await classifier.classify({
      aspectRatio: row.params_lock?.aspect_ratio,
      modality: row.modality,
      prompt: row.prompt_template,
    });

    if (!llm.ok) {
      outcome.failed.push({ reason: llm.reason, slug: row.slug });
      // The cap is per run: once hit, every remaining item would fail the same way.
      if (llm.reason === 'cap') break;
      continue;
    }

    const change = planRelabel(row, llm)!;
    outcome.changes.push(change);

    if (options.apply && change.changed) {
      await updatePresetLabels(client, row.id, change.after);
      outcome.written += 1;
    }
  }

  return outcome;
};

// --- table --------------------------------------------------------------------

const pad = (value: string, width: number): string =>
  value.length >= width ? value : value + ' '.repeat(width - value.length);

const cut = (value: string, width: number): string =>
  value.length <= width ? value : `${value.slice(0, width - 1)}…`;

const flag = (value: boolean): string => (value ? 'Y' : '-');

/** Before→after table for the operator. */
export const formatRelabelTable = (outcome: RelabelOutcome): string => {
  const lines: string[] = [];
  const header =
    `${pad('slug', 26)} | ${pad('title: before → after', 84)} | ${pad('category', 22)} | ` +
    `${pad('i2v', 5)} | ${pad('act', 5)} | flags`;
  lines.push(header, '-'.repeat(header.length));

  for (const { after, before, changed, flags } of outcome.changes) {
    lines.push(
      `${pad(cut(before.slug, 26), 26)} | ` +
        `${pad(cut(`«${before.title}» → «${after.title}»`, 84), 84)} | ` +
        `${pad(cut(`${before.category} → ${after.category}`, 22), 22)} | ` +
        `${pad(`${flag(before.requires_image)}→${flag(after.requiresImage)}`, 5)} | ` +
        `${pad(`${flag(before.active)}→${flag(after.active)}`, 5)} | ` +
        `${[...flags, changed ? '' : 'unchanged'].filter(Boolean).join(',')}`,
    );
    lines.push(`${pad('', 26)} |   ${cut(after.description ?? '', 82)}`);
  }

  for (const { reason, slug } of outcome.failed) {
    lines.push(`${pad(cut(slug, 26), 26)} | FAILED: ${reason}`);
  }

  return lines.join('\n');
};
