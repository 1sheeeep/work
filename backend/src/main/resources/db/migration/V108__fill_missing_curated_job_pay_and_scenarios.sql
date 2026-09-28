-- HR 提供的岗位话术仅作为同名、已审核岗位的缺失资料补充。
-- 已有薪资、工时、福利不覆盖；混写其他岗位的 Shopify AI 话术不用于待遇承诺。
WITH tracks(title, salary, work_time, benefits, scenario) AS (
    VALUES
    ('电商财务文员', '试用期4000元；转正后4000元+1000元绩效+奖金，试用期2个月。',
     '8:00-12:00、13:00-17:00，月休6天，轮休。',
     '试用期2个月，转正后缴纳社保；节日福利、加班费及奖金。食宿自理，暂无餐补房补。',
     '候选人问 Excel 技能时，可说明岗位会使用 VLOOKUP、SUMIFS 和数据透视表；收到简历后结合实际经历核对，不先判断是否录用。'),
    ('独立站跨境电商运营+大小周+五险一金', '底薪+提成，综合薪资5K-10K，具体面议。',
     '10:00-12:30、14:00-19:00，月休6天，大小周。',
     '入职缴纳五险一金；新人有一对一带教。',
     '候选人问运营模式，可说明全品类爆款铺货；问带教，可说明一对一带教；面试时间由 HR 确认。'),
    ('短视频剪辑/pr/五险/月休6天', '试用期4000元；转正后4500元+奖金+提成，试用期2个月。',
     '9:00-12:00、13:00-18:00，月休6天，具体排班由部门安排。',
     '试用期2个月，转正后缴纳社保；节日福利、加班费及奖金。食宿自理。',
     '候选人问素材来源，可说明由拍摄部门提供、无需自行拍摄；问每日剪辑量，不承诺固定条数，依运营部门需求变化。'),
    ('房产销售+就带客户看房不需要找客户', '试用期无责底薪3500元+500元全勤+提成；转正后无责底薪4000元+500元全勤+提成，综合5K-8K，具体面议。',
     '9:00-18:00，12:00-13:30午休，每月调休4天。', NULL,
     '候选人问客户来源，可说明客户由公司分配；问外出车辆，可说明可使用公司车辆。提成算法、补贴和社保仍由 HR 核实。'),
    ('接受小白房地产新媒体运营+百元内报销车费', '试用期无责底薪3500元+500元全勤+提成；转正后无责底薪4000元+500元全勤+提成，综合5K-8K，具体面议。',
     '9:00-18:00，12:00-13:30午休，每月调休4天。',
     '食宿自理；面试往返车费百元以内报销，凭证和适用条件由 HR 确认；持全国房地产经纪人证有每年2500元补贴，适用条件由 HR 确认。',
     '候选人问经验，可说明接受无经验；问面试车费，可说明百元以内报销，具体凭证条件由 HR 确认；不主动承诺提成算法或社保。'),
    ('资料文员+月休6天+无责底薪+社保', '试用期3000元+500元绩效，合计3500元；转正后3500元+1500元绩效，合计5000元，试用期2个月。',
     '9:00-12:00、13:00-18:00，月休6天，轮休。', '试用期2个月，转正后缴纳社保；节日福利及加班费。',
     '候选人问是否有人带，可说明前期有人带教；问加班时长，只能说明忙时可能加班，具体依部门安排。'),
    ('跨境客服主管+月休6天+五险+无责底薪', '底薪+绩效+奖金+晚班补贴+加班费，综合8K-14K，具体面议。',
     '9:00-18:00，月休6天，调休。', '试用期2个月，转正后缴纳五险。',
     '候选人有国内电商客服经验但没有跨境经验时，可说明前期有人带教，具体适配结合简历评估；公积金事项交由 HR 确认。'),
    ('跨境电商运营助理+无责4k-4.5K+月休6天', '试用期无责4000元；转正后无责4500元+提成，试用期2个月。',
     '13:00-17:00、18:00-22:00，月休6天，具体排班由部门安排。',
     '试用期2个月，转正后缴纳社保；节日福利及加班费。',
     '候选人问平台，可说明独立站及 Facebook 广告投放；问加班多久，可说明依实际工作安排，不承诺固定时长。'),
    ('AI运营助理｜小白可学不要求经验｜无需编程', '试用期4000元；转正后4500元+提成，试用期2个月。具体薪资依个人能力和成长情况沟通。',
     '13:00-17:00、18:00-22:00，月休6天，具体排班由部门安排。',
     '试用期2个月，转正后缴纳社保；节日福利及加班费。',
     '候选人问无经验，可说明接受无经验；问培训，可说明入职培训约一周，后续有带教；夜间工作和加班依部门实际安排。')
)
UPDATE job_positions AS job
SET salary_display = CASE WHEN COALESCE(BTRIM(job.salary_display), '') IN ('', '待补全', '未提供') THEN tracks.salary ELSE job.salary_display END,
    work_time = CASE WHEN COALESCE(BTRIM(job.work_time), '') IN ('', '待补全', '未提供') THEN tracks.work_time ELSE job.work_time END,
    benefits = CASE WHEN COALESCE(BTRIM(job.benefits), '') IN ('', '待补全', '未提供') THEN tracks.benefits
                    WHEN job.title = '接受小白房地产新媒体运营+百元内报销车费' AND job.benefits = '食宿自理。'
                    THEN tracks.benefits
                    ELSE job.benefits END,
    reply_summary = CASE WHEN POSITION(tracks.scenario IN COALESCE(job.reply_summary, '')) = 0
                         THEN '话术补充：' || tracks.scenario || E'\n' || COALESCE(job.reply_summary, '')
                         ELSE job.reply_summary END,
    knowledge_version = job.knowledge_version + 1,
    updated_at = CURRENT_TIMESTAMP
FROM tracks
WHERE job.title = tracks.title
  AND job.knowledge_approved = TRUE
  AND (COALESCE(BTRIM(job.salary_display), '') IN ('', '待补全', '未提供')
       OR (COALESCE(BTRIM(job.work_time), '') IN ('', '待补全', '未提供') AND tracks.work_time IS NOT NULL)
       OR (COALESCE(BTRIM(job.benefits), '') IN ('', '待补全', '未提供') AND tracks.benefits IS NOT NULL)
       OR (job.title = '接受小白房地产新媒体运营+百元内报销车费' AND job.benefits = '食宿自理。')
       OR POSITION(tracks.scenario IN COALESCE(job.reply_summary, '')) = 0);
