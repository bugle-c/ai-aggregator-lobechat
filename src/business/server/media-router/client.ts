/**
 * HTTP client for the llm-router media endpoints.
 *
 * Both images and videos are submitted with `async:true` and polled: a
 * synchronous hold on the router would sit behind a proxy read-timeout and,
 * for Veo, run for minutes. Jobs live ~30 min on the router side, so a poll
 * that comes back `404 job_not_found` means the router restarted and the job
 * is gone — treated as `upstream` so the caller falls back.
 *
 * Contract (router `GET /v1/images/generations` / `GET /v1/videos/generations`):
 *   POST /v1/images/generations { model, prompt, aspect, async:true } → 202 { job_id }
 *   POST /v1/videos/generations { model:'veo', prompt, image?, aspect, seconds, async:true } → 202 { job_id }
 *   GET  /v1/videos/generations/<job_id> → { status: pending|running|done|error, data?:[{b64_json}], meta?, error? }
 *   errors: 429 quota (Retry-After) · 502/503 upstream · 504 timeout · 400 invalid
 */
import type { RouterOutcome } from './breaker';
import { getMediaRouterConfig } from './config';
import type { ImageRoute, VideoRoute } from './eligibility';

export interface RouterResult {
  /** Decoded payload on success. */
  buffer?: Buffer;
  error?: string;
  jobId?: string;
  meta?: Record<string, unknown>;
  outcome: RouterOutcome;
  retryAfterMs?: number;
}

const POLL_INTERVAL_MS = 5000;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });

function classifyStatus(status: number): RouterOutcome {
  if (status === 429) return 'quota';
  if (status === 504) return 'timeout';
  if (status === 400 || status === 401 || status === 404 || status === 422) return 'invalid';
  return 'upstream';
}

function retryAfterMsOf(res: Response): number | undefined {
  const h = res.headers.get('retry-after');
  if (!h) return undefined;
  const s = Number(h);
  if (Number.isFinite(s)) return s * 1000;
  const d = Date.parse(h);
  return Number.isFinite(d) ? Math.max(0, d - Date.now()) : undefined;
}

async function post(
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ json: any; res: Response } | { outcome: RouterOutcome; error: string }> {
  const { baseUrl, apiKey } = getMediaRouterConfig();
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      body: JSON.stringify(body),
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await res.json().catch(() => null);
    return { json, res };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { error: msg, outcome: /abort|timeout/i.test(msg) ? 'timeout' : 'upstream' };
  }
}

/** Submit a job; returns the job id or a failure outcome. */
async function submit(
  path: string,
  body: Record<string, unknown>,
): Promise<{ jobId: string } | RouterResult> {
  const r = await post(path, { ...body, async: true }, 30_000);
  if ('outcome' in r) return { error: r.error, outcome: r.outcome };
  const { res, json } = r;
  if (res.status === 202 || res.status === 200) {
    const jobId = json?.job_id;
    if (typeof jobId === 'string' && jobId) return { jobId };
    // A 200 with inline data (router ignored async) — accept it.
    const b64 = json?.data?.[0]?.b64_json;
    if (typeof b64 === 'string' && b64) {
      return { buffer: Buffer.from(b64, 'base64'), meta: json?.meta, outcome: 'ok' };
    }
    return { error: 'no job_id in response', outcome: 'upstream' };
  }
  return {
    error: json?.error ? String(json.error) : `HTTP ${res.status}`,
    outcome: classifyStatus(res.status),
    retryAfterMs: retryAfterMsOf(res),
  };
}

/** Poll a job until done/error/deadline. */
export async function pollRouterJob(
  jobId: string,
  deadlineMs: number,
  signal?: AbortSignal,
): Promise<RouterResult> {
  const { baseUrl, apiKey } = getMediaRouterConfig();
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline && !signal?.aborted) {
    await sleep(POLL_INTERVAL_MS, signal);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/v1/videos/generations/${encodeURIComponent(jobId)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      continue; // transient network blip — keep polling until the deadline
    }
    if (res.status === 404) {
      return { error: 'job_not_found (router restarted?)', jobId, outcome: 'upstream' };
    }
    if (!res.ok) {
      return {
        error: `poll HTTP ${res.status}`,
        jobId,
        outcome: classifyStatus(res.status),
        retryAfterMs: retryAfterMsOf(res),
      };
    }
    const json: any = await res.json().catch(() => null);
    const status = json?.status;
    if (status === 'done') {
      const b64 = json?.data?.[0]?.b64_json;
      if (typeof b64 !== 'string' || !b64) {
        return { error: 'done without b64_json', jobId, outcome: 'upstream' };
      }
      return { buffer: Buffer.from(b64, 'base64'), jobId, meta: json?.meta, outcome: 'ok' };
    }
    if (status === 'error') {
      const msg = String(json?.error ?? 'router job error');
      const outcome: RouterOutcome = /quota|monthly_backstop/i.test(msg)
        ? 'quota'
        : /timeout/i.test(msg)
          ? 'timeout'
          : 'upstream';
      return { error: msg, jobId, outcome };
    }
    // pending / running → keep polling
  }
  return { error: 'deadline exceeded', jobId, outcome: 'timeout' };
}

export async function submitRouterImage(
  route: ImageRoute,
  prompt: string,
): Promise<{ jobId: string } | RouterResult> {
  const { imageModel } = getMediaRouterConfig();
  return submit('/v1/images/generations', { aspect: route.aspect, model: imageModel, prompt });
}

export async function submitRouterVideo(
  route: VideoRoute,
  prompt: string,
): Promise<{ jobId: string } | RouterResult> {
  return submit('/v1/videos/generations', {
    aspect: route.aspect,
    ...(route.image ? { image: route.image } : {}),
    model: 'veo',
    prompt,
    seconds: route.seconds,
  });
}

/** Submit + poll in one call. */
export async function generateViaRouter(
  submitFn: () => Promise<{ jobId: string } | RouterResult>,
  deadlineMs: number,
  signal?: AbortSignal,
): Promise<RouterResult> {
  const s = await submitFn();
  if (!('jobId' in s)) return s;
  if ('outcome' in s) return s as RouterResult;
  return pollRouterJob(s.jobId, deadlineMs, signal);
}

export function isPngOrJpeg(buf: Buffer): 'image/png' | 'image/jpeg' | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

/** MP4/QuickTime-family container check (`ftyp` box at offset 4). */
export function looksLikeMp4(buf: Buffer): boolean {
  return buf.length > 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp';
}
