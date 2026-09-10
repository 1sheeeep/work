ALTER TABLE users
  ADD COLUMN IF NOT EXISTS skill_group TEXT NOT NULL DEFAULT '';

UPDATE users
SET skill_group = CASE
  WHEN role = 'agent' AND skill_group = '' THEN '咨询接待'
  WHEN role = 'admin' THEN ''
  ELSE skill_group
END;
