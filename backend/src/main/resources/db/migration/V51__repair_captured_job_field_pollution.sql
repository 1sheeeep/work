UPDATE job_positions
SET education_requirement = substring(education_requirement FROM '(学历不限|初中及以下|中专/中技|高中|大专|本科|硕士|博士)')
WHERE capture_source = 'VISIBLE_PAGE'
  AND education_requirement LIKE '%无匹配数据%'
  AND education_requirement ~ '(学历不限|初中及以下|中专/中技|高中|大专|本科|硕士|博士)';

UPDATE job_positions
SET salary_display = salary_min_k || '-' || salary_max_k || 'K'
WHERE capture_source = 'VISIBLE_PAGE'
  AND salary_display IS NOT NULL
  AND salary_display !~* '[0-9]+([.][0-9]+)?[[:space:]]*[-–~至][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*K';
