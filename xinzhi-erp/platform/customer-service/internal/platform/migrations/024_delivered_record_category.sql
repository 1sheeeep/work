WITH delivered_groups AS (
  SELECT
    settings.id,
    jsonb_agg(
      jsonb_set(item.value, '{primary}', to_jsonb('已签收'::text))
      ORDER BY item.ordinality
    ) AS categories
  FROM record_category_settings AS settings
  CROSS JOIN LATERAL jsonb_array_elements(settings.categories)
    WITH ORDINALITY AS item(value, ordinality)
  WHERE item.value->>'primary' = '已发货'
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(settings.categories) AS existing(value)
      WHERE existing.value->>'primary' = '已签收'
    )
  GROUP BY settings.id
)
UPDATE record_category_settings AS settings
SET
  categories = settings.categories || delivered_groups.categories,
  updated_at = NOW()
FROM delivered_groups
WHERE settings.id = delivered_groups.id;
