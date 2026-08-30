(() => {
  if (window.__recruitmentReadOnlyBridgeLoaded) return;
  window.__recruitmentReadOnlyBridgeLoaded = true;

  const CHAT_URL = /\/web\/chat\/(?:index|user-center)(?:[/?#]|$)/i;
  const SELECTORS = {
    conversation: '.geek-item', unread: '.badge-count', job: '.source-job', preview: '.push-text', time: '.time',
    selectedConversation: '.geek-item.selected', activeConversation: '.conversation-message',
    message: '.item-friend, .item-myself', inbound: '.item-friend', outbound: '.item-myself', messageTime: '.message-time',
  };
  const JOB_SELECTORS = {
    cards: ['.job-jobInfo-warp[data-id]', '.job-jobInfo-warp', '[data-job-id]', '[data-position-id]', '.job-list-wrap .job-card-wrapper', '.job-list-box .job-card-wrapper', '.job-list .job-item', '.job-list-item', '.job-card', '[class*="job-card"]', '[class*="job-item"]'],
    title: ['.job-title a', '[class*="job-name"]', '[class*="job-title"]', '.name', 'h3', 'h2'],
    location: ['[class*="job-area"]', '[class*="location"]', '[class*="address"]'],
    salary: ['[class*="salary"]', '[class*="red"]'],
    experience: ['[class*="experience"]', '[class*="exp"]'],
    education: ['[class*="degree"]', '[class*="education"]'],
    description: ['[class*="job-detail"]', '[class*="description"]', '[class*="job-desc"]'],
  };
  let collectTimer = null;
  let collecting = false;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!['BRIDGE_COLLECT', 'BRIDGE_COLLECT_JOBS'].includes(message?.type)) return false;
    const task = message.type === 'BRIDGE_COLLECT_JOBS' ? collectJobsAndPublish(Boolean(message.allowEmbeddedJobList)) : collectAndPublish(true);
    task.then((result) => sendResponse(result || { ok: true })).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });

  const observer = new MutationObserver(() => scheduleCollect(1_200));
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-id'] });
  window.addEventListener('focus', () => scheduleCollect(500), { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleCollect(500); }, { passive: true });
  scheduleCollect(1_500);

  function scheduleCollect(delay) {
    clearTimeout(collectTimer);
    collectTimer = setTimeout(() => void collectAndPublish(false), delay);
  }

  async function collectAndPublish(reportNonChat) {
    if (collecting) return;
    collecting = true;
    try {
      const page = classifyPage();
      if (!page.ok) {
        if (reportNonChat || ['RISK_OR_VERIFICATION', 'LOGIN_REQUIRED'].includes(page.code)) {
          await send({ type: 'BRIDGE_PAGE_BLOCKED', payload: page });
        }
        return;
      }
      const first = await collectSnapshot();
      if (!first.ok) return void await send({ type: 'BRIDGE_PAGE_BLOCKED', payload: first });
      await delay(900);
      const second = await collectSnapshot();
      if (!second.ok) return void await send({ type: 'BRIDGE_PAGE_BLOCKED', payload: second });
      if (first.signature !== second.signature) return;
      const firstSelected = await collectSelectedConversation();
      await delay(250);
      const secondSelected = await collectSelectedConversation();
      const stableSelected = firstSelected.ok && secondSelected.ok && firstSelected.signature === secondSelected.signature ? secondSelected : null;
      const selected = stableSelected && second.entries.some((entry) => entry.chatDigest === stableSelected.chatDigest) ? stripSelected(stableSelected) : null;
      const detailStatus = selected
        ? { code: 'VERIFIED', reason: '当前会话详情已稳定识别。' }
        : stableSelected
          ? { code: 'SELECTED_NOT_IN_LIST', reason: '当前会话不属于本次稳定列表，等待再次确认。' }
          : !firstSelected.ok
            ? { code: firstSelected.code, reason: firstSelected.reason }
            : !secondSelected.ok
              ? { code: secondSelected.code, reason: secondSelected.reason }
              : { code: 'DETAIL_CHANGED', reason: '当前会话详情仍在变化，等待稳定。' };
      await send({ type: 'BRIDGE_PAGE_SNAPSHOT', payload: { pageState: 'CHAT_PAGE_READY', entries: second.entries, selected, detailStatus } });
    } finally {
      collecting = false;
    }
  }

  async function collectJobsAndPublish(allowEmbeddedJobList) {
    if (collecting) return { ok: false, error: '页面正在生成另一份稳定快照，请稍后重试。' };
    collecting = true;
    try {
      const page = classifyJobPage(allowEmbeddedJobList);
      if (!page.ok) { await send({ type: 'BRIDGE_JOB_BLOCKED', payload: page }); return { ok: false, error: page.reason }; }
      const collectCurrentJobPage = isJobDetailPage() ? collectJobDetailSnapshot : collectJobSnapshot;
      const first = await collectCurrentJobPage();
      if (!first.ok) { await send({ type: 'BRIDGE_JOB_BLOCKED', payload: first }); return { ok: false, error: first.reason }; }
      await delay(900);
      const second = await collectCurrentJobPage();
      if (!second.ok) { await send({ type: 'BRIDGE_JOB_BLOCKED', payload: second }); return { ok: false, error: second.reason }; }
      if (first.signature !== second.signature) return { ok: false, error: '职位列表仍在变化，请等待页面稳定后重试。' };
      const response = await send({ type: 'BRIDGE_JOB_SNAPSHOT', payload: { pageState: 'JOB_MANAGEMENT_READY', entries: second.entries, observedAt: new Date().toISOString() } });
      return response?.ok ? response : { ok: false, pageMatched: true, error: response?.error || '本地服务未接受职位快照。' };
    } finally { collecting = false; }
  }

  function isJobDetailPage() {
    return /\/web\/chat\/job\/(?:edit|detail)(?:[/?#]|$)/i.test(location.pathname)
      || Boolean(findJobDetailRoot());
  }

  async function collectJobDetailSnapshot() {
    const root = findJobDetailRoot();
    if (!root || !visible(root)) return blocked('JOB_DETAIL_NOT_FOUND', '当前职位详情尚未加载完成。');
    const rowValue = (label) => {
      const row = [...root.querySelectorAll('.form-row')].find((item) => compact(item.querySelector('.title')?.textContent).includes(label));
      if (row) {
        const control = row.querySelector('input:not([type="hidden"]), textarea');
        if (control && compact(control.value)) return compact(control.value);
        const selected = compact(row.querySelector('.ui-select-selected-value, .content')?.textContent);
        if (selected) return selected;
      }
      return semanticFieldValue(root, label);
    };
    const title = compact(root.querySelector("input[name='jobName'], .job-name input, input[placeholder*='职位名称']")?.value) || rowValue('职位名称');
    if (!title || title.length < 2) return blocked('JOB_TITLE_MISSING', '职位详情没有可识别的职位名称。');
    const descriptionNode = root.querySelector('.performance-row textarea, textarea[maxlength="5000"], textarea');
    const description = cleanMultiline(descriptionNode?.value).slice(0, 10000);
    const recruitmentType = compact(root.querySelector('.recruitment-type-wrap .ui-select-selected-value')?.textContent) || rowValue('招聘类型');
    const jobCategory = compact(root.querySelector("input[name='jobCategory']")?.value)
      || compact(root.querySelector('.job-category-tag-container')?.innerText) || rowValue('职位类型');
    const overseasRequirement = compact(root.querySelector('.overseas-entry-container .chose-item.active')?.textContent) || rowValue('是否驻外');
    const experienceRaw = compact(root.querySelector('.job-experience-row .ui-select-selected-value')?.textContent) || rowValue('经验');
    const experienceRequirement = matchText(experienceRaw, /(?:经验不限|不限|应届生|在校生|\d{1,2}(?:-\d{1,2})?年(?:以上|以内)?)/);
    const educationRaw = rowValue('学历');
    const educationRequirement = matchText(educationRaw, /(?:学历不限|不限|初中及以下|中专\/中技|高中|大专|本科|硕士|博士)(?:及以上)?/);
    const salaryValues = [...root.querySelectorAll('.scope-selecter .scope-select .ui-select-selected-value')].map((node) => compact(node.textContent)).filter(Boolean);
    const salaryRaw = salaryValues.length >= 2 ? `${salaryValues[0]}-${salaryValues[1]}` : (rowValue('薪资详情') || salaryValues.join('-'));
    const salaryDisplay = matchText(salaryRaw, /\d{1,3}(?:\.\d+)?\s*[-–~至]\s*\d{1,3}(?:\.\d+)?\s*[Kk](?:\s*[·x×]\s*\d{2}\s*薪)?/);
    const salary = parseSalary(salaryDisplay);
    const salaryMonthsText = compact(root.querySelector('.salaryMonth-select .ui-select-selected-value')?.textContent) || rowValue('薪数');
    const salaryMonthsMatch = salaryMonthsText.match(/(?:^|\D)(1[2-6])(?:\D|$)/);
    const salaryMonths = salaryMonthsMatch ? Number(salaryMonthsMatch[1]) : null;
    const jobKeywords = [...root.querySelectorAll('.job-skill-content .job-skill-item, .job-skill-content .skill-tag, .job-skill-content .tag')]
      .map((node) => compact(node.textContent)).filter(Boolean).filter((value, index, list) => list.indexOf(value) === index).join('｜').slice(0, 500);
    const workAddress = compact(root.querySelector('.job-address input.ipt, .job-address input')?.value) || rowValue('工作地址') || rowValue('工作地点');
    const sourceDigest = await digest(`detail:${location.pathname}:${new URLSearchParams(location.search).get('encryptId') || title}`);
    const values = [title, recruitmentType, description, jobCategory, overseasRequirement, experienceRequirement,
      educationRequirement, salaryDisplay, salaryMonths, jobKeywords, workAddress];
    const entry = {
      sourceDigest, title, location: null, salaryDisplay: salaryDisplay || null,
      salaryMinK: salary.min, salaryMaxK: salary.max, salaryMonths,
      experienceRequirement: experienceRequirement || null, educationRequirement: educationRequirement || null,
      description: description || null, recruitmentType: recruitmentType || null, jobCategory: jobCategory || null,
      overseasRequirement: overseasRequirement || null, jobKeywords: jobKeywords || null, workAddress: workAddress || null,
      completeness: values.filter(Boolean).length,
    };
    const signature = Object.values(entry).map((value) => value ?? '').join('|');
    return { ok: true, entries: [entry], signature };
  }

  function findJobDetailRoot() {
    const fixed = document.querySelector('.job-edit-container.edit-job, .job-edit-container');
    if (fixed && visible(fixed)) return fixed;
    if (!/\/web\/chat\/job\/(?:edit|detail)(?:[/?#]|$)/i.test(location.pathname)) return null;
    const descriptions = [...document.querySelectorAll('textarea')].filter(visible);
    for (const description of descriptions) {
      let node = description.parentElement;
      for (let depth = 0; node && depth < 10; depth++, node = node.parentElement) {
        const text = compact(node.innerText || node.textContent);
        const inputs = node.querySelectorAll('input:not([type="hidden"]), textarea, [class*="select"]');
        if (text.includes('职位基本信息') && text.includes('职位要求') && inputs.length >= 5) return node;
      }
    }
    return null;
  }

  function semanticFieldValue(root, label) {
    const candidates = [...root.querySelectorAll('label, span, div')]
      .filter((node) => visible(node) && compact(node.textContent).replace(/[：:]/g, '') === label.replace(/[：:]/g, ''));
    for (const labelNode of candidates) {
      let row = labelNode.parentElement;
      for (let depth = 0; row && depth < 5 && root.contains(row); depth++, row = row.parentElement) {
        const control = row.querySelector('input:not([type="hidden"]), textarea');
        const value = compact(control?.value);
        if (value) return value;
        const selected = [...row.querySelectorAll('.ui-select-selected-value, [class*="selected-value"], [class*="chose-item"].active, [class*="radio"].active')]
          .map((node) => compact(node.textContent)).find(Boolean);
        if (selected) return selected;
      }
    }
    return '';
  }

  function classifyPage() {
    const safety = classifySafety();
    if (!safety.ok) return safety;
    const text = document.body?.innerText || '';
    if (!CHAT_URL.test(location.pathname)) return blocked('NOT_CHAT_PAGE', '当前不在 BOSS 沟通页，不会自动跳转。');
    if (!text.trim()) return blocked('PAGE_LOADING', 'BOSS 沟通页仍在加载。');
    return { ok: true };
  }

  function classifyJobPage(allowEmbeddedJobList) {
    const safety = classifySafety();
    if (!safety.ok) return safety;
    const text = document.body?.innerText || '';
    const routeLooksRelevant = /(?:job|position)/i.test(location.pathname) && !CHAT_URL.test(location.pathname);
    const headingLooksRelevant = ['职位管理', '我的职位', '职位列表'].some((term) => text.includes(term));
    const embeddedList = allowEmbeddedJobList && document.querySelector('.job-jobInfo-warp');
    if (!routeLooksRelevant && !headingLooksRelevant && !embeddedList) return blocked('NOT_JOB_MANAGEMENT_PAGE', '当前不是 BOSS 职位管理页；扩展不会自动跳转。');
    if (!text.trim()) return blocked('PAGE_LOADING', 'BOSS 职位管理页仍在加载。');
    return { ok: true };
  }

  function classifySafety() {
    const text = document.body?.innerText || '';
    const hasAny = (terms) => terms.some((term) => text.includes(term));
    if (hasAny(['安全验证', '账号异常', '风险验证', '滑动验证', '访问受限'])) return blocked('RISK_OR_VERIFICATION', '检测到 BOSS 验证或风险提示，等待 HR 处理。');
    if (hasAny(['扫码登录', '账号登录', '登录BOSS直聘', '请先登录'])) return blocked('LOGIN_REQUIRED', 'BOSS 登录已失效或尚未完成。');
    return { ok: true };
  }

  async function collectJobSnapshot() {
    const items = findJobCards();
    if (!items.length) return blocked('JOB_LIST_NOT_FOUND', '当前页面未找到具备稳定标识的可见职位卡片，已停止采集。');
    if (items.length > 200) return blocked('JOB_LIST_TOO_LARGE', '当前职位数量超过单次安全上限。');
    const entries = [];
    const seenSources = new Set();
    for (const item of items) {
      const allText = compact(item.textContent).slice(0, 3000);
      const title = firstText(item, JOB_SELECTORS.title, 120) || deriveJobTitle(item);
      if (!title || title.length < 2) return blocked('JOB_TITLE_MISSING', '职位卡片没有可识别标题，已停止采集。');
      const meta = [...item.querySelectorAll('.job-main-info-wrapper .info-labels span')].map((node) => compact(node.textContent)).filter(Boolean);
      const metaText = meta.join(' ');
      const salaryDisplay = firstText(item, JOB_SELECTORS.salary, 120) || matchText(metaText || allText, /(?:\d{1,3}(?:\.\d+)?\s*[-–~至]\s*\d{1,3}(?:\.\d+)?\s*[Kk](?:\s*[·x×]\s*\d{2}\s*薪)?|\d{1,3}\s*[Kk]以上)/);
      const salary = parseSalary(salaryDisplay);
      const location = firstText(item, JOB_SELECTORS.location, 120) || matchText(metaText || allText, /(?:北京|上海|天津|重庆|广州|深圳|杭州|南京|苏州|成都|武汉|西安|长沙|郑州|厦门|合肥|青岛|济南|无锡|宁波|东莞|佛山)(?:[·\-][\u4e00-\u9fa5]{1,10})?/);
      const experienceRequirement = firstText(item, JOB_SELECTORS.experience, 80) || matchText(metaText || allText, /(?:经验不限|应届生|在校生|\d{1,2}(?:-\d{1,2})?年(?:以上)?)/);
      const educationRequirement = firstText(item, JOB_SELECTORS.education, 80) || matchText(metaText || allText, /(?:学历不限|初中及以下|中专\/中技|高中|大专|本科|硕士|博士)(?:及以上)?/);
      const publicIdentity = [location, salaryDisplay, experienceRequirement, educationRequirement].filter(Boolean);
      const identity = stableJobIdentity(item) || (publicIdentity.length >= 2 ? `derived:${title}|${publicIdentity.join('|')}` : '');
      if (!identity) return blocked('JOB_ID_MISSING', '职位卡片既没有稳定 DOM ID，也没有足够公开字段生成稳定摘要。');
      const sourceDigest = await digest(identity);
      if (seenSources.has(sourceDigest)) continue;
      seenSources.add(sourceDigest);
      const description = firstText(item, JOB_SELECTORS.description, 10000);
      const values = [title, location, salaryDisplay, experienceRequirement, educationRequirement, description];
      entries.push({ sourceDigest, title, location: location || null, salaryDisplay: salaryDisplay || null, salaryMinK: salary.min, salaryMaxK: salary.max, salaryMonths: salary.months, experienceRequirement: experienceRequirement || null, educationRequirement: educationRequirement || null, description: description || null, completeness: values.filter(Boolean).length });
    }
    if (!entries.length) return blocked('JOB_LIST_EMPTY_AFTER_DEDUP', '职位行去重后没有可同步数据。');
    const signature = entries.map((entry) => `${entry.sourceDigest}:${entry.title}:${entry.location || ''}:${entry.salaryDisplay || ''}:${entry.experienceRequirement || ''}:${entry.educationRequirement || ''}:${entry.description || ''}`).join('|');
    return { ok: true, entries, signature };
  }

  function findJobCards() {
    for (const selector of JOB_SELECTORS.cards) {
      const exactKnownRow = selector.startsWith('.job-jobInfo-warp');
      const items = [...document.querySelectorAll(selector)].filter(visible).filter((item) => exactKnownRow || stableJobIdentity(item));
      if (items.length) {
        const unique = new Map();
        for (const [index, item] of items.entries()) {
          const key = stableJobIdentity(item) || `known-row:${index}`;
          unique.set(key, unique.get(key) || item);
        }
        return [...unique.values()].slice(0, 201);
      }
    }
    return findSemanticJobRows().slice(0, 201);
  }

  function findSemanticJobRows() {
    const edits = [...document.querySelectorAll('a, button, span, div')]
      .filter((node) => visible(node) && compact(node.textContent) === '编辑');
    const rows = new Set();
    for (const edit of edits) {
      let node = edit.parentElement;
      for (let depth = 0; node && depth < 9; depth++, node = node.parentElement) {
        const rect = node.getBoundingClientRect();
        const text = compact(node.innerText || node.textContent);
        if (rect.width >= 500 && rect.height >= 55 && rect.height <= 260 && hasExactVisibleText(node, '关闭') && looksLikeJobPublicText(text)) {
          rows.add(node);
          break;
        }
      }
    }
    return [...rows].filter(visible);
  }

  function hasExactVisibleText(root, expected) {
    return [...root.querySelectorAll('a, button, span, div')].some((node) => visible(node) && compact(node.textContent) === expected);
  }

  function looksLikeJobPublicText(text) {
    const patterns = [
      /\d{1,3}(?:\.\d+)?\s*[-–~至]\s*\d{1,3}(?:\.\d+)?\s*[Kk]/,
      /(?:经验不限|应届生|在校生|\d{1,2}(?:-\d{1,2})?年(?:以上)?)/,
      /(?:学历不限|初中及以下|中专\/中技|高中|大专|本科|硕士|博士)(?:及以上)?/,
      /(?:北京|上海|天津|重庆|广州|深圳|杭州|南京|苏州|成都|武汉|西安|长沙|郑州|厦门|合肥|青岛|济南|无锡|宁波|东莞|佛山)/,
      /(?:全职|兼职|实习)/,
    ];
    return patterns.filter((pattern) => pattern.test(text)).length >= 2;
  }

  function deriveJobTitle(root) {
    const lines = String(root.innerText || '').split(/\n+/).map(compact).filter(Boolean);
    return (lines.find((line) => line.length >= 2 && line.length <= 120
      && !['编辑', '关闭', '开放中', '待开放', '已关闭', '全职', '兼职', '实习'].includes(line)
      && !/^(?:\d+|看过我|沟通过|感兴趣|\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?到期)$/.test(line)
      && !looksLikePureJobMeta(line)) || '').slice(0, 120);
  }

  function looksLikePureJobMeta(line) {
    return /^(?:(?:北京|上海|天津|重庆|广州|深圳|杭州|南京|苏州|成都|武汉|西安|长沙|郑州|厦门|合肥|青岛|济南|无锡|宁波|东莞|佛山)|(?:经验不限|应届生|在校生|\d{1,2}(?:-\d{1,2})?年(?:以上)?)|(?:学历不限|初中及以下|中专\/中技|高中|大专|本科|硕士|博士)(?:及以上)?|\d{1,3}(?:\.\d+)?\s*[-–~至]\s*\d{1,3}(?:\.\d+)?\s*[Kk])$/.test(line);
  }

  function stableJobIdentity(item) {
    const allowed = /^(data-(?:job-id|position-id|encrypt-id|security-id|id))$/i;
    for (const node of [item, ...item.querySelectorAll('*')].slice(0, 100)) {
      for (const attribute of node.attributes || []) {
        const value = String(attribute.value || '').trim();
        if (allowed.test(attribute.name) && value) return `${attribute.name}:${value}`;
      }
    }
    const link = item.matches('a[href]') ? item : item.querySelector('a[href*="job"],a[href*="position"]');
    if (!link) return '';
    try { const url = new URL(link.href, location.origin); return `${url.pathname}${url.search}`; } catch { return ''; }
  }

  function firstText(root, selectors, max) {
    for (const selector of selectors) {
      const value = compact([...root.querySelectorAll(selector)].find(visible)?.textContent);
      if (value) return value.slice(0, max);
    }
    return '';
  }

  function compact(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
  function cleanMultiline(value) { return String(value || '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim(); }
  function matchText(value, pattern) { return compact(value.match(pattern)?.[0]); }
  function parseSalary(value) {
    const match = String(value || '').match(/(\d{1,3}(?:\.\d+)?)\s*[-–~至]\s*(\d{1,3}(?:\.\d+)?)\s*[Kk]/);
    const months = Number(String(value || '').match(/(?:[·x×]\s*)?(\d{2})\s*薪/)?.[1]);
    return { min: match ? Math.max(1, Math.round(Number(match[1]))) : null, max: match ? Math.max(1, Math.round(Number(match[2]))) : null, months: months >= 12 && months <= 16 ? months : null };
  }

  async function collectSnapshot() {
    const items = [...document.querySelectorAll(SELECTORS.conversation)].filter(visible).slice(0, 201);
    if (!items.length) return blocked('CHAT_LIST_NOT_FOUND', '当前页面未找到可见会话列表。');
    if (items.length > 200) return blocked('CHAT_LIST_TOO_LARGE', '当前会话数量超过安全上限。');
    const entries = [];
    for (const item of items) {
      const identity = stableIdentity(item);
      if (!identity) return blocked('CHAT_ID_MISSING', '会话列表没有稳定 DOM ID，已禁止猜测会话身份。');
      const preview = textOf(item, SELECTORS.preview);
      const job = textOf(item, SELECTORS.job);
      const time = textOf(item, SELECTORS.time);
      const unreadNode = item.querySelector(SELECTORS.unread);
      const unreadCount = unreadNode ? Math.max(1, Number(String(unreadNode.textContent || '').match(/\d+/)?.[0]) || 1) : 0;
      entries.push({
        chatDigest: await digest(identity), previewDigest: preview ? await digest(preview) : null,
        jobDigest: job ? await digest(job) : null, jobTitle: job ? job.slice(0, 120) : null,
        timeDigest: time ? await digest(time) : null, unreadCount,
      });
    }
    const signature = entries.map((entry) => `${entry.chatDigest}:${entry.unreadCount}:${entry.previewDigest || ''}:${entry.jobDigest || ''}:${entry.timeDigest || ''}`).join('|');
    return { ok: true, entries, signature };
  }

  async function collectSelectedConversation() {
    const selected = [...document.querySelectorAll(SELECTORS.selectedConversation)].find(visible);
    if (!selected) return blocked('NO_SELECTED_CONVERSATION', '当前没有 HR 手动打开的会话。');
    const active = [...document.querySelectorAll(SELECTORS.activeConversation)].find(visible);
    if (!active) return blocked('MESSAGE_CONTAINER_NOT_FOUND', '当前会话消息容器尚未就绪。');
    const identity = stableIdentity(selected);
    if (!identity) return blocked('CHAT_ID_MISSING', '当前会话没有稳定 DOM ID。');
    const messages = [...active.querySelectorAll(SELECTORS.message)].filter(visible);
    const last = messages.filter((item) => directionOf(item)).at(-1);
    if (!last) return blocked('LAST_MESSAGE_NOT_FOUND', '当前会话没有可识别的最后消息。');
    const direction = directionOf(last);
    const content = String(last.textContent || '').trim();
    const timeline = [...active.querySelectorAll(`${SELECTORS.messageTime}, ${SELECTORS.message}`)];
    const lastIndex = timeline.indexOf(last);
    const precedingTime = timeline.slice(0, Math.max(0, lastIndex)).reverse().find((item) => item.matches(SELECTORS.messageTime));
    const messageAt = parseTime(String(last.querySelector(SELECTORS.messageTime)?.textContent || precedingTime?.textContent || '').trim());
    if (!messageAt) return blocked('TIME_UNRECOGNISED', '当前会话最后消息时间无法解析。');
    const chatDigest = await digest(identity);
    const mediaShape = [...last.querySelectorAll('img, video, audio, svg')].map((node) => node.tagName.toLowerCase()).join(',') || 'non-text';
    const messageDigest = await digest(stableIdentity(last) || `derived:${direction}:${messageAt}:${content || mediaShape}`);
    const selectedUnread = Boolean(selected.querySelector(SELECTORS.unread));
    return { ok: true, chatDigest, messageDigest, direction, messageAt, selectedUnread, signature: `${chatDigest}:${messageDigest}:${direction}:${messageAt}:${selectedUnread}` };
  }

  function stableIdentity(item) {
    const allowed = /^(data-(?:id|uid|geek-id|friend-id|user-id|conversation-id|encrypt-id|security-id))$/i;
    for (const node of [item, ...item.querySelectorAll('*')].slice(0, 100)) {
      for (const attribute of node.attributes || []) {
        const value = String(attribute.value || '').trim();
        if (allowed.test(attribute.name) && value) return `${attribute.name}:${value}`;
      }
    }
    return '';
  }

  function textOf(root, selector) { return String(root.querySelector(selector)?.textContent || '').trim(); }
  function visible(element) { if (!element) return false; const style = getComputedStyle(element); const rect = element.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0; }
  function directionOf(item) { if (item.matches(SELECTORS.inbound) || item.querySelector(SELECTORS.inbound)) return 'INBOUND'; if (item.matches(SELECTORS.outbound) || item.querySelector(SELECTORS.outbound)) return 'OUTBOUND'; return ''; }
  async function digest(value) { const bytes = new TextEncoder().encode(value); const hash = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(hash)].map((item) => item.toString(16).padStart(2, '0')).join(''); }
  function parseTime(value) {
    const direct = Date.parse(value); if (Number.isFinite(direct)) return new Date(direct).toISOString();
    const now = new Date(); let match = value.match(/^(?:(昨天)\s*)?(\d{1,2}):(\d{2})$/);
    if (match) { const date = new Date(now); date.setSeconds(0, 0); date.setHours(Number(match[2]), Number(match[3]), 0, 0); if (match[1]) date.setDate(date.getDate() - 1); else if (date.getTime() > now.getTime() + 60_000) date.setDate(date.getDate() - 1); return date.toISOString(); }
    match = value.match(/^(?:(\d{4})[-/.年])?(\d{1,2})[-/.月](\d{1,2})日?\s+(\d{1,2}):(\d{2})$/);
    if (!match) return '';
    const date = new Date(now); date.setFullYear(match[1] ? Number(match[1]) : now.getFullYear(), Number(match[2]) - 1, Number(match[3])); date.setHours(Number(match[4]), Number(match[5]), 0, 0); if (!match[1] && date.getTime() > now.getTime() + 86_400_000) date.setFullYear(date.getFullYear() - 1); return date.toISOString();
  }
  function blocked(code, reason) { return { ok: false, code, reason }; }
  function stripSelected(value) { return { chatDigest: value.chatDigest, messageDigest: value.messageDigest, direction: value.direction, messageAt: value.messageAt, selectedUnread: value.selectedUnread, observedAt: new Date().toISOString() }; }
  function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  async function send(message) { try { return await chrome.runtime.sendMessage(message); } catch { return null; } }
})();
