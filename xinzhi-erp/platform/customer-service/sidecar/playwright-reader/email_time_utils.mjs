const dayNames = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6
};

const monthNames = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12
};

export function parseEmailReceivedAt(value = "", nowValue = new Date()) {
  const now = new Date(nowValue);
  const text = normalize(value);
  if (!text || Number.isNaN(now.getTime())) return "";

  const chineseMonthDayTime = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?(?:[^\d]{0,8}(\d{1,2}):(\d{2}))?/);
  if (chineseMonthDayTime) {
    return dateForMonthDay(now, Number(chineseMonthDayTime[1]), Number(chineseMonthDayTime[2]), chineseMonthDayTime[3], chineseMonthDayTime[4]);
  }

  const chineseDash = text.match(/(?:周|星期)[一二三四五六日天]?\s*(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (chineseDash) {
    return dateForMonthDay(now, Number(chineseDash[1]), Number(chineseDash[2]), chineseDash[3], chineseDash[4]);
  }

  const monthNameDate = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?:\s+(?:at\s+)?)?(?:(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?\b/i);
  if (monthNameDate) {
    const month = monthNames[monthNameDate[1].toLowerCase().replace(/\.$/, "")];
    const hour = hour24(monthNameDate[4], monthNameDate[6]);
    const minute = monthNameDate[5] || "";
    if (monthNameDate[3]) {
      return isoLocal(Number(monthNameDate[3]), month, Number(monthNameDate[2]), hour, minute);
    }
    return dateForMonthDay(now, month, Number(monthNameDate[2]), hour, minute);
  }

  const englishDayDate = text.match(/\b(?:sun|mon|tue|wed|thu|fri|sat)(?:day)?\s+(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/i);
  if (englishDayDate) {
    return dateForMonthDay(now, Number(englishDayDate[1]), Number(englishDayDate[2]), englishDayDate[3], englishDayDate[4]);
  }

  const slashDate = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s+(\d{1,2}):(\d{2}))?\b/);
  if (slashDate) {
    const year = slashDate[3] ? normalizeYear(Number(slashDate[3])) : now.getFullYear();
    return isoLocal(year, Number(slashDate[1]), Number(slashDate[2]), slashDate[4], slashDate[5]);
  }

  const relative = relativeDayOffset(text);
  const timeMatch = text.match(/\b(\d{1,2}):(\d{2})\b/);
  const chineseWeekdayTime = text.match(/(?:周|星期)([一二三四五六日天])\s*(\d{1,2}):(\d{2})/);
  if (chineseWeekdayTime) {
    const target = chineseWeekdayIndex(chineseWeekdayTime[1]);
    if (target !== null) {
      const base = startOfLocalDay(addDays(now, -daysBackToWeekday(now.getDay(), target)));
      base.setHours(Number(chineseWeekdayTime[2]), Number(chineseWeekdayTime[3]), 0, 0);
      return base.toISOString();
    }
  }
  const englishWeekdayTime = text.match(/\b(sun|mon|tue|wed|thu|fri|sat)(?:day)?\s+(\d{1,2}):(\d{2})\b/i);
  if (englishWeekdayTime) {
    const target = dayNames[englishWeekdayTime[1].toLowerCase()];
    const base = startOfLocalDay(addDays(now, -daysBackToWeekday(now.getDay(), target)));
    base.setHours(Number(englishWeekdayTime[2]), Number(englishWeekdayTime[3]), 0, 0);
    return base.toISOString();
  }
  if (relative !== null) {
    const base = startOfLocalDay(addDays(now, relative));
    if (timeMatch) {
      base.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
    }
    return base.toISOString();
  }
  if (timeMatch) {
    const candidate = new Date(now);
    candidate.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
    if (candidate.getTime() > now.getTime() + 5 * 60 * 1000) {
      candidate.setDate(candidate.getDate() - 1);
    }
    return candidate.toISOString();
  }

  const weekday = text.match(/\b(sun|mon|tue|wed|thu|fri|sat)(?:day)?\b/i)?.[1]?.toLowerCase();
  if (weekday) {
    const target = dayNames[weekday];
    const delta = daysBackToWeekday(now.getDay(), target);
    return startOfLocalDay(addDays(now, -delta)).toISOString();
  }

  return "";
}

export function isEmailRowWithinCutoff(row = {}, cutoffISO = "", nowValue = new Date()) {
  if (!cutoffISO) return { keep: true, receivedAt: "" };
  const cutoff = new Date(cutoffISO);
  if (Number.isNaN(cutoff.getTime())) return { keep: true, receivedAt: "" };
  const receivedAt = parseEmailRowReceivedAt(row, nowValue);
  if (!receivedAt) return { keep: true, receivedAt: "" };
  return { keep: new Date(receivedAt).getTime() >= cutoff.getTime(), receivedAt };
}

export function parseEmailRowReceivedAt(row = {}, nowValue = new Date()) {
  const explicit = String(row.receivedAt || "").trim();
  if (explicit) return explicit;

  const lastSeen = parseEmailReceivedAt(row.lastSeen || "", nowValue);
  if (lastSeen) return lastSeen;

  const candidates = [
    ...(Array.isArray(row.lines) ? row.lines : []),
    row.subject,
    row.snippet
  ];
  for (const candidate of candidates) {
    const parsed = parseEmailReceivedAt(candidate, nowValue);
    if (parsed) return parsed;
  }
  return "";
}

export function shouldStopEmailScanAtRow(row = {}, cutoffISO = "", provider = "", nowValue = new Date()) {
  if (String(provider || "").toLowerCase() !== "outlook") return false;
  const result = isEmailRowWithinCutoff(row, cutoffISO, nowValue);
  return Boolean(result.receivedAt && !result.keep);
}

function normalize(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function dateForMonthDay(now, month, day, hour = "", minute = "") {
  let year = now.getFullYear();
  let candidate = localDate(year, month, day, hour, minute);
  if (candidate.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
    year -= 1;
    candidate = localDate(year, month, day, hour, minute);
  }
  return candidate.toISOString();
}

function isoLocal(year, month, day, hour = "", minute = "") {
  return localDate(year, month, day, hour, minute).toISOString();
}

function localDate(year, month, day, hour = "", minute = "") {
  return new Date(year, Math.max(0, month - 1), day, hour === "" ? 0 : Number(hour), minute === "" ? 0 : Number(minute), 0, 0);
}

function hour24(hour = "", suffix = "") {
  if (hour === "") return "";
  let value = Number(hour);
  const marker = String(suffix || "").toLowerCase();
  if (marker === "pm" && value < 12) value += 12;
  if (marker === "am" && value === 12) value = 0;
  return String(value);
}

function normalizeYear(year) {
  if (year < 100) return 2000 + year;
  return year;
}

function relativeDayOffset(text) {
  if (/today|今天/i.test(text)) return 0;
  if (/yesterday|昨天/i.test(text)) return -1;
  if (/前天/i.test(text)) return -2;
  const daysAgo = text.match(/(\d+)\s*(?:d|day|days|天)\s*(?:ago|前)?/i);
  if (daysAgo) return -Number(daysAgo[1]);
  return null;
}

function chineseWeekdayIndex(value = "") {
  if (value === "日" || value === "天") return 0;
  if (value === "一") return 1;
  if (value === "二") return 2;
  if (value === "三") return 3;
  if (value === "四") return 4;
  if (value === "五") return 5;
  if (value === "六") return 6;
  return null;
}

function startOfLocalDay(value) {
  const out = new Date(value);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(value, days) {
  const out = new Date(value);
  out.setDate(out.getDate() + days);
  return out;
}

function daysBackToWeekday(current, target) {
  const delta = (current - target + 7) % 7;
  return delta === 0 ? 0 : delta;
}
