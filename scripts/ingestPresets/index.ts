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
 *
 * See ./README.md for flags, the crontab line and failure modes.
 */
import path from 'node:path';

import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';

import { sendAlert } from '../../src/server/services/alerts';
import { deriveAttribution, deriveCategory, deriveTitle, LICENSE, slugFor } from './derive';
import { discoverNewItems } from './fetchCatalog';
import { evaluateBatch } from './filters';
import { assertFfmpegAvailable, MediaUploader, processMedia, s3ConfigFromEnv } from './media';
import type { Evaluation, Modality, PresetInsert, RunReport, SourceItem } from './types';
import {
  createClient,
  DEFAULT_MODEL,
  insertPreset,
  loadKnownExternalIds,
  maxSortOrder,
} from './upsert';

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
  dryRun: boolean;
  limit: number;
  maxPages: number;
  modalities: Modality[];
}

export const parseArgs = (argv: string[]): Options => {
  const options: Options = {
    dryRun: false,
    limit: MAX_NEW_PER_RUN,
    maxPages: MAX_PAGES_PER_RUN,
    modalities: ['video', 'image'],
  };

  for (const arg of argv) {
    if (arg === '--dry-run') {
      options.dryRun = true;
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

  return options;
};

// --- row assembly -----------------------------------------------------------

const mediaSourceUrl = (item: SourceItem, modality: Modality): string | undefined =>
  modality === 'video' ? item.videoUrl : (item.images?.[0] ?? item.image);

export const buildRow = (
  item: SourceItem,
  evaluation: Evaluation,
  modality: Modality,
  media: { posterUrl: string | null; previewUrl: string },
  sortOrder: number,
): PresetInsert => {
  const attribution = deriveAttribution(item);
  const prompt = item.prompt ?? '';

  return {
    active: evaluation.verdict === 'publish',
    authorAvatar: attribution.authorAvatar,
    authorName: attribution.authorName,
    authorUrl: attribution.authorUrl,
    category: deriveCategory(prompt, modality),
    externalId: item.id,
    license: LICENSE,
    modality,
    paramsLock: evaluation.aspectRatio ? { aspect_ratio: evaluation.aspectRatio } : {},
    popularity: item.stats?.likes ?? 0,
    posterUrl: media.posterUrl,
    previewUrl: media.previewUrl,
    promptTemplate: prompt,
    recommendedModelId: DEFAULT_MODEL[modality],
    requiresImage: evaluation.requiresImage,
    slug: slugFor(item.id),
    sortOrder,
    sourcePlatform: attribution.sourcePlatform,
    sourceUrl: attribution.sourceUrl,
    title: deriveTitle(item),
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
});

export const formatReport = (report: RunReport, dryRun: boolean): string =>
  [
    dryRun ? 'DRY RUN — nothing downloaded, nothing written' : 'ingest complete',
    `pages: ${report.pagesFetched}`,
    `fetched: ${report.fetched}`,
    `new: ${report.new}`,
    `published: ${report.published}`,
    `queued: ${report.queued}`,
    `skipped-safety: ${report.skippedSafety}`,
    `skipped-duplicate: ${report.skippedDuplicate}`,
    `failed-media: ${report.failedMedia}`,
  ].join('\n');

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

      for (const { evaluation, item } of evaluated) {
        if (evaluation.verdict === 'skip') {
          if (evaluation.reasons[0] === 'duplicate') report.skippedDuplicate += 1;
          else report.skippedSafety += 1;
          console.log(`[ingest] skip ${item.id}: ${evaluation.reasons.join(',')}`);
          continue;
        }

        const source = mediaSourceUrl(item, modality);
        if (!source) {
          report.failedMedia += 1;
          console.warn(`[ingest] no media url for ${item.id}`);
          continue;
        }

        if (options.dryRun) {
          if (evaluation.verdict === 'publish') report.published += 1;
          else report.queued += 1;
          console.log(
            `[ingest] would ${evaluation.verdict} ${item.id} «${deriveTitle(item)}» ` +
              `cat=${deriveCategory(item.prompt ?? '', modality)} ar=${evaluation.aspectRatio ?? '-'} ` +
              `likes=${item.stats?.likes ?? 0}` +
              (evaluation.reasons.length > 0 ? ` reasons=${evaluation.reasons.join(',')}` : ''),
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
        const row = buildRow(item, evaluation, modality, media, sortOrder);
        const inserted = await insertPreset(client, row);

        if (inserted) {
          if (row.active) report.published += 1;
          else report.queued += 1;
          console.log(
            `[ingest] ${row.active ? 'published' : 'queued'} ${row.slug} «${row.title}» ` +
              `cat=${row.category} ${Math.round(media.size / 1024)}KB` +
              (evaluation.reasons.length > 0 ? ` reasons=${evaluation.reasons.join(',')}` : ''),
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

const main = async () => {
  loadEnv();

  let options: Options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(String(error));
    console.error(
      'usage: tsx scripts/ingestPresets/index.ts [--dry-run] [--limit=N] [--max-pages=N] [--modality=video|image|both]',
    );
    process.exit(2);
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
