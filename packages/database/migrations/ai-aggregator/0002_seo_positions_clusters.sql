-- DDL for SEO position tracker + cluster builder — applied to prod 2026-04-24.
-- See docs/plans/2026-04-24-seo-position-cluster-plan.md
-- Checkpoint file (not part of Drizzle sequential chain).

-- Daily positions snapshot per URL
CREATE TABLE IF NOT EXISTS ai_aggregator.blog_positions (
  id            serial PRIMARY KEY,
  post_id       uuid NOT NULL REFERENCES ai_aggregator.blog_posts(id) ON DELETE CASCADE,
  url           text NOT NULL,
  snapshot_date date NOT NULL,
  avg_position  numeric(6,2),
  impressions   integer NOT NULL DEFAULT 0,
  clicks        integer NOT NULL DEFAULT 0,
  ctr           numeric(5,4),
  top_query     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(post_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS blog_positions_post_date_idx ON ai_aggregator.blog_positions(post_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS blog_positions_date_idx ON ai_aggregator.blog_positions(snapshot_date);

-- Keyword clusters
CREATE TABLE IF NOT EXISTS ai_aggregator.blog_clusters (
  id                 serial PRIMARY KEY,
  primary_keyword    text NOT NULL,
  related_keywords   text[] NOT NULL DEFAULT '{}'::text[],
  avg_competition    numeric(3,2),
  total_impressions  integer,
  category_slug      text,
  status             text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'used', 'skipped')),
  used_in_post_id    uuid REFERENCES ai_aggregator.blog_posts(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blog_clusters_status_idx ON ai_aggregator.blog_clusters(status);
CREATE INDEX IF NOT EXISTS blog_clusters_category_idx ON ai_aggregator.blog_clusters(category_slug);

-- Reoptimize queue
CREATE TABLE IF NOT EXISTS ai_aggregator.reoptimize_queue (
  id              serial PRIMARY KEY,
  post_id         uuid NOT NULL REFERENCES ai_aggregator.blog_posts(id) ON DELETE CASCADE,
  reason          text NOT NULL,
  prev_position   numeric(6,2),
  current_position numeric(6,2),
  position_delta  numeric(6,2),
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'done', 'dismissed')),
  flagged_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  notes           text
);
CREATE INDEX IF NOT EXISTS reoptimize_queue_status_idx ON ai_aggregator.reoptimize_queue(status);
CREATE INDEX IF NOT EXISTS reoptimize_queue_post_idx ON ai_aggregator.reoptimize_queue(post_id);

-- FK columns
ALTER TABLE ai_aggregator.blog_posts ADD COLUMN IF NOT EXISTS cluster_id integer REFERENCES ai_aggregator.blog_clusters(id) ON DELETE SET NULL;
ALTER TABLE ai_aggregator.blog_keywords ADD COLUMN IF NOT EXISTS cluster_id integer REFERENCES ai_aggregator.blog_clusters(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS blog_posts_cluster_idx ON ai_aggregator.blog_posts(cluster_id);
CREATE INDEX IF NOT EXISTS blog_keywords_cluster_idx ON ai_aggregator.blog_keywords(cluster_id);

-- updated_at trigger on clusters (reuse set_updated_at from 0001_model_rates.sql)
DROP TRIGGER IF EXISTS blog_clusters_set_updated_at ON ai_aggregator.blog_clusters;
CREATE TRIGGER blog_clusters_set_updated_at
  BEFORE UPDATE ON ai_aggregator.blog_clusters
  FOR EACH ROW EXECUTE FUNCTION ai_aggregator.set_updated_at();
