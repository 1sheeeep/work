ALTER TABLE users
  ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT '';

UPDATE users
SET department = CASE
  WHEN role = 'agent' AND department = '' THEN '客服部'
  WHEN role <> 'agent' THEN ''
  ELSE department
END;
