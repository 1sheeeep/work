CREATE TABLE IF NOT EXISTS visitor_schemes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'auto',
  instant_answers_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  instant_answers JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_visitor_schemes_name_unique
ON visitor_schemes (LOWER(name));

CREATE UNIQUE INDEX IF NOT EXISTS idx_visitor_schemes_single_default
ON visitor_schemes (is_default) WHERE is_default;

CREATE TABLE IF NOT EXISTS visitor_scheme_assignments (
  shop_id TEXT PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
  scheme_id TEXT NOT NULL REFERENCES visitor_schemes(id),
  applied_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_visitor_scheme_assignments_scheme
ON visitor_scheme_assignments (scheme_id, shop_id);

CREATE OR REPLACE FUNCTION xzdesk_try_jsonb(input TEXT, fallback JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN input::jsonb;
EXCEPTION WHEN OTHERS THEN
  RETURN fallback;
END;
$$;

INSERT INTO visitor_schemes (
  id, name, language, instant_answers_enabled, instant_answers,
  is_default, created_at, updated_at
)
VALUES (
  'visitor_scheme_default',
  '默认方案',
  'auto',
  TRUE,
  '[{"id":"track_order","title":"Track my order","answer":"Enter your order number and email address to see the latest order and tracking status.","mode":"order_tracking","enabled":true,"sort":0}]'::jsonb,
  TRUE,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

WITH source_schemes AS (
  SELECT DISTINCT ON (LOWER(BTRIM(metadata->>'visitorSchemeName')))
    'visitor_scheme_' || MD5(LOWER(BTRIM(metadata->>'visitorSchemeName'))) AS id,
    BTRIM(metadata->>'visitorSchemeName') AS name,
    CASE
      WHEN LOWER(BTRIM(metadata->>'visitorLanguage')) IN ('auto', 'en')
        THEN LOWER(BTRIM(metadata->>'visitorLanguage'))
      ELSE 'auto'
    END AS language,
    COALESCE(LOWER(metadata->>'instantAnswersEnabled') <> 'false', TRUE) AS instant_answers_enabled,
    xzdesk_try_jsonb(
      metadata->>'instantAnswersJson',
      '[{"id":"track_order","title":"Track my order","answer":"Enter your order number and email address to see the latest order and tracking status.","mode":"order_tracking","enabled":true,"sort":0}]'::jsonb
    ) AS instant_answers,
    created_at,
    updated_at
  FROM shop_sources
  WHERE type = 'shopify_chat'
    AND BTRIM(COALESCE(metadata->>'visitorSchemeName', '')) <> ''
    AND BTRIM(metadata->>'visitorSchemeName') <> '默认方案'
    AND NOT (
      BTRIM(metadata->>'visitorSchemeName') LIKE '% 默认方案'
      AND COALESCE(LOWER(BTRIM(metadata->>'visitorLanguage')), 'auto') = 'auto'
      AND COALESCE(LOWER(metadata->>'instantAnswersEnabled') <> 'false', TRUE)
      AND xzdesk_try_jsonb(
        metadata->>'instantAnswersJson',
        '[{"id":"track_order","title":"Track my order","answer":"Enter your order number and email address to see the latest order and tracking status.","mode":"order_tracking","enabled":true,"sort":0}]'::jsonb
      ) = '[{"id":"track_order","title":"Track my order","answer":"Enter your order number and email address to see the latest order and tracking status.","mode":"order_tracking","enabled":true,"sort":0}]'::jsonb
    )
  ORDER BY LOWER(BTRIM(metadata->>'visitorSchemeName')), updated_at DESC, id
)
INSERT INTO visitor_schemes (
  id, name, language, instant_answers_enabled, instant_answers,
  is_default, created_at, updated_at
)
SELECT id, name, language, instant_answers_enabled, instant_answers,
       FALSE, created_at, updated_at
FROM source_schemes
ON CONFLICT DO NOTHING;

INSERT INTO visitor_scheme_assignments (shop_id, scheme_id, applied_at)
SELECT
  source.shop_id,
  COALESCE(scheme.id, 'visitor_scheme_default'),
  NOW()
FROM shop_sources source
LEFT JOIN visitor_schemes scheme
  ON LOWER(scheme.name) = LOWER(BTRIM(source.metadata->>'visitorSchemeName'))
WHERE source.type = 'shopify_chat'
ON CONFLICT (shop_id) DO NOTHING;

UPDATE shop_sources source
SET metadata = source.metadata || jsonb_build_object(
      'visitorSchemeId', scheme.id,
      'visitorSchemeName', scheme.name
    ),
    updated_at = source.updated_at
FROM visitor_scheme_assignments assignment
JOIN visitor_schemes scheme ON scheme.id = assignment.scheme_id
WHERE source.shop_id = assignment.shop_id
  AND source.type = 'shopify_chat';

DROP FUNCTION IF EXISTS xzdesk_try_jsonb(TEXT, JSONB);
