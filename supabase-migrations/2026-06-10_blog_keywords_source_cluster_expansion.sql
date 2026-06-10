-- Allow cluster-expansion-seeded keywords. The producer in track-positions.sh
-- inserts blog_keywords rows with source='cluster_expansion' for the uncovered
-- related_keywords of high-traffic clusters. The prior constraint only allowed
-- yandex_api / manual / ai_generated, so the insert would 23514 without this.
ALTER TABLE ai_aggregator.blog_keywords
  DROP CONSTRAINT IF EXISTS blog_keywords_source_check;
ALTER TABLE ai_aggregator.blog_keywords
  ADD CONSTRAINT blog_keywords_source_check
  CHECK (source IN ('yandex_api','manual','ai_generated','cluster_expansion'));
