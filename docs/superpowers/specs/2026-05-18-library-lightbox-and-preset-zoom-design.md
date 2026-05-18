# Library lightbox + preset zoom + library perf-audit

**Date:** 2026-05-18
**Status:** Spec
**Branch:** `canary`

## Problem

Three user complaints reported on `ask.gptweb.ru`:

1. **Library opens slowly on first navigation.** Sometimes 1–2 seconds with a visible empty state before content appears.
2. **Clicking an image in the library does nothing.** No lightbox, no fullscreen viewer opens. Same for video files — there is not even a thumbnail, only a generic file icon.
3. **Presets need a zoom button.** Currently a preset card is a single `<button>`: clicking it applies the preset. There is no way to see the preview at full size before applying. The user explicitly asked for "some kind of button on the image that a person logically understands".

## Investigation findings

- `MasonryView/MasonryItem/index.tsx:418` — the entire card has `onClick={handleItemClick}` which navigates to a `FullscreenModal` route. The image `<Image preview>` (antd) inside `ImageFileItem.tsx:170` is technically present, but the card is also `draggable` and has a `z-index:1 inset:0` hover overlay without `pointer-events:none` — clicks land on the overlay, and the antd preview trigger never fires.
- `FullscreenModal` → `FilePreview` → `FileViewer` → `Renderer/Image` is a bare `<img>` with `object-fit: contain`. Even when the modal opens, there is no zoom/rotate/pinch — the user "sees" the full image but cannot inspect details.
- Video files do not hit `ImageFileItem`. In Masonry they fall through to `DefaultFileItem`, which only renders a file icon and name. No thumbnail, no play affordance.
- Presets (`src/features/Generators/PresetCard.tsx`) — the whole card is a `<button onClick={onClick(preset)}>` that applies the preset. The hover overlay (`pointer-events: none`, opacity 0→1 on hover) shows the title/hint but no controls.
- Library route is `src/app/[variants]/(main)/resource/library/[slug]/index.tsx` → re-exports `../index` which renders `ResourceExplorer`. Fetch uses SWR (`useFetchResources`). Performance bottleneck is not measured yet.

## Design

Approach: unify all library media interactions on **inline lightbox/modal** patterns. Stop routing image/video clicks through `FullscreenModal`. Leave `FullscreenModal` for doc/PDF/markdown only (where its side-panel for details is genuinely useful).

### Changes

#### 1. Inline image lightbox in Masonry tile

`src/features/ResourceManager/components/Explorer/MasonryView/MasonryItem/ImageFileItem.tsx`

- Hover-overlay (`.hoverOverlay`) gets `pointer-events: none` (already does in PresetCard — copy the pattern). It is decorative, not interactive.
- antd `<Image>` preview is controlled (`preview={{ visible, onVisibleChange }}`) so clicks open it programmatically — robust against `draggable` parent and overlay layering.
- Add wrapper `onClick={(e) => { e.stopPropagation(); setPreviewOpen(true); }}` to bypass `MasonryFileItem.handleItemClick`.
- Result: clicking an image tile opens an antd lightbox with zoom in/out/rotate/flip/wheel-zoom out of the box.

#### 2. Video Masonry tile

New `src/features/ResourceManager/components/Explorer/MasonryView/MasonryItem/VideoFileItem.tsx` (mirror of `ImageFileItem`).

- Thumbnail: `<video src={url + '#t=0.1'} preload="metadata" muted playsInline />` — browser renders the frame at 0.1s as a still poster. No autoplay (saves bandwidth).
- Overlay: small `Maximize2` icon (lucide-react) in the top-right corner, like the existing `floatingChunkBadge`. Plus a centered `Play` icon to signal "this is video".
- Click on tile → local antd `<Modal>` with `<video controls autoPlay src playsInline />`, `width="auto"`, max \~90vw/90vh.
- Stops propagation, never enters `FullscreenModal` route.

#### 3. Dispatch video in MasonryItem

`src/features/ResourceManager/components/Explorer/MasonryView/MasonryItem/index.tsx`

- Add `VIDEO_TYPES` set (`video/mp4`, `video/webm`, `video/quicktime`, etc.) next to `IMAGE_TYPES`.
- Compute `isVideo` in the memo block.
- Add `case isVideo && !!url:` before the `default` branch, delegating to `<VideoFileItem />`.

#### 4. Preset zoom button

`src/features/Generators/PresetCard.tsx`

- Add a `ZoomIn` icon button (\~28×28px) in the top-right corner, in the same absolute-positioned row as `badges`, with `pointer-events: auto`.
- `onClick={(e) => { e.stopPropagation(); setZoomOpen(true); }}` — does NOT trigger `onClick(preset)` (apply preset).
- New `src/features/Generators/PresetZoomModal.tsx`:
  - Antd `<Modal>`, full preview.
  - If `previewUrl` looks like MP4 (ends with `.mp4` or `.webm`) → `<video controls autoPlay loop src playsInline />`.
  - Otherwise → antd `<Image>` (uses its own preview with zoom controls).
  - Footer: show title + description + "Применить пресет" button that calls `onClick(preset)` and closes the modal.
- Rest of the card still applies the preset on click (existing behavior preserved).

#### 5. Performance audit (quick pass)

Out-of-band investigation before/alongside the UI work:

- From dev machine, run a Playwright headless script (template: `seo-builder/_e2e_gptweb_test.mjs`) that logs into ask.gptweb.ru with a test user, navigates to `/resource/library/<slug>`, captures Network waterfall + Performance trace.
- Specifically measure:
  - tRPC `file.findResources` (or similar) response time and payload size.
  - Number of parallel requests fired on navigation.
  - Total JS chunk size loaded for `/resource` route (in bytes).
  - Time to first masonry item visible.
- If a single obvious fix surfaces (N+1 query, missing index, huge chunk, missing SWR cache key) — apply it as part of this work.
- If the slowness is architectural (multiple round trips, big tree fetch) — document findings in `KNOWLEDGE.md` and split into a follow-up spec.

### Files touched

| File                                                                                         | Change                                                                                         |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/features/ResourceManager/components/Explorer/MasonryView/MasonryItem/ImageFileItem.tsx` | Controlled antd preview, `pointer-events: none` on hover overlay, `stopPropagation` on wrapper |
| `src/features/ResourceManager/components/Explorer/MasonryView/MasonryItem/VideoFileItem.tsx` | **New.** Video thumbnail + Maximize overlay + local video modal                                |
| `src/features/ResourceManager/components/Explorer/MasonryView/MasonryItem/index.tsx`         | Add `isVideo` detection, route to `VideoFileItem`                                              |
| `src/features/Generators/PresetCard.tsx`                                                     | Add ZoomIn icon button in top-right corner                                                     |
| `src/features/Generators/PresetZoomModal.tsx`                                                | **New.** Universal full-screen preview for preset image or MP4                                 |
| `KNOWLEDGE.md`                                                                               | Phase 16 section documenting perf findings + lightbox architecture                             |
| `docs/superpowers/specs/2026-05-18-library-lightbox-and-preset-zoom-design.md`               | This spec                                                                                      |

### What stays the same

- `FullscreenModal` route and `FileViewer` machinery — still used for PDF, Office docs, markdown, code files. Image/video viewers in `FileViewer/Renderer/{Image,Video}` are NOT removed (might still be reachable from doc/file detail context).
- `useFileItemClick` hook — still used for non-media file types.
- ListView — unchanged in this iteration. ListView image rows already navigate to FullscreenModal; once it stops being the main image-open path we can revisit, but not in this spec.
- DnD on Masonry — preserved. The card stays `draggable`. Stopping propagation on the inner wrapper is OK because drag uses `onDragStart` (different event family) on the parent.

### Acceptance criteria

1. In the Library, clicking an image tile opens an antd lightbox with zoom/rotate controls. No FullscreenModal route navigation happens.
2. In the Library, video files render with a still thumbnail (first frame) and a visible Maximize affordance. Clicking the tile opens a modal with an autoplaying `<video controls>`.
3. Preset cards have a small ZoomIn icon in the top-right corner. Clicking it opens a modal previewing the preset's MP4/image at full size with an "Apply preset" button. Clicking the rest of the card still applies the preset.
4. Library `/resource/library/[slug]` waterfall has been measured and findings are documented in KNOWLEDGE.md. Any quick win identified during measurement is shipped in the same branch.
5. Smoke-tested via Playwright (or manual browser session) on ask.gptweb.ru after deploy.

### Testing approach

- TDD not applicable for thin UI shells over antd primitives — no logic worth unit-testing.
- Verification via local dev server (`npx next dev -p 3300`) before docker build.
- Post-deploy: Playwright headless smoke script that exercises each new entry point and screenshots the result.

### Out of scope

- Reworking ListView image/video rows.
- Adding swipe/keyboard navigation between library items in lightbox.
- Persisting "last-viewed" state.
- Lazy-loading video thumbnails via Intersection Observer (already inherited via `isInView` flag on `ImageFileItem` — same flag will be passed to `VideoFileItem`).
- Refactoring FullscreenModal route into a generic media viewer.
- Deep perf rewrite of `useFetchResources` / tRPC `findResources` — only quick wins from waterfall measurement.

## Risks

- antd `<Image preview>` portal sometimes conflicts with antd `<Modal>` z-index. Mitigation: render via `Image.PreviewGroup` or set explicit `zIndex` on the preview config.
- Some browsers (Safari iOS) don't render `<video #t=0.1>` poster reliably without `playsInline`. Mitigation: always set `playsInline`. If still broken on iOS, fall back to a generic video icon.
- Docker image is `~5–8 min` to build — keep commits small but defer rebuild until the cluster of changes is ready, to avoid wasted cycles.
