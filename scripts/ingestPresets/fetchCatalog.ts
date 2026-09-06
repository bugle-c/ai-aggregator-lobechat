/**
 * Catalogue access for the preset ingest job.
 *
 * meigen.ai sits behind a Cloudflare *managed challenge* — curl, headless
 * Chromium and bot UAs all get 403. The only channel that works is the
 * r.jina.ai reader proxy, and only with BOTH headers below: without
 * `x-no-cache` the proxy happily serves a stale body from a *different*
 * endpoint. Pagination is `?offset=N` step 20; `?page=` is silently ignored
 * and returns page 1 forever.
 */
import type { CatalogPage, Modality, SourceItem } from './types';

export const PAGE_SIZE = 20;

const READER_PREFIX = 'https://r.jina.ai/';
const ORIGIN = 'https://www.meigen.ai';

const ENDPOINT: Record<Modality, string> = {
  image: '/api/images',
  video: '/api/videos',
};

export const catalogUrl = (modality: Modality, offset: number): string =>
  `${READER_PREFIX}${ORIGIN}${ENDPOINT[modality]}?offset=${offset}`;

/**
 * Pull the JSON object out of a reader-proxy body.
 *
 * The proxy normally returns the upstream body verbatim, but it has been seen
 * to wrap it in a ```-fence or prepend a "Title:/URL Source:" preamble. Both
 * wrappers live outside the braces, so slicing from the first `{` to the last
 * `}` unwraps either one without a regex.
 */
export const extractJson = (raw: string): unknown => {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to the salvage path
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error(`reader proxy returned a non-JSON body (${trimmed.slice(0, 120)}…)`);
  }
  return JSON.parse(trimmed.slice(start, end + 1));
};

/**
 * Normalise a catalogue page.
 *
 * Gotcha: the *videos* endpoint returns its array under the key `images` in
 * some responses, so both keys are accepted on both endpoints.
 */
export const parseCatalogPage = (raw: string): CatalogPage => {
  const body = extractJson(raw) as Record<string, unknown>;

  const rawItems = Array.isArray(body.videos)
    ? body.videos
    : Array.isArray(body.images)
      ? body.images
      : null;

  if (!rawItems) {
    throw new Error(`catalogue page has neither a "videos" nor an "images" array`);
  }

  const items = (rawItems as SourceItem[]).filter(
    (item): item is SourceItem => !!item && typeof item.id === 'string' && item.id.length > 0,
  );

  return {
    hasMore: body.hasMore === true,
    items,
    totalCount: typeof body.totalCount === 'number' ? body.totalCount : undefined,
  };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface FetchOptions {
  attempts?: number;
  timeoutMs?: number;
}

/** Fetch one catalogue page through the reader proxy, with linear backoff. */
export const fetchCatalogPage = async (
  modality: Modality,
  offset: number,
  { attempts = 3, timeoutMs = 90_000 }: FetchOptions = {},
): Promise<CatalogPage> => {
  const url = catalogUrl(modality, offset);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'x-no-cache': 'true', 'x-respond-with': 'text' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`reader proxy responded ${res.status}`);
      return parseCatalogPage(await res.text());
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 5000);
    }
  }

  throw new Error(
    `failed to fetch ${modality} offset=${offset} after ${attempts} attempts: ${String(lastError)}`,
  );
};

export interface DiscoverOptions {
  /** External ids already in `presets` — a page made entirely of these stops the walk. */
  known: Set<string>;
  maxNew: number;
  maxPages: number;
  onPage?: (offset: number, page: CatalogPage, fresh: number) => void;
}

export interface DiscoverResult {
  /** Items whose `external_id` is not in the DB yet, in catalogue order. */
  fresh: SourceItem[];
  pagesFetched: number;
  seen: number;
  stoppedBecause: 'exhausted' | 'known-page' | 'max-new' | 'max-pages';
}

/**
 * Walk offsets 0, 20, 40… and stop at the first page where *every* item is
 * already known — that is the incremental watermark. Bounded by `maxPages`
 * and `maxNew` so a single run can never run away.
 */
export const discoverNewItems = async (
  modality: Modality,
  { known, maxNew, maxPages, onPage }: DiscoverOptions,
  fetchOptions?: FetchOptions,
): Promise<DiscoverResult> => {
  const fresh: SourceItem[] = [];
  const seenIds = new Set<string>();
  let pagesFetched = 0;
  let seen = 0;
  let stoppedBecause: DiscoverResult['stoppedBecause'] = 'max-pages';

  for (let page = 0; page < maxPages; page += 1) {
    const offset = page * PAGE_SIZE;
    const result = await fetchCatalogPage(modality, offset, fetchOptions);
    pagesFetched += 1;
    seen += result.items.length;

    const pageFresh = result.items.filter((item) => !known.has(item.id) && !seenIds.has(item.id));
    for (const item of pageFresh) seenIds.add(item.id);
    onPage?.(offset, result, pageFresh.length);

    if (result.items.length > 0 && pageFresh.length === 0) {
      stoppedBecause = 'known-page';
      break;
    }

    fresh.push(...pageFresh);

    if (fresh.length >= maxNew) {
      fresh.length = maxNew;
      stoppedBecause = 'max-new';
      break;
    }

    if (!result.hasMore || result.items.length === 0) {
      stoppedBecause = 'exhausted';
      break;
    }
  }

  return { fresh, pagesFetched, seen, stoppedBecause };
};
