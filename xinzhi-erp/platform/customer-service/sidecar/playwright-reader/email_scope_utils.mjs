export function emailProviderFromTarget(url = "", title = "") {
  const haystack = `${url} ${title}`.toLowerCase();
  if (haystack.includes("outlook.live.com") || haystack.includes("outlook.office.com")) return "outlook";
  if (haystack.includes("mail.google.com")) return "gmail";
  if (haystack.includes("mail-client.cuiqiu.com") || haystack.includes("cuiqiu")) return "cuiqiu";
  if (haystack.includes("fastmo")) return "fastmo";
  return "";
}

export function shopEmailHints(shopName = "") {
  const text = String(shopName || "");
  const emails = [];
  for (const match of text.matchAll(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi)) {
    const email = match[0].toLowerCase();
    emails.push(email);
    const at = email.indexOf("@");
    const local = email.slice(0, at);
    const domain = email.slice(at + 1);
    const lastDash = local.lastIndexOf("-");
    if (lastDash >= 0 && lastDash < local.length - 1) {
      emails.push(`${local.slice(lastDash + 1)}@${domain}`);
    }
  }
  const normalized = normalizeScopeText(text);
  const parts = text
    .split(/[-_\s|/\\]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const aliases = new Set();
  for (const email of Array.from(new Set(emails))) {
    aliases.add(normalizeScopeText(email));
    aliases.add(normalizeScopeText(email.split("@")[0]));
  }
  for (const part of parts) {
    if (/@/.test(part)) continue;
    const alias = normalizeScopeText(part.split(".")[0] || part);
    if (alias.length >= 4 && !["shopify", "gmail", "outlook", "cuiqiu", "fastmo"].includes(alias)) aliases.add(alias);
  }
  if (normalized.length >= 4) aliases.add(normalized);
  return { emails: Array.from(new Set(emails)), aliases: Array.from(aliases).filter((item) => item.length >= 4) };
}

export function emailPageScore({ url = "", title = "" } = {}, shopName = "", options = {}) {
  const provider = emailProviderFromTarget(url, title);
  if (!provider) return { provider: "", score: 0, matched: [] };
  const haystackRaw = `${url} ${title}`.toLowerCase();
  const haystack = normalizeScopeText(haystackRaw);
  const manualEmail = normalizeEmail(options.mailAccount || "");
  const hints = manualEmail
    ? { emails: [manualEmail], aliases: [] }
    : shopEmailHints(shopName);
  const matched = [];
  let score = 10;
  for (const email of hints.emails) {
    if (haystackRaw.includes(email) || haystack.includes(normalizeScopeText(email))) {
      score += 100;
      matched.push(email);
    }
  }
  for (const alias of hints.aliases) {
    if (alias.length >= 4 && haystack.includes(alias)) {
      score += 25;
      matched.push(alias);
    }
  }
  return { provider, score, matched: Array.from(new Set(matched)) };
}

export function selectEmailTargetDescriptors(targets = [], shopName = "", options = {}) {
  const candidates = targets
    .map((target) => ({ ...target, ...emailPageScore(target, shopName, options) }))
    .filter((target) => target.provider);
  if (!candidates.length) return [];
  if (options.manual && normalizeEmail(options.mailAccount || "")) {
    return candidates
      .filter((target) => target.matched.includes(normalizeEmail(options.mailAccount || "")))
      .sort((a, b) => b.score - a.score || providerPriority(a.provider) - providerPriority(b.provider));
  }
  const bestScore = Math.max(...candidates.map((target) => target.score));
  const scoped = bestScore >= 35 ? candidates.filter((target) => target.score >= 35) : candidates;
  scoped.sort((a, b) => b.score - a.score || providerPriority(a.provider) - providerPriority(b.provider));
  return scoped;
}

function providerPriority(provider = "") {
  if (provider === "outlook") return 0;
  if (provider === "gmail") return 1;
  if (provider === "cuiqiu") return 2;
  if (provider === "fastmo") return 3;
  return 3;
}

function normalizeScopeText(value = "") {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeEmail(value = "") {
  const match = String(value || "").toLowerCase().match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i);
  return match ? match[0] : "";
}
