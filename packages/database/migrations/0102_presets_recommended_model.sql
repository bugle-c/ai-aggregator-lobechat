-- Preset model_id is a hint, not a hard binding.
--
-- Why: we're an aggregator. Users pick the provider/model based on
-- cost, speed, and what their plan allows. A preset is a curated
-- prompt style + params lock — it should not yank the model selector.
--
-- model_id becomes recommended_model_id (nullable). The field is still
-- used for the "filter by model" tab in the gallery, and a future UI
-- hint may surface "this preset was authored with X in mind", but the
-- selection action no longer changes the current model.

ALTER TABLE presets RENAME COLUMN model_id TO recommended_model_id;
ALTER TABLE presets ALTER COLUMN recommended_model_id DROP NOT NULL;
