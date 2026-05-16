import type { AIImageModelCard, AIVideoModelCard } from '../types/aiModel';

// WaveSpeed AI — image/video/audio inference aggregator
// Pricing in ai_aggregator.model_rates (Supabase) is source of truth for billing;
// rates here are reference values used only for UI hints.
// Model slugs match WaveSpeed API paths: POST /api/v3/{id}
// Docs: https://wavespeed.ai/docs

export const wavespeedImageModels: AIImageModelCard[] = [
  {
    description: 'Google Gemini 3 Pro Image — state-of-the-art with native reasoning, 4K output.',
    displayName: 'Nano Banana Pro',
    enabled: true,
    id: 'google/nano-banana-pro/text-to-image',
    parameters: {
      imageUrls: { default: [], maxCount: 10 },
      prompt: { default: '' },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.14, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-11-20',
    type: 'image',
  },
  {
    description: 'Google Gemini 3.1 Flash Image — fast high-quality image generation/editing.',
    displayName: 'Nano Banana 2',
    enabled: true,
    id: 'google/nano-banana-2/text-to-image',
    parameters: {
      imageUrls: { default: [], maxCount: 10 },
      prompt: { default: '' },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.07, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2026-02-26',
    type: 'image',
  },
  {
    description: 'OpenAI GPT Image 2 — reasoning-enabled image generation with multilingual text.',
    displayName: 'GPT Image 2',
    enabled: true,
    id: 'openai/gpt-image-2/text-to-image',
    parameters: {
      imageUrls: { default: [], maxCount: 10 },
      prompt: { default: '' },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.06, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2026-04-21',
    type: 'image',
  },
  {
    description: 'ByteDance Seedream 4.5 — 4K, up to 10 reference images, character consistency.',
    displayName: 'Seedream 4.5',
    enabled: true,
    id: 'bytedance/seedream-v4.5',
    parameters: {
      imageUrls: { default: [], maxCount: 10 },
      prompt: { default: '' },
      size: { default: '2048*2048', enum: ['2048*2048'] },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description: 'ByteDance Seedream 4.5 Sequential Edit — character-consistent series editing.',
    displayName: 'Seedream 4.5 Edit (Sequential)',
    enabled: true,
    id: 'bytedance/seedream-v4.5/edit-sequential',
    parameters: {
      imageUrls: { default: [], maxCount: 10 },
      prompt: { default: '' },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.05, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description: 'Black Forest Labs FLUX 1.1 Pro Ultra — 4MP flagship.',
    displayName: 'FLUX 1.1 Pro Ultra',
    enabled: true,
    id: 'wavespeed-ai/flux-1.1-pro-ultra',
    parameters: {
      prompt: { default: '' },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.055, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description: 'FLUX Kontext Max — best-in-class instruction-based image editing.',
    displayName: 'FLUX Kontext Max',
    enabled: true,
    id: 'wavespeed-ai/flux-kontext-max',
    parameters: {
      imageUrl: { default: null },
      prompt: { default: '' },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.08, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description: 'FLUX Dev Ultra Fast — WaveSpeed-optimized, sub-second generation.',
    displayName: 'FLUX Dev Ultra Fast',
    enabled: true,
    id: 'wavespeed-ai/flux-dev-ultra-fast',
    parameters: {
      prompt: { default: '' },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.005, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description: 'Z-Image Turbo — ultra-cheap 1-second generation.',
    displayName: 'Z-Image Turbo',
    enabled: true,
    id: 'wavespeed-ai/z-image/turbo',
    parameters: {
      prompt: { default: '' },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.01, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description: 'Ideogram v3 Turbo — strong typography and poster design.',
    displayName: 'Ideogram v3 Turbo',
    enabled: true,
    id: 'ideogram-ai/ideogram-v3-turbo',
    parameters: {
      prompt: { default: '' },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.025, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description: 'Recraft v3 — brand design, vector SVG support, long-form text.',
    displayName: 'Recraft v3',
    enabled: true,
    id: 'recraft-ai/recraft-v3',
    parameters: {
      prompt: { default: '' },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description: 'Alibaba Qwen-Image 2.0 — unified generation + editing, open-friendly.',
    displayName: 'Qwen-Image 2.0',
    enabled: true,
    id: 'alibaba/qwen-image-2.0',
    parameters: {
      imageUrls: { default: [], maxCount: 10 },
      prompt: { default: '' },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.02, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description: 'Nano Banana Pro — edit existing image with same model.',
    displayName: 'Nano Banana Pro Edit',
    // Auto-routed: a reference image attached to the matching `/text-to-image`
    // card transparently routes here at the wavespeed runtime layer. See
    // providers/wavespeed/utils/pairedEndpoint.ts. Hidden from the picker so
    // the user only sees one card per family.
    enabled: false,
    id: 'google/nano-banana-pro/edit',
    parameters: {
      imageUrls: { default: [], maxCount: 10 },
      prompt: { default: '' },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.14, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description: 'Nano Banana 2 — fast image editing variant.',
    displayName: 'Nano Banana 2 Edit',
    // Auto-routed: a reference image attached to the matching `/text-to-image`
    // card transparently routes here at the wavespeed runtime layer. See
    // providers/wavespeed/utils/pairedEndpoint.ts. Hidden from the picker so
    // the user only sees one card per family.
    enabled: false,
    id: 'google/nano-banana-2/edit',
    parameters: {
      imageUrls: { default: [], maxCount: 10 },
      prompt: { default: '' },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.07, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description: 'GPT Image 2 — edit existing image with the same reasoning model.',
    displayName: 'GPT Image 2 Edit',
    // Auto-routed: a reference image attached to the matching `/text-to-image`
    // card transparently routes here at the wavespeed runtime layer. See
    // providers/wavespeed/utils/pairedEndpoint.ts. Hidden from the picker so
    // the user only sees one card per family.
    enabled: false,
    id: 'openai/gpt-image-2/edit',
    parameters: {
      imageUrls: { default: [], maxCount: 10 },
      prompt: { default: '' },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.15, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description: 'Seedream 4.5 Edit — single-shot image edit.',
    displayName: 'Seedream 4.5 Edit',
    enabled: true,
    id: 'bytedance/seedream-v4.5/edit',
    parameters: {
      imageUrls: { default: [], maxCount: 10 },
      prompt: { default: '' },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description: 'Seedream 5.0 Lite Edit — newest lite-tier image edit.',
    displayName: 'Seedream 5.0 Lite Edit',
    enabled: true,
    id: 'bytedance/seedream-v5.0-lite/edit',
    parameters: {
      imageUrls: { default: [], maxCount: 10 },
      prompt: { default: '' },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.035, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description: 'Qwen Image — Alibaba multimodal edit model.',
    displayName: 'Qwen Image Edit',
    enabled: true,
    id: 'alibaba/qwen-image-edit',
    parameters: {
      imageUrls: { default: [], maxCount: 10 },
      prompt: { default: '' },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.02, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description: 'Flux 1.1 Pro — Black Forest Labs flagship photoreal generator.',
    displayName: 'Flux 1.1 Pro',
    enabled: true,
    id: 'wavespeed-ai/flux-1.1-pro',
    parameters: {
      prompt: { default: '' },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.035, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description: 'Flux Kontext Pro — context-aware edit with consistency.',
    displayName: 'Flux Kontext Pro',
    enabled: true,
    id: 'wavespeed-ai/flux-kontext-pro',
    parameters: {
      imageUrls: { default: [], maxCount: 10 },
      prompt: { default: '' },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description: 'Flux Schnell — Black Forest Labs fast tier, great for drafts.',
    displayName: 'Flux Schnell',
    enabled: true,
    id: 'wavespeed-ai/flux-schnell',
    parameters: {
      prompt: { default: '' },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.003, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
];

export const wavespeedVideoModels: AIVideoModelCard[] = [
  {
    description: 'OpenAI Sora 2 — 720p cinematic text-to-video with native audio.',
    displayName: 'Sora 2',
    enabled: true,
    id: 'openai/sora-2/text-to-video',
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.1, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description: 'OpenAI Sora 2 Pro 720p — premium cinematic generation.',
    displayName: 'Sora 2 Pro 720p',
    enabled: true,
    id: 'openai/sora-2-pro/720p/text-to-video',
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.3, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description: 'OpenAI Sora 2 Pro 1080p — highest quality cinematic generation.',
    displayName: 'Sora 2 Pro 1080p',
    enabled: true,
    id: 'openai/sora-2-pro/1080p/text-to-video',
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.5, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description: 'Google Veo 3.1 Fast — 1080p with native audio, cheapest quality tier.',
    displayName: 'Veo 3.1 Fast',
    enabled: true,
    id: 'google/veo3.1-fast/text-to-video',
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.12, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description: 'Google Veo 3.1 Full — flagship 1080p with audio, max quality.',
    displayName: 'Veo 3.1',
    enabled: true,
    id: 'google/veo3.1/text-to-video',
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.4, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description: 'Kuaishou Kling 2.6 Pro — 1080p, 10s, optional audio.',
    displayName: 'Kling 2.6 Pro',
    enabled: true,
    id: 'kwaivgi/kling-v2.6-pro/text-to-video',
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.07, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description: 'Kuaishou Kling 3.0 Pro — flagship with nativa audio and voice.',
    displayName: 'Kling 3.0 Pro',
    enabled: true,
    id: 'kwaivgi/kling-v3.0-pro/text-to-video',
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.2, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description: 'ByteDance Seedance 2.0 Fast — cheapest 1080p-with-audio on the market.',
    displayName: 'Seedance 2.0 Fast',
    enabled: true,
    id: 'bytedance/seedance-2.0-fast/text-to-video',
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.033, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description: 'MiniMax Hailuo 02 Pro — 1080p, solid quality/price balance.',
    displayName: 'Hailuo 02 Pro',
    enabled: true,
    id: 'minimax/minimax-hailuo-02-pro',
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.08, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description: 'Alibaba Wan 2.7 — text/image/reference-to-video with audio and edit.',
    displayName: 'Wan 2.7',
    enabled: true,
    id: 'alibaba/wan-2.7/text-to-video',
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.1, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description: 'Runway Gen-4 Turbo — cost-effective 720p generation.',
    displayName: 'Runway Gen-4 Turbo',
    enabled: true,
    id: 'runwayml/gen-4-turbo',
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.05, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description: 'Runway Aleph — SOTA video-to-video editing (relight, restyle, inpaint).',
    displayName: 'Runway Aleph',
    enabled: true,
    id: 'runwayml/aleph',
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.18, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description: 'Seedance 2.0 — full-quality tier with audio.',
    displayName: 'Seedance 2.0',
    enabled: true,
    id: 'bytedance/seedance-2.0/text-to-video',
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.08, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description: 'Seedance 2.0 Fast — image-to-video, cheap fast tier.',
    displayName: 'Seedance 2.0 Fast (I2V)',
    // Auto-routed: a reference image attached to the matching `/text-to-video`
    // card transparently routes here at the wavespeed runtime layer. See
    // providers/wavespeed/utils/pairedEndpoint.ts. Hidden from the picker so
    // the user only sees one card per family.
    enabled: false,
    id: 'bytedance/seedance-2.0-fast/image-to-video',
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.022, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description: 'Seedance 2.0 — image-to-video full quality.',
    displayName: 'Seedance 2.0 (I2V)',
    // Auto-routed: a reference image attached to the matching `/text-to-video`
    // card transparently routes here at the wavespeed runtime layer. See
    // providers/wavespeed/utils/pairedEndpoint.ts. Hidden from the picker so
    // the user only sees one card per family.
    enabled: false,
    id: 'bytedance/seedance-2.0/image-to-video',
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.08, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description: 'Kling 3.0 Pro — image-to-video flagship.',
    displayName: 'Kling 3.0 Pro (I2V)',
    // Auto-routed: a reference image attached to the matching `/text-to-video`
    // card transparently routes here at the wavespeed runtime layer. See
    // providers/wavespeed/utils/pairedEndpoint.ts. Hidden from the picker so
    // the user only sees one card per family.
    enabled: false,
    id: 'kwaivgi/kling-v3.0-pro/image-to-video',
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.2, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description: 'Kling 2.6 Pro — image-to-video, cost-effective.',
    displayName: 'Kling 2.6 Pro (I2V)',
    // Auto-routed: a reference image attached to the matching `/text-to-video`
    // card transparently routes here at the wavespeed runtime layer. See
    // providers/wavespeed/utils/pairedEndpoint.ts. Hidden from the picker so
    // the user only sees one card per family.
    enabled: false,
    id: 'kwaivgi/kling-v2.6-pro/image-to-video',
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.07, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description: 'Veo 3.1 — image-to-video flagship from Google.',
    displayName: 'Veo 3.1 (I2V)',
    // Auto-routed: a reference image attached to the matching `/text-to-video`
    // card transparently routes here at the wavespeed runtime layer. See
    // providers/wavespeed/utils/pairedEndpoint.ts. Hidden from the picker so
    // the user only sees one card per family.
    enabled: false,
    id: 'google/veo3.1/image-to-video',
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.4, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description: 'Veo 3.1 Fast — image-to-video cheap tier.',
    displayName: 'Veo 3.1 Fast (I2V)',
    // Auto-routed: a reference image attached to the matching `/text-to-video`
    // card transparently routes here at the wavespeed runtime layer. See
    // providers/wavespeed/utils/pairedEndpoint.ts. Hidden from the picker so
    // the user only sees one card per family.
    enabled: false,
    id: 'google/veo3.1-fast/image-to-video',
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.12, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description: 'Sora 2 — animate a reference image with native audio.',
    displayName: 'Sora 2 (I2V)',
    // Auto-routed: a reference image attached to the matching `/text-to-video`
    // card transparently routes here at the wavespeed runtime layer. See
    // providers/wavespeed/utils/pairedEndpoint.ts. Hidden from the picker so
    // the user only sees one card per family.
    enabled: false,
    id: 'openai/sora-2/image-to-video',
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.1, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description: 'Wan 2.7 — image-to-video with edit support.',
    displayName: 'Wan 2.7 (I2V)',
    // Auto-routed: a reference image attached to the matching `/text-to-video`
    // card transparently routes here at the wavespeed runtime layer. See
    // providers/wavespeed/utils/pairedEndpoint.ts. Hidden from the picker so
    // the user only sees one card per family.
    enabled: false,
    id: 'alibaba/wan-2.7/image-to-video',
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.1, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description: 'Runway Gen-4.5 — high-quality cinematic generator.',
    displayName: 'Runway Gen-4.5',
    enabled: true,
    id: 'runwayml/gen-4.5',
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.15, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description: 'Luma Ray 2 — image-to-video with cinematic motion.',
    displayName: 'Luma Ray 2 (I2V)',
    enabled: true,
    id: 'luma/ray-2-i2v',
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.18, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description: 'Luma Ray 2 Flash — fast and cheap image-to-video.',
    displayName: 'Luma Ray 2 Flash (I2V)',
    enabled: true,
    id: 'luma/ray-2-flash-i2v',
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.05, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description: 'Pika 2.2 — well-rounded text-to-video model.',
    displayName: 'Pika 2.2',
    enabled: true,
    id: 'pika/pika-v2.2/text-to-video',
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.08, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description: 'MiniMax Hailuo 02 Standard — cheaper standard quality tier.',
    displayName: 'Hailuo 02 Standard',
    enabled: true,
    id: 'minimax/minimax-hailuo-02-standard',
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.03, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
];

export const allModels = [...wavespeedImageModels, ...wavespeedVideoModels];

export default allModels;
