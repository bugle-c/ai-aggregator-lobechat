/**
 * Preset ingest job — spec Ф4 (автосинхронизация).
 *
 * Standalone Node script driven by system cron on the host, NOT a Next.js
 * route: one run downloads hundreds of MB and shells out to ffmpeg, which no
 * `maxDuration` budget survives. It reuses the app's DB and S3 configuration
 * from `.env` / `.env.local` and nothing else from the server runtime.
 *
 *   npx tsx scripts/ingestPresets/index.ts --dry-run
 *   npx tsx scripts/ingestPresets/index.ts --modality=video --limit=10
 *   npx tsx scripts/ingestPresets/index.ts --relabel=20          # dry-run table
 *   npx tsx scripts/ingestPresets/index.ts --relabel=20 --apply  # writes
 *
 * See ./README.md for flags, the crontab line and failure modes.
 */
import path from 'node:path';

import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';

import { sendAlert } from '../../src/server/services/alerts';
import { Classifier, type ClassifyResult, formatStats } from './classify';
import {
  BLOCKED_LICENSE,
  deriveAttribution,
  deriveCategory,
  deriveTitle,
  LICENSE,
  recommendedModelFor,
  slugFor,
} from './derive';
import { discoverNewItems } from './fetchCatalog';
import { evaluateBatch } from './filters';
import { type Labels, mergeLabels } from './labeling';
import { assertFfmpegAvailable, MediaUploader, processMedia, s3ConfigFromEnv } from './media';
import { DEFAULT_RELABEL_LIMIT, formatRelabelTable, runRelabel } from './relabel';
import type { Evaluation, Modality, PresetInsert, RunReport, SourceItem } from './types';
import { createClient, insertPreset, loadKnownExternalIds, maxSortOrder } from './upsert';

// Bounds that keep a single run finite. `--limit` overrides MAX_NEW_PER_RUN.
const MAX_PAGES_PER_RUN = 15;
const MAX_NEW_PER_RUN = 40;

const ROOT = path.join(__dirname, '../..');

const loadEnv = () => {
  dotenvExpand.expand(dotenv.config({ path: path.join(ROOT, '.env') }));
  dotenvExpand.expand(dotenv.config({ override: true, path: path.join(ROOT, '.env.local') }));
};

// --- CLI --------------------------------------------------------------------

export interface Options {
  /** `--relabel` writes only with this; ingest ignores it. */
  apply: boolean;
  dryRun: boolean;
  limit: number;
  /** `--no-llm` → false: pure heuristics, the pre-LLM behaviour. */
  llm: boolean;
  maxPages: number;
  modalities: Modality[];
  /** `--relabel[=N]`: re-classify N stored rows instead of ingesting. */
  relabel: number | null;
  /** `--since=<ts>`: with `--relabel`, only rows ingested at or after this time. */
  since?: string;
}

export const parseArgs = (argv: string[]): Options => {
  const options: Options = {
    apply: false,
    dryRun: false,
    limit: MAX_NEW_PER_RUN,
    llm: true,
    maxPages: MAX_PAGES_PER_RUN,
    modalities: ['video', 'image'],
    relabel: null,
  };

  for (const arg of argv) {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--no-llm') {
      options.llm = false;
    } else if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--relabel') {
      options.relabel = DEFAULT_RELABEL_LIMIT;
    } else if (arg.startsWith('--relabel=')) {
      const value = Number.parseInt(arg.slice('--relabel='.length), 10);
      if (!Number.isInteger(value) || value <= 0) throw new Error(`bad --relabel: ${arg}`);
      options.relabel = value;
    } else if (arg.startsWith('--since=')) {
      const value = arg.slice('--since='.length);
      if (Number.isNaN(Date.parse(value))) throw new Error(`bad --since (need ISO date/time): ${arg}`);
      options.since = value;
    } else if (arg.startsWith('--limit=')) {
      const value = Number.parseInt(arg.slice('--limit='.length), 10);
      if (!Number.isInteger(value) || value <= 0) throw new Error(`bad --limit: ${arg}`);
      options.limit = value;
    } else if (arg.startsWith('--max-pages=')) {
      const value = Number.parseInt(arg.slice('--max-pages='.length), 10);
      if (!Number.isInteger(value) || value <= 0) throw new Error(`bad --max-pages: ${arg}`);
      options.maxPages = value;
    } else if (arg.startsWith('--modality=')) {
      const value = arg.slice('--modality='.length);
      if (value === 'both') options.modalities = ['video', 'image'];
      else if (value === 'video' || value === 'image') options.modalities = [value];
      else throw new Error(`bad --modality: ${arg}`);
    } else {
      throw new Error(`unknown flag: ${arg}`);
    }
  }

  if (options.relabel !== null && !options.llm) {
    throw new Error('--relabel needs the LLM; drop --no-llm');
  }
  if (options.since && options.relabel === null) {
    throw new Error('--since only applies to --relabel');
  }

  return options;
};

// --- row assembly -----------------------------------------------------------

const mediaSourceUrl = (item: SourceItem, modality: Modality): string | undefined =>
  modality === 'video' ? item.videoUrl : (item.images?.[0] ?? item.image);

/** Labels the keyword tables produce — the fallback when the LLM step is off or failed. */
export const heuristicLabels = (item: SourceItem, modality: Modality): Labels => ({
  category: deriveCategory(item.prompt ?? '', modality),
  description: null,
  title: deriveTitle(item),
});

export const buildRow = (
  item: SourceItem,
  evaluation: Evaluation,
  modality: Modality,
  media: { posterUrl: string | null; previewUrl: string },
  sortOrder: number,
  labels: Labels = heuristicLabels(item, modality),
): PresetInsert => {
  const attribution = deriveAttribution(item);
  const prompt = item.prompt ?? '';

  return {
    active: evaluation.verdict === 'publish',
    authorAvatar: attribution.authorAvatar,
    authorName: attribution.authorName,
    authorUrl: attribution.authorUrl,
    category: labels.category,
    description: labels.description,
    externalId: item.id,
    license: LICENSE,
    modality,
    paramsLock: evaluation.aspectRatio ? { aspect_ratio: evaluation.aspectRatio } : {},
    popularity: item.stats?.likes ?? 0,
    posterUrl: media.posterUrl,
    previewUrl: media.previewUrl,
    promptTemplate: prompt,
    recommendedModelId: recommendedModelFor(modality, evaluation.requiresImage),
    requiresImage: evaluation.requiresImage,
    slug: slugFor(item.id),
    sortOrder,
    sourcePlatform: attribution.sourcePlatform,
    sourceUrl: attribution.sourceUrl,
    title: labels.title,
  };
};

// --- reporting --------------------------------------------------------------

const emptyReport = (): RunReport => ({
  failedMedia: 0,
  fetched: 0,
  new: 0,
  pagesFetched: 0,
  published: 0,
  queued: 0,
  skippedDuplicate: 0,
  skippedSafety: 0,
  skippedUnsafeLlm: 0,
});

export const formatReport = (report: RunReport, dryRun: boolean): string =>
  [
    dryRun ? 'DRY RUN — nothing downloaded, nothing written' : 'ingest complete',
    `pages: ${report.pagesFetched}`,
    `fetched: ${report.fetched}`,
    `new: ${report.new}`,
    `published: ${report.published}`,
    `queued: ${report.queued}`,
    `skipped-safety: ${report.skippedSafety} (llm-unsafe: ${report.skippedUnsafeLlm})`,
    `skipped-duplicate: ${report.skippedDuplicate}`,
    `failed-media: ${report.failedMedia}`,
    report.llm ? formatStats(report.llm) : 'llm: off',
  ].join('\n');

/** One log line per item showing heuristic → LLM so label quality can be judged from the log. */
const describeLabels = (
  heuristic: Labels,
  decision: ReturnType<typeof mergeLabels>,
  llm: ClassifyResult | null,
): string => {
  if (decision.source === 'heuristic') {
    const why = llm && !llm.ok ? ` (llm failed: ${llm.reason})` : '';
    return `«${heuristic.title}» cat=${heuristic.category}${why}`;
  }
  const { labels } = decision;
  const catNote =
    llm?.ok && llm.category === null ? ` (llm wanted "${llm.rawCategory}")` : '';
  return (
    `«${heuristic.title}» → «${labels.title}» cat=${heuristic.category}→${labels.category}${catNote}` +
    ` i2v=${decision.evaluation.requiresImage ? 'Y' : '-'}` +
    (decision.unsafe ? ' UNSAFE' : '') +
    `\n           ${labels.description ?? ''}`
  );
};

// --- run --------------------------------------------------------------------

const preflightS3 = async () => {
  const config = s3ConfigFromEnv();
  const probe = new S3Client({
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    region: config.region,
  });
  await probe.send(new HeadBucketCommand({ Bucket: config.bucket }));
  return new MediaUploader(config);
};

const run = async (options: Options): Promise<RunReport> => {
  const report = emptyReport();

  // Constructed up front so a missing key fails before any network work, but
  // it makes no call until an item actually needs a label — a run with
  // nothing new costs nothing.
  const classifier = options.llm ? Classifier.fromEnv() : null;
  if (classifier) report.llm = classifier.stats;

  const client = createClient();
  await client.connect();

  let uploader: MediaUploader | null = null;

  try {
    if (!options.dryRun) {
      await assertFfmpegAvailable();
      uploader = await preflightS3();
    }

    const known = await loadKnownExternalIds(client);
    let sortOrder = await maxSortOrder(client);
    let budget = options.limit;

    for (const modality of options.modalities) {
      if (budget <= 0) break;

      const discovery = await discoverNewItems(modality, {
        known,
        maxNew: budget,
        maxPages: options.maxPages,
        onPage: (offset, page, fresh) =>
          console.log(
            `[ingest] ${modality} offset=${offset} items=${page.items.length} fresh=${fresh} hasMore=${page.hasMore}`,
          ),
      });

      report.pagesFetched += discovery.pagesFetched;
      report.fetched += discovery.seen;
      report.new += discovery.fresh.length;
      console.log(
        `[ingest] ${modality}: ${discovery.fresh.length} new item(s) over ${discovery.pagesFetched} page(s), stopped=${discovery.stoppedBecause}`,
      );

      const evaluated = evaluateBatch(discovery.fresh, { known, modality });

      for (const { evaluation: heuristicEvaluation, item } of evaluated) {
        if (heuristicEvaluation.verdict === 'skip') {
          if (heuristicEvaluation.reasons[0] === 'duplicate') report.skippedDuplicate += 1;
          else report.skippedSafety += 1;
          console.log(`[ingest] skip ${item.id}: ${heuristicEvaluation.reasons.join(',')}`);
          continue;
        }

        const source = mediaSourceUrl(item, modality);
        if (!source) {
          report.failedMedia += 1;
          console.warn(`[ingest] no media url for ${item.id}`);
          continue;
        }

        // LLM labelling — only for items that survived the free checks above,
        // so stop-list hits and duplicates never cost a call.
        const heuristic = heuristicLabels(item, modality);
        const llm = classifier
          ? await classifier.classify({
              aspectRatio: heuristicEvaluation.aspectRatio,
              modality,
              prompt: item.prompt ?? '',
            })
          : null;
        const decision = mergeLabels({ evaluation: heuristicEvaluation, heuristic, llm });
        const { evaluation, labels } = decision;

        if (decision.unsafe) {
          report.skippedSafety += 1;
          report.skippedUnsafeLlm += 1;
          console.log(`[ingest] skip ${item.id}: safety:llm «${labels.title}»`);
          continue;
        }

        if (options.dryRun) {
          if (evaluation.verdict === 'publish') report.published += 1;
          else report.queued += 1;
          console.log(
            `[ingest] would ${evaluation.verdict} ${item.id} ar=${evaluation.aspectRatio ?? '-'} ` +
              `likes=${item.stats?.likes ?? 0}` +
              (evaluation.reasons.length > 0 ? ` reasons=${evaluation.reasons.join(',')}` : '') +
              `\n           ${describeLabels(heuristic, decision, llm)}`,
          );
          budget -= 1;
          continue;
        }

        let media;
        try {
          media = await processMedia(uploader!, item.id, modality, source);
        } catch (error) {
          report.failedMedia += 1;
          console.warn(`[ingest] media failed for ${item.id}: ${String(error)}`);
          continue;
        }

        sortOrder += 1;
        const row = buildRow(item, evaluation, modality, media, sortOrder, labels);
        const inserted = await insertPreset(client, row);

        if (inserted) {
          if (row.active) report.published += 1;
          else report.queued += 1;
          console.log(
            `[ingest] ${row.active ? 'published' : 'queued'} ${row.slug} ` +
              `${Math.round(media.size / 1024)}KB` +
              (evaluation.reasons.length > 0 ? ` reasons=${evaluation.reasons.join(',')}` : '') +
              `\n           ${describeLabels(heuristic, decision, llm)}`,
          );
        } else {
          report.skippedDuplicate += 1;
          sortOrder -= 1;
        }

        budget -= 1;
        if (budget <= 0) break;
      }
    }

    if (report.pagesFetched === 0) {
      throw new Error('no catalogue page was parsed — the source or the reader proxy is down');
    }

    return report;
  } finally {
    await client.end();
  }
};

/**
 * `--relabel[=N]`: re-classify stored rows. Dry-run unless `--apply`. Does
 * not touch the catalogue, S3 or ffmpeg, and exits 0 without a single LLM
 * call when there is nothing to relabel.
 */
const relabel = async (options: Options): Promise<void> => {
  const limit = options.relabel!;
  const classifier = Classifier.fromEnv();
  const client = createClient();
  await client.connect();

  try {
    console.log(
      `[relabel] ${options.apply ? 'APPLY — rows will be updated' : 'DRY RUN — nothing written (add --apply)'}; ` +
        `up to ${limit} oldest ingested rows${options.since ? ` since ${options.since}` : ''}, ` +
        `llm cap ${classifier.callsLeft}`,
    );

    const outcome = await runRelabel(client, classifier, {
      apply: options.apply,
      limit,
      since: options.since,
    });

    if (outcome.scanned === 0) {
      console.log('[relabel] no ingested rows — nothing to do');
      return;
    }

    console.log(`\n${formatRelabelTable(outcome)}\n`);
    console.log(
      [
        options.apply ? 'relabel complete' : 'RELABEL DRY RUN — nothing written',
        `scanned: ${outcome.scanned}`,
        `relabelled: ${outcome.changes.length} (changed: ${outcome.changes.filter((c) => c.changed).length})`,
        // Rows the model flagged unsafe — parked and stamped `license=blocked`,
        // which the activation script refuses. Newly blocked ones in brackets.
        `blocked: ${outcome.changes.filter((c) => c.after.license === BLOCKED_LICENSE).length} ` +
          `(new: ${outcome.changes.filter((c) => c.flags.includes('blocked+')).length})`,
        `written: ${outcome.written}`,
        `failed: ${outcome.failed.length}`,
        formatStats(classifier.stats),
      ].join('\n'),
    );
  } finally {
    await client.end();
  }
};

const USAGE =
  'usage: tsx scripts/ingestPresets/index.ts [--dry-run] [--limit=N] [--max-pages=N] ' +
  '[--modality=video|image|both] [--no-llm] | --relabel[=N] [--since=<iso>] [--apply]';

const main = async () => {
  loadEnv();

  let options: Options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(String(error));
    console.error(USAGE);
    process.exit(2);
  }

  if (options.relabel !== null) {
    try {
      await relabel(options);
      process.exit(0);
    } catch (error) {
      console.error('[relabel] failed:', error instanceof Error ? error.stack : String(error));
      process.exit(1);
    }
  }

  try {
    const report = await run(options);
    console.log(`\n${formatReport(report, options.dryRun)}`);
    process.exit(0);
  } catch (error) {
    const body = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
    console.error('[ingest] run failed:', body);
    await sendAlert({
      body: body.slice(0, 1500),
      metadata: { modalities: options.modalities.join(',') },
      severity: 'critical',
      title: 'Preset ingest failed',
    });
    process.exit(1);
  }
};

// `require.main` is undefined when the module is imported by vitest.
if (require.main === module) void main();
