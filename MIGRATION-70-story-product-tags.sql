-- Migration 70: Story product tags for BOVI consultant
-- When admin tags a story with a product, the bot can answer story replies with product info.

CREATE TABLE IF NOT EXISTS story_product_tags (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bot_id TEXT,
  story_id TEXT NOT NULL,
  story_url TEXT,
  thumbnail_url TEXT,
  product_name TEXT NOT NULL,
  product_price_kzt NUMERIC,
  product_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,
  UNIQUE(story_id)
);

CREATE INDEX IF NOT EXISTS idx_story_product_tags_story_url ON story_product_tags (story_url);
CREATE INDEX IF NOT EXISTS idx_story_product_tags_expires ON story_product_tags (expires_at);
