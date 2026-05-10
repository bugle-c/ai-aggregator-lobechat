-- Fix preset model_id values to match real model-bank slugs.
--
-- Original 0098_presets.sql seeded with `flux-pro` (a non-existent
-- bare slug) for 9 image presets. Replace with the real registered
-- ID `wavespeed-ai/flux-1.1-pro-ultra`.
--
-- The other three model_ids in 0098 (`bytedance/seedance-2.0-fast/
-- text-to-video`, `kwaivgi/kling-v3.0-pro/text-to-video`,
-- `google/nano-banana-pro/text-to-image`) match model-bank already
-- and need no change.
--
-- Provider derivation (a separate concern handled in the preset slice
-- code) routes through the `lobehub` aggregator that hosts every
-- registered model — fix lives in src/store/{image,video}/slices/
-- preset/action.ts, not here.

UPDATE presets
   SET model_id = 'wavespeed-ai/flux-1.1-pro-ultra'
 WHERE modality = 'image' AND model_id = 'flux-pro';
