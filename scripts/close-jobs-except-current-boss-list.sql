BEGIN;

UPDATE job_positions
SET status = 'CLOSED',
    updated_at = CURRENT_TIMESTAMP
WHERE status <> 'CLOSED'
  AND title NOT IN (
    '跨境客服主管+月休6天+五险+无责底薪',
    '短视频剪辑/pr/五险/月休6天',
    '人事前台+月休6天+社保+文职坐班',
    '房产销售+就带客户看房不需要找客户',
    '接受小白房地产新媒体运营+百元内报销车费'
  );

DO $$
DECLARE
    visible_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO visible_count
    FROM job_positions
    WHERE status <> 'CLOSED';

    IF visible_count <> 5 THEN
        RAISE EXCEPTION 'Expected 5 non-closed jobs after update, found %', visible_count;
    END IF;
END $$;

COMMIT;
