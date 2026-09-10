const BUSINESS_EMAIL_PATTERN =
  /^[a-z0-9._%+-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const E164_PHONE_PATTERN = /^\+[1-9][0-9]{7,14}$/;
const MAINLAND_CHINA_MOBILE_PATTERN = /^1[3-9][0-9]{9}$/;

export function normalizeBusinessEmail(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  const separator = normalized.indexOf("@");
  if (
    normalized.length < 3 ||
    normalized.length > 254 ||
    separator < 1 ||
    separator > 64 ||
    normalized.startsWith(".") ||
    normalized[separator - 1] === "." ||
    normalized.slice(0, separator).includes("..") ||
    !BUSINESS_EMAIL_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function normalizeLoginIdentifier(
  value: string,
): { email: string } | { username: string } {
  const trimmed = value.trim();
  const email = normalizeBusinessEmail(trimmed);
  const phoneNumber = normalizeLoginPhone(trimmed);
  return email
    ? { email }
    : { username: phoneNumber ?? trimmed };
}

export function isCanonicalOrLegacyIdentity(
  username: string,
  email?: string,
  phoneNumber?: string,
): boolean {
  const usernameAsEmail = normalizeBusinessEmail(username);
  if (email !== undefined) {
    return email === username && normalizeBusinessEmail(email) === email;
  }
  if (phoneNumber !== undefined) {
    return phoneNumber === username && normalizeE164Phone(phoneNumber) === phoneNumber;
  }
  return usernameAsEmail === null && normalizeE164Phone(username) !== username;
}

export function normalizeE164Phone(value: string): string | null | undefined {
  const normalized = value.trim();
  if (!normalized) return null;
  return E164_PHONE_PATTERN.test(normalized) ? normalized : undefined;
}

export function normalizeLoginPhone(value: string): string | null {
  const compact = value.trim().replace(/[ -]/g, "");
  if (!compact) return null;
  const e164 = MAINLAND_CHINA_MOBILE_PATTERN.test(compact)
    ? `+86${compact}`
    : compact;
  return E164_PHONE_PATTERN.test(e164) ? e164 : null;
}

export function displayLoginPhone(value: string): string {
  return /^\+861[3-9][0-9]{9}$/.test(value) ? value.slice(3) : value;
}
