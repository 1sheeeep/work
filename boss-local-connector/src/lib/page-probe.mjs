import puppeteer from 'puppeteer-core';

const RISK_URL = /\/web\/(?:common\/(?:403|nonsupport)\.html|user\/safe\/verify|passport\/)/i;
const CHAT_URL = /\/web\/chat\/(?:index|user-center)(?:[/?#]|$)/i;

export function classifyPageFacts(facts) {
  if (!facts?.url) return paused('PAGE_NOT_FOUND', '未找到 BOSS 页面，已暂停。');
  if (!isBossUrl(facts.url)) return paused('NOT_BOSS_PAGE', '当前 Chrome Profile 未打开 BOSS 页面，已暂停。');
  if (RISK_URL.test(facts.url) || facts.hasRiskNotice) {
    return paused('RISK_OR_VERIFICATION', '检测到 BOSS 风险提示或验证页面，等待 HR 手动处理。');
  }
  if (facts.hasLoginNotice) {
    return paused('LOGIN_REQUIRED', 'BOSS 登录已失效或尚未完成，请由 HR 手动登录。');
  }
  if (!CHAT_URL.test(new URL(facts.url).pathname)) {
    return paused('NOT_CHAT_PAGE', '已登录 BOSS，但当前不在沟通页面；不会自动跳转。');
  }
  if (!facts.bodyReady) {
    return paused('PAGE_LOADING', 'BOSS 沟通页面仍在加载，已暂停等待。');
  }
  return paused('CHAT_PAGE_READY', 'BOSS 沟通页已就绪，等待实页只监测适配确认。');
}

export async function inspectAccountPage(cdpPort) {
  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${cdpPort}`, defaultViewport: null });
    const pages = (await browser.pages()).filter((page) => !page.isClosed());
    const page = pages.find((item) => isBossUrl(item.url())) ?? pages.find((item) => item.url() !== 'about:blank');
    if (!page) return paused('PAGE_NOT_FOUND', '未找到 BOSS 页面，已暂停。');
    const facts = await page.evaluate(() => {
      const text = document.body?.innerText ?? '';
      const hasAny = (terms) => terms.some((term) => text.includes(term));
      return {
        url: window.location.href,
        bodyReady: text.trim().length > 0,
        hasLoginNotice: hasAny(['扫码登录', '账号登录', '登录BOSS直聘', '请先登录']),
        hasRiskNotice: hasAny(['安全验证', '账号异常', '风险验证', '滑动验证', '访问受限']),
      };
    });
    return classifyPageFacts(facts);
  } catch {
    return paused('CDP_UNAVAILABLE', '无法建立本地 CDP 只读连接，已暂停。');
  } finally {
    await browser?.disconnect().catch(() => {});
  }
}

function isBossUrl(value) {
  try {
    return new URL(value).hostname.endsWith('zhipin.com');
  } catch {
    return false;
  }
}

function paused(code, reason) {
  return { runtimeState: 'PAUSED', code, reason };
}
