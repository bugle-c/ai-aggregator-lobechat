# Library Lightbox + Preset Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make images and videos in the Library tile-clickable with proper lightbox / zoom controls, add a zoom button to preset cards, and measure the library route's first-load performance.

**Architecture:** Replace the bare `<img>` viewer reached via `FullscreenModal` with **inline antd `<Image preview>`** triggered directly from each Masonry tile. Add a new `VideoFileItem` masonry tile that shows the first frame as a thumbnail and opens a local antd `<Modal>` with `<video controls autoPlay>`. Add a `ZoomIn` icon button to preset cards that opens a `PresetZoomModal` while preserving the existing "click card = apply preset" UX. Run a single Playwright pass to measure `/resource/library/[slug]` waterfall and document findings.

**Tech Stack:** Next.js 16, React 19, antd, `@lobehub/ui`, antd-style (`createStaticStyles`), `lucide-react` icons, tRPC (`lambdaQuery`), SWR, Playwright (test only). Workspace: `/home/deploy/projects/ai-aggregator-lobechat`. Branch: `canary`. Dev server: `npx next dev -p 3300`. Production image: `lobechat-custom:latest` built from `/home/deploy/projects/ai-aggregator-lobechat`, deployed via `cd /opt/lobechat && docker compose up -d lobe`.

**Spec:** `docs/superpowers/specs/2026-05-18-library-lightbox-and-preset-zoom-design.md`

**Testing convention:** UI changes here are thin wrappers around antd primitives (modals, `<Image>`) with no business logic worth unit-testing. Verification is done via dev-server smoke and post-deploy Playwright smoke. The plan explicitly skips TDD for these tasks — see `KNOWLEDGE.md` "Testing approach" section in the spec.

---

## File Structure

| File                                                                                         | Responsibility                                                                      | Status             |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------ |
| `src/features/ResourceManager/components/Explorer/MasonryView/MasonryItem/ImageFileItem.tsx` | Image tile in Masonry: thumbnail + controlled antd preview                          | modify             |
| `src/features/ResourceManager/components/Explorer/MasonryView/MasonryItem/VideoFileItem.tsx` | Video tile in Masonry: first-frame thumbnail + Maximize overlay + local modal       | create             |
| `src/features/ResourceManager/components/Explorer/MasonryView/MasonryItem/index.tsx`         | Masonry tile dispatcher: detect MIME and route to Image/Video/Markdown/Note/Default | modify             |
| `src/features/Generators/PresetCard.tsx`                                                     | Preset card: existing apply-preset click + new ZoomIn corner button                 | modify             |
| `src/features/Generators/PresetZoomModal.tsx`                                                | Full-screen preview for a preset (MP4 or image) with "Apply" footer                 | create             |
| `KNOWLEDGE.md`                                                                               | Phase 16: lightbox architecture + perf-audit findings                               | modify             |
| `_e2e_library_perf.mjs` (workspace-local, not committed)                                     | Playwright script for waterfall capture                                             | create-then-delete |

Boundaries:

- **Tile components own their click and modal.** They don't go through `FullscreenModal` route — that route stays only for PDF/Office/markdown/code via `DefaultFileItem` / `MarkdownFileItem` / `NoteFileItem`.
- **`MasonryFileItem` parent stops being the only click target for media.** Inner tiles call `e.stopPropagation()` so `MasonryFileItem.handleItemClick` (FullscreenModal route) is no longer reached for image/video.
- **DnD preserved.** `onDragStart` is on `MasonryFileItem` root and uses the drag event family, not click — `stopPropagation` on inner click handlers doesn't affect it.
- **`PresetZoomModal` is universal.** Detects MP4 vs image by URL extension (same heuristic as `PresetMP4Player`).

---

## Task 1: Quick perf-audit of /resource/library/\[slug]

**Why first:** Findings inform whether we need to slip in a quick win in this branch or split off a separate spec. The measurement script is throwaway and won't get committed.

**Files:**

- Create (temp, not committed): `/home/deploy/projects/ai-aggregator-lobechat/_e2e_library_perf.mjs`

- Modify: `KNOWLEDGE.md` (append "Phase 16: Library lightbox + perf" section)

- [ ] **Step 1.1: Pick a real library slug to test**

Run from the host:

```bash
docker exec -i lobechat-postgres psql -U postgres -d lobechat -c \
  "SELECT id, name FROM knowledge_bases LIMIT 5;"
```

Expected: at least one row with a library ID. Note the ID — it will be needed as `<library-slug>`. If the table is empty, ask the user to create a library through the UI first; do not invent one.

- [ ] **Step 1.2: Write the Playwright measurement script**

Template the script after `/home/deploy/projects/seo-builder/_e2e_gptweb_test.mjs`. Create `/home/deploy/projects/ai-aggregator-lobechat/_e2e_library_perf.mjs`:

```javascript
// Throwaway perf-audit for /resource/library/[slug]. Do NOT commit.
import { chromium } from 'playwright';

const BASE = 'https://ask.gptweb.ru';
const LIBRARY_SLUG = process.env.LIBRARY_SLUG;
if (!LIBRARY_SLUG) {
  console.error('Set LIBRARY_SLUG env var');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

const requests = [];
page.on('request', (r) => requests.push({ url: r.url(), method: r.method(), t: Date.now() }));
page.on('response', async (resp) => {
  const req = requests.find((x) => x.url === resp.url() && !x.status);
  if (req) {
    req.status = resp.status();
    req.dt = Date.now() - req.t;
    try {
      req.size = Number(resp.headers()['content-length'] ?? 0);
    } catch {}
  }
});

// Telegram OAuth path (test user already linked) — see Phase 15 in KNOWLEDGE.md
// for the bridge endpoint. Fastest: visit /api/auth/dev-login if SSO bypass exists,
// otherwise reuse the storageState from a prior login.
await page.goto(`${BASE}/?auth=signin`, { waitUntil: 'networkidle' });
// TODO at run time: load saved cookies/storageState if available.

const navStart = Date.now();
await page.goto(`${BASE}/resource/library/${LIBRARY_SLUG}`, { waitUntil: 'domcontentloaded' });
const ttfp = Date.now() - navStart;

// Wait for first tile or "empty" placeholder
const firstTile = await Promise.race([
  page.waitForSelector('[data-drop-target-id]', { timeout: 15000 }).then(() => 'tile'),
  page.waitForSelector('text=Не найдено', { timeout: 15000 }).then(() => 'empty'),
]).catch(() => 'timeout');
const tti = Date.now() - navStart;

console.log(
  JSON.stringify(
    {
      ttfp_ms: ttfp,
      tti_ms: tti,
      first_paint_outcome: firstTile,
      request_count: requests.length,
      tRPC_requests: requests
        .filter((r) => r.url.includes('/trpc/'))
        .map((r) => ({
          name: r.url.split('/trpc/')[1]?.split('?')[0],
          dt: r.dt,
          status: r.status,
        })),
      total_bytes: requests.reduce((s, r) => s + (r.size || 0), 0),
      slow_requests: requests.filter((r) => (r.dt ?? 0) > 500).slice(0, 10),
    },
    null,
    2,
  ),
);

await browser.close();
```

- [ ] **Step 1.3: Run the script**

```bash
cd /home/deploy/projects/seo-builder
LIBRARY_SLUG= step < from 1.1 /home/deploy/projects/ai-aggregator-lobechat/_e2e_library_perf.mjs > node
```

Expected output: JSON with `ttfp_ms`, `tti_ms`, `tRPC_requests` list with timings. Note any tRPC call > 500ms, any duplicate calls, or any single request > 200kB.

If the script fails on auth, fall back to manual DevTools waterfall: open Chrome with `--remote-debugging-port=9222`, log in, navigate to the library, copy waterfall summary into a scratch file. Do not block on this step.

- [ ] **Step 1.4: Append findings to `KNOWLEDGE.md`**

Edit `KNOWLEDGE.md` and append a new section at the end:

```markdown
## Phase 16: Library lightbox + perf-audit (2026-05-18)

### Perf-audit findings

Measured `/resource/library/<slug>` first-paint on canary (image: `lobechat-custom:latest`):

- Time-to-first-paint: <ttfp_ms>ms
- Time-to-first-tile: <tti_ms>ms
- tRPC waterfall:
  - `<call name>` — <dt>ms, <size>B
  - ...

Bottleneck: <one of: "tRPC X is slow due to Y" | "N+1 on Z" | "No bottleneck — under 500ms" | "TBD — measurement blocked, see notes">

### Lightbox architecture

- Image tiles use **inline antd `<Image preview>`** controlled via `useState`. Click on the tile sets `previewOpen=true`; antd handles zoom/rotate/flip/wheel-zoom.
- Video tiles render `<video preload="metadata" src={url + '#t=0.1'}>` as a still poster. Maximize overlay opens a local antd `<Modal>` with `<video controls autoPlay>`. No FullscreenModal route involvement.
- Preset cards keep their "click = apply" behavior. New ZoomIn corner button (~28×28) opens `PresetZoomModal` with full-size MP4 or image preview + "Apply preset" footer button.
```

Replace `<ttfp_ms>`, `<tti_ms>`, `<call name>`, etc. with the actual numbers from Step 1.3. If the script failed and no manual numbers were captured, write `Bottleneck: TBD — measurement blocked` and move on.

- [ ] **Step 1.5: Decide on quick win**

If a single tRPC call is > 1000ms or > 500kB payload, and the cause is obvious (e.g., no `staleTime`, no `select`-projection, double-fetch on mount), add a new Task 1.6 at runtime documenting the fix and shipping it. Otherwise proceed to Task 2.

- [ ] **Step 1.6: Delete the throwaway script**

```bash
rm /home/deploy/projects/ai-aggregator-lobechat/_e2e_library_perf.mjs
```

- [ ] **Step 1.7: Commit KNOWLEDGE.md update**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
git add KNOWLEDGE.md
git commit -m "docs: Phase 16 — library perf-audit findings"
```

---

## Task 2: Fix image tile click — inline antd preview

**Files:**

- Modify: `src/features/ResourceManager/components/Explorer/MasonryView/MasonryItem/ImageFileItem.tsx`

**Why:** Today, clicking an image tile goes through the parent `MasonryFileItem.onClick → handleItemClick → FullscreenModal` route. The hover overlay (`z-index:1 inset:0` without `pointer-events:none`) plus the `draggable` parent intercept the click. Even when the route does open, the viewer is a bare `<img>` with no zoom. We make the tile open the antd lightbox directly.

- [ ] **Step 2.1: Read the current file**

Read `src/features/ResourceManager/components/Explorer/MasonryView/MasonryItem/ImageFileItem.tsx`. Confirm line 86–102 is the `.hoverOverlay` style block and line \~170–192 is the `<Image preview={{src: url}}>`.

- [ ] **Step 2.2: Add `pointer-events: none` to the hover overlay style**

In the `hoverOverlay` block of `useStyles`/`createStaticStyles`, prepend `pointer-events: none;`:

```typescript
  hoverOverlay: css`
    pointer-events: none;

    position: absolute;
    z-index: 1;
    inset: 0;
    /* ...rest unchanged */
```

This stops the overlay from eating clicks.

- [ ] **Step 2.3: Convert antd `<Image>` preview to controlled mode**

In the component body, add the controlled-preview state:

```typescript
const [previewOpen, setPreviewOpen] = useState(false);
```

(it already imports `useState` from React.)

Replace the existing `<Image ... preview={{src: url}}>` block with the controlled version. The block currently looks like:

```typescript
{isInView && url && (
  <Image
    alt={name}
    loading="lazy"
    src={url}
    preview={{
      src: url,
    }}
    style={{
      display: 'block',
      height: 'auto',
      opacity: imageLoaded ? 1 : 0,
      transition: 'opacity 0.3s',
      width: '100%',
    }}
    wrapperStyle={{
      inset: 0,
      pointerEvents: imageLoaded ? 'auto' : 'none',
      position: imageLoaded ? 'relative' : 'absolute',
      width: '100%',
    }}
    onError={() => setImageLoaded(false)}
    onLoad={() => setImageLoaded(true)}
  />
)}
```

Change it to:

```typescript
{isInView && url && (
  <Image
    alt={name}
    loading="lazy"
    src={url}
    preview={{
      src: url,
      visible: previewOpen,
      onVisibleChange: (v) => setPreviewOpen(v),
    }}
    style={{
      display: 'block',
      height: 'auto',
      opacity: imageLoaded ? 1 : 0,
      transition: 'opacity 0.3s',
      width: '100%',
    }}
    wrapperStyle={{
      inset: 0,
      pointerEvents: imageLoaded ? 'auto' : 'none',
      position: imageLoaded ? 'relative' : 'absolute',
      width: '100%',
    }}
    onError={() => setImageLoaded(false)}
    onLoad={() => setImageLoaded(true)}
  />
)}
```

- [ ] **Step 2.4: Wrap the `imageWrapper` div with click handler that opens the preview and stops propagation**

The current root return is roughly `<><div className={styles.imageWrapper}>...</div>...</>`. Add `role="button"` and an `onClick` to that wrapper that triggers the antd preview without bubbling to the parent `MasonryFileItem`:

```typescript
<div
  className={styles.imageWrapper}
  onClick={(e) => {
    e.stopPropagation();
    if (imageLoaded) setPreviewOpen(true);
  }}
  role="button"
  tabIndex={0}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (imageLoaded) setPreviewOpen(true);
    }
  }}
>
```

Keep the rest of the children inside unchanged. Note: the antd `<Image>` inside this wrapper already opens its own preview on click — but because we control `visible` via state, our wrapper click and the inner-image click both end up opening the same controlled preview. That is OK and idempotent.

- [ ] **Step 2.5: Verify in dev server**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
rm -f .next/dev/lock
npx next dev -p 3300
```

Open <http://135.181.115.234:3300/resource/library/><slug> in a browser, click an image tile. Expected: antd preview opens with `+ / - / rotate / flip` icons in the toolbar. Esc closes it. No navigation to a separate page happens.

If the preview does not open: open DevTools, click again, check the console for `e.stopPropagation` reaching antd. If `MasonryFileItem.handleItemClick` still fires (you'll see a route change), confirm the wrapper `onClick` is attached on the right element.

- [ ] **Step 2.6: Commit**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
git add src/features/ResourceManager/components/Explorer/MasonryView/MasonryItem/ImageFileItem.tsx
git commit -m "fix(library): inline antd Image preview on Masonry image tiles

Hover overlay no longer eats clicks (pointer-events:none) and preview
is now controlled — tile click opens the antd lightbox with zoom/rotate
controls directly, bypassing the FullscreenModal route that rendered
a bare img tag."
```

---

## Task 3: New VideoFileItem in Masonry

**Files:**

- Create: `src/features/ResourceManager/components/Explorer/MasonryView/MasonryItem/VideoFileItem.tsx`

**Why:** Today, every video file in Masonry falls through to `DefaultFileItem` (file icon only). No thumbnail, no play affordance, no full-screen viewer. We give it parity with images: poster frame thumbnail + Maximize button + local modal.

- [ ] **Step 3.1: Create the file**

Create `src/features/ResourceManager/components/Explorer/MasonryView/MasonryItem/VideoFileItem.tsx`:

```typescript
import { Modal } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import { Maximize2, Play } from 'lucide-react';
import { memo, useState } from 'react';

import { type AsyncTaskStatus, type IAsyncTaskError } from '@/types/asyncTask';

interface VideoFileItemProps {
  chunkCount?: number | null;
  chunkingError?: IAsyncTaskError | null;
  chunkingStatus?: AsyncTaskStatus | null;
  embeddingError?: IAsyncTaskError | null;
  embeddingStatus?: AsyncTaskStatus | null;
  fileType?: string;
  finishEmbedding?: boolean;
  id: string;
  isInView: boolean;
  name: string;
  size: number;
  url?: string;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  maximizeBtn: css`
    pointer-events: auto;
    cursor: pointer;

    position: absolute;
    z-index: 2;
    inset-block-start: 8px;
    inset-inline-end: 8px;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    border: none;
    border-radius: 6px;

    color: #fff;

    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(4px);

    transition: background 0.18s ease;

    &:hover {
      background: rgba(0, 0, 0, 0.8);
    }
  `,
  playBadge: css`
    pointer-events: none;

    position: absolute;
    z-index: 1;
    inset-block-start: 50%;
    inset-inline-start: 50%;
    transform: translate(-50%, -50%);

    display: flex;
    align-items: center;
    justify-content: center;

    width: 48px;
    height: 48px;
    border-radius: 50%;

    color: #fff;

    background: rgba(0, 0, 0, 0.5);
  `,
  videoWrapper: css`
    position: relative;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 100%;
    min-height: 120px;

    background: ${cssVar.colorFillQuaternary};

    video {
      display: block;
      width: 100%;
      height: auto;
    }
  `,
}));

/**
 * Video tile in the Masonry view. Shows the first frame as a poster,
 * a Play badge in the centre and a Maximize affordance in the corner.
 * Click anywhere on the tile (or the Maximize button) opens a local
 * antd Modal with <video controls autoPlay>.
 */
const VideoFileItem = memo<VideoFileItemProps>(({ isInView, name, url }) => {
  const [modalOpen, setModalOpen] = useState(false);

  const open = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if ('preventDefault' in e) e.preventDefault();
    setModalOpen(true);
  };

  return (
    <>
      <div
        className={styles.videoWrapper}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') open(e);
        }}
        role="button"
        tabIndex={0}
      >
        {isInView && url && (
          <video
            // `#t=0.1` cues the browser to render the frame at 0.1s as the poster.
            // `preload="metadata"` is enough — no full download until the modal opens.
            muted
            playsInline
            preload="metadata"
            src={`${url}#t=0.1`}
          />
        )}
        <div className={styles.playBadge}>
          <Play fill="#fff" size={24} strokeWidth={0} />
        </div>
        <button
          aria-label="Maximize"
          className={cx(styles.maximizeBtn)}
          onClick={open}
          type="button"
        >
          <Maximize2 size={16} />
        </button>
      </div>
      <Modal
        centered
        destroyOnClose
        footer={null}
        onCancel={() => setModalOpen(false)}
        open={modalOpen}
        title={name}
        width="auto"
        styles={{ body: { padding: 0 } }}
      >
        {url && (
          <video
            autoPlay
            controls
            playsInline
            src={url}
            style={{ display: 'block', maxHeight: '85vh', maxWidth: '90vw' }}
          />
        )}
      </Modal>
    </>
  );
});

VideoFileItem.displayName = 'VideoFileItem';

export default VideoFileItem;
```

Note on styling: `createStaticStyles` returns a plain object (not a hook), accessed as `styles.foo`. This matches the existing pattern in `ImageFileItem.tsx`, `DefaultFileItem.tsx`, etc. `cssVar` is interpolated as `${cssVar.colorXxx}` — see `ImageFileItem.tsx` lines 17–102 for the canonical usage.

- [ ] **Step 3.2: Verify the file compiles**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
npx tsc --noEmit -p tsconfig.json 2>&1 | grep VideoFileItem || echo "no VideoFileItem errors"
```

Expected: "no VideoFileItem errors". If errors mention `cssVar` import shape or `useStyles` invocation, copy the exact import lines from `ImageFileItem.tsx` and re-apply.

- [ ] **Step 3.3: Commit**

```bash
git add src/features/ResourceManager/components/Explorer/MasonryView/MasonryItem/VideoFileItem.tsx
git commit -m "feat(library): VideoFileItem masonry tile

Video tiles now render the first frame as a poster, a centered Play
badge and a Maximize corner button. Clicking the tile opens a local
antd Modal with <video controls autoPlay>."
```

---

## Task 4: Dispatch video MIME to the new tile in MasonryItem

**Files:**

- Modify: `src/features/ResourceManager/components/Explorer/MasonryView/MasonryItem/index.tsx`

- [ ] **Step 4.1: Read the current dispatcher**

Read `src/features/ResourceManager/components/Explorer/MasonryView/MasonryItem/index.tsx`. Confirm:

- Line \~22–29: `IMAGE_TYPES` set

- Line \~213–219: `computedValues` memo (with `isImage`, `isMarkdown`, `isPage`, `isFolder`)

- Line \~420–492: the `switch (true)` block routing to `ImageFileItem`, `NoteFileItem`, `MarkdownFileItem`, `DefaultFileItem`

- [ ] **Step 4.2: Add VIDEO_TYPES constant**

Below the `IMAGE_TYPES` constant declaration (around line 29), add:

```typescript
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime']);
```

- [ ] **Step 4.3: Add `isVideo` to the memoized computed values**

Find the `useMemo` for `computedValues` (around line 212–220). Change:

```typescript
const computedValues = useMemo(
  () => ({
    isFolder: fileType === 'custom/folder',
    isImage: fileType && IMAGE_TYPES.has(fileType),
    isMarkdown: isMarkdownFile(name, fileType),
    isPage: isCustomPage(fileType, name),
  }),
  [fileType, name],
);
```

to:

```typescript
const computedValues = useMemo(
  () => ({
    isFolder: fileType === 'custom/folder',
    isImage: fileType && IMAGE_TYPES.has(fileType),
    isMarkdown: isMarkdownFile(name, fileType),
    isPage: isCustomPage(fileType, name),
    isVideo: fileType && VIDEO_TYPES.has(fileType),
  }),
  [fileType, name],
);

const { isImage, isMarkdown, isPage, isFolder, isVideo } = computedValues;
```

(The destructuring already exists right below the memo — just extend it with `isVideo`. If the destructuring line currently reads `const { isImage, isMarkdown, isPage, isFolder } = computedValues;`, replace it with the line above.)

- [ ] **Step 4.4: Import the new tile**

At the top of the file, alongside the other masonry-item imports:

```typescript
import DefaultFileItem from './DefaultFileItem';
import ImageFileItem from './ImageFileItem';
import MarkdownFileItem from './MarkdownFileItem';
import NoteFileItem from './NoteFileItem';
import VideoFileItem from './VideoFileItem';
```

- [ ] **Step 4.5: Add the video case in the switch**

Find the `switch (true)` block. Insert a new `case` before `default`:

```typescript
case isVideo && !!url: {
  return (
    <VideoFileItem
      chunkCount={chunkCount ?? undefined}
      chunkingError={chunkingError}
      chunkingStatus={chunkingStatus ?? undefined}
      embeddingError={embeddingError}
      embeddingStatus={embeddingStatus ?? undefined}
      fileType={fileType}
      finishEmbedding={finishEmbedding}
      id={id}
      isInView={isInView}
      name={name}
      size={size}
      url={url}
    />
  );
}
```

Also: video tiles should not have the default padding wrapper (same as images). Find the line:

```typescript
className={cx(
  styles.content,
  !isImage && !isMarkdown && !isPage && styles.contentWithPadding,
)}
```

Change it to:

```typescript
className={cx(
  styles.content,
  !isImage && !isVideo && !isMarkdown && !isPage && styles.contentWithPadding,
)}
```

- [ ] **Step 4.6: Verify in dev server**

If the dev server is still running from Task 2.5, hot reload should pick up the change. Otherwise:

```bash
rm -f .next/dev/lock
npx next dev -p 3300
```

Open the library, navigate to a folder that has video files. Expected:

- Each video shows as a still poster (first frame).
- Play badge in the centre, Maximize button top-right.
- Click anywhere on the tile opens a centered modal with the video playing.
- Esc closes it.

If videos still render as a file icon: check that `fileType` on the row matches one of the entries in `VIDEO_TYPES` (look in DevTools React panel or `console.log(fileType)`).

- [ ] **Step 4.7: Commit**

```bash
git add src/features/ResourceManager/components/Explorer/MasonryView/MasonryItem/index.tsx
git commit -m "feat(library): route video MIME to new VideoFileItem tile"
```

---

## Task 5: ZoomIn button on PresetCard + PresetZoomModal

**Files:**

- Create: `src/features/Generators/PresetZoomModal.tsx`

- Modify: `src/features/Generators/PresetCard.tsx`

- [ ] **Step 5.1: Create PresetZoomModal**

Create `src/features/Generators/PresetZoomModal.tsx`:

```typescript
'use client';

import { Modal } from 'antd';
import { Image } from 'antd';
import { memo } from 'react';

import type { Preset } from '@/types/preset';

interface Props {
  onApply: () => void;
  onClose: () => void;
  open: boolean;
  preset: Preset;
}

const isVideoUrl = (url: string): boolean => {
  const path = url.split('?')[0].toLowerCase();
  return /\.(?:mp4|webm|mov|ogg)$/.test(path);
};

/**
 * Full-screen preview of a preset's media. Renders as a centered
 * antd Modal with either <video controls autoPlay loop> or the antd
 * <Image> (which has built-in zoom/rotate). Bottom footer shows the
 * title/description and an "Apply preset" button so users can act on
 * what they're looking at.
 */
const PresetZoomModal = memo<Props>(({ onApply, onClose, open, preset }) => {
  const isVideo = isVideoUrl(preset.previewUrl);

  return (
    <Modal
      centered
      destroyOnClose
      footer={null}
      onCancel={onClose}
      open={open}
      title={preset.title}
      width="auto"
      styles={{ body: { padding: 0, maxWidth: '90vw' } }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '85vh' }}>
        <div style={{ background: '#000', display: 'flex', justifyContent: 'center' }}>
          {isVideo ? (
            <video
              autoPlay
              controls
              loop
              playsInline
              src={preset.previewUrl}
              style={{ display: 'block', maxHeight: '70vh', maxWidth: '90vw' }}
            />
          ) : (
            <Image
              alt={preset.title}
              preview={false}
              src={preset.previewUrl}
              style={{ maxHeight: '70vh', maxWidth: '90vw', objectFit: 'contain' }}
            />
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16 }}>
          {preset.description && (
            <div style={{ color: 'var(--lobe-chat-text-secondary)', fontSize: 13 }}>
              {preset.description}
            </div>
          )}
          <button
            onClick={() => {
              onApply();
              onClose();
            }}
            style={{
              alignSelf: 'flex-end',
              background: 'var(--lobe-chat-color-primary, #1677ff)',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
              padding: '8px 16px',
            }}
            type="button"
          >
            Применить пресет
          </button>
        </div>
      </div>
    </Modal>
  );
});

PresetZoomModal.displayName = 'PresetZoomModal';

export default PresetZoomModal;
```

- [ ] **Step 5.2: Add ZoomIn button to PresetCard**

Read `src/features/Generators/PresetCard.tsx`. Find the `<button>` root (around line 163) and the existing absolutely-positioned `badges` row (around line 172–199).

Make these changes:

1. Add imports at the top:

```typescript
import { ZoomIn } from 'lucide-react';
import { useState } from 'react';

import PresetZoomModal from './PresetZoomModal';
```

2. Add a new style entry inside the `useStyles` block (right after `bottomLabel`):

```typescript
zoomBtn: css`
  cursor: pointer;

  position: absolute;
  z-index: 3;
  inset-block-start: 8px;
  inset-inline-end: 8px;

  display: flex;
  align-items: center;
  justify-content: center;

  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;

  color: #fff;
  opacity: 0;

  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);

  transition:
    opacity 0.18s ease,
    background 0.18s ease;

  &:hover {
    background: rgba(0, 0, 0, 0.8);
  }
`,
```

3. Inside the `card` style block, add a `&:hover .preset-zoom-btn { opacity: 1 }` rule next to the existing `&:hover .preset-hover-overlay { opacity: 1 }`:

```typescript
&:hover .preset-hover-overlay {
  opacity: 1;
}

&:hover .preset-zoom-btn {
  opacity: 1;
}
```

4. Add a `useState` call inside the component body (right after `const hint = CATEGORY_HINTS[preset.category];`):

```typescript
const [zoomOpen, setZoomOpen] = useState(false);
```

5. Insert the zoom button inside the `<button>` JSX, after the `PresetMP4Player` and before the badges block:

```typescript
<span
  aria-label="Увеличить превью"
  className={cx(styles.zoomBtn, 'preset-zoom-btn')}
  onClick={(e) => {
    e.preventDefault();
    e.stopPropagation();
    setZoomOpen(true);
  }}
  role="button"
  tabIndex={0}
>
  <ZoomIn size={16} />
</span>
```

We use a `<span role="button">` instead of a nested `<button>` because the outer card is already a `<button>` and nesting buttons is invalid HTML.

6. Add the modal as a sibling of the `<button>`. Wrap the existing return in a fragment:

```typescript
return (
  <>
    <button ...> {/* existing card */}
      ...
    </button>
    <PresetZoomModal
      onApply={() => onClick(preset)}
      onClose={() => setZoomOpen(false)}
      open={zoomOpen}
      preset={preset}
    />
  </>
);
```

- [ ] **Step 5.3: Verify in dev server**

Hot reload picks up the change. Open <http://135.181.115.234:3300/image> (or `/video` — wherever the PresetGallery is exposed via `FlowSidebar` / `PresetGallery`), hover a preset. Expected:

- ZoomIn icon button fades in at the top-right corner on hover.
- Clicking the icon opens a modal with full-size MP4 (or image) + "Apply preset" button.
- Clicking outside the icon (i.e., the rest of the card) applies the preset as before.
- Clicking "Apply preset" in the modal applies the preset and closes the modal.

If the click on the ZoomIn button bubbles to the parent `<button>` and applies the preset instead: verify `e.stopPropagation()` and `e.preventDefault()` both run before `setZoomOpen(true)`.

- [ ] **Step 5.4: Commit**

```bash
git add src/features/Generators/PresetCard.tsx src/features/Generators/PresetZoomModal.tsx
git commit -m "feat(presets): ZoomIn button + full-screen preview modal

Adds a small lupe icon in the top-right corner of each preset card.
Click opens a Modal with the preset's MP4 or image at full size plus
an 'Apply preset' button. Card-body click still applies the preset
as before."
```

---

## Task 6: Build, deploy, smoke-test

**Files:** none (deploy + smoke)

- [ ] **Step 6.1: Push to canary**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
git push origin canary
```

Expected: push succeeds. Note: this is a fork, GitHub Actions in this repo do not auto-deploy LobeChat — we build the Docker image locally.

- [ ] **Step 6.2: Build the Docker image**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
docker build -t lobechat-custom:latest . 2>&1 | tail -50
```

Expected: build succeeds in \~5–8 minutes. Watch for `SecretsUsedInArgOrEnv` warnings — those are pre-existing and OK to ignore. If the build fails on `tsgo`, recall that `build:docker` uses `lint:ts + lint:style` only — no extra type-check step is needed.

- [ ] **Step 6.3: Restart the container**

```bash
cd /opt/lobechat
docker compose up -d lobe
docker logs lobehub --tail 50
```

Expected: `lobehub` container starts, logs show `Ready in <Xms>` from Next.js. If it doesn't, `docker compose restart lobe` is the fallback (see Phase 15 KNOWLEDGE.md: "lobehub Container Failed to Restart After Image Build").

- [ ] **Step 6.4: Manual smoke**

Open <https://ask.gptweb.ru/resource/library/><slug> in a browser. Verify:

1. An image tile opens an antd lightbox with `+ / - / rotate / flip` toolbar.
2. A video tile (if available) shows a poster + Play badge + Maximize button; clicking opens a modal with `<video controls>`.
3. <https://ask.gptweb.ru/image> — hover a preset card, ZoomIn appears top-right; click opens preset modal with "Apply preset" button.
4. Body of the preset card still applies the preset on click.

Take screenshots if any acceptance criterion is unclear.

- [ ] **Step 6.5: Playwright smoke (optional)**

Adapt `/home/deploy/projects/seo-builder/_e2e_gptweb_test.mjs` to a quick smoke run that asserts the three modals can be opened. If the script needs auth, reuse the Telegram OAuth setup from Phase 15. Commit only if the script ends up in `/home/deploy/projects/ai-aggregator-lobechat/__tests__/` — otherwise keep it as ad-hoc verification under `/tmp`.

- [ ] **Step 6.6: Update KNOWLEDGE.md with shipped status**

In the "Phase 16" section appended in Task 1.4, add a closing paragraph:

```markdown
### Shipped 2026-05-18

- Inline antd preview on image tiles in Masonry (commit <hash>).
- New VideoFileItem with poster + Maximize → modal (commit <hash>).
- ZoomIn button on PresetCard + PresetZoomModal (commit <hash>).
- ListView image/video rows untouched in this iteration (see spec "What stays the same").
```

Fill in `<hash>` with the actual commit shas from `git log --oneline -10`.

- [ ] **Step 6.7: Commit and push**

```bash
git add KNOWLEDGE.md
git commit -m "docs: Phase 16 — shipped"
git push origin canary
```

---

## Acceptance verification (from spec)

| Criterion                                                                                                  | Verified by                                        |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Image tile click opens antd lightbox with zoom controls                                                    | Task 2.5 dev smoke + Task 6.4 prod smoke           |
| Video tile renders poster + Maximize affordance, modal opens with `<video controls autoPlay>`              | Task 4.6 dev smoke + Task 6.4 prod smoke           |
| Preset cards expose ZoomIn icon, modal previews MP4/image with Apply button, card body click still applies | Task 5.3 dev smoke + Task 6.4 prod smoke           |
| Library waterfall measured and documented in KNOWLEDGE.md                                                  | Task 1.4 + Task 1.7                                |
| Smoke-tested in browser after deploy                                                                       | Task 6.4 (manual) + Task 6.5 (optional Playwright) |
