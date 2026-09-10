export const NATIVE_LINK_KEY = "xz-erp.shopify-native-link.v1";
export type PreparedShop = { shopId: string; shopDomain: string; shopName: string };
export type NativeLinkState = {
  proof: string;
  expiresAt: number;
  tenantId?: string;
  userId?: string;
  prepared?: PreparedShop;
};

const MAX_AGE_MS = 15 * 60 * 1000;
let expiryTimer: number | undefined;
function scheduleExpiration(expiresAt: number) {
  window.clearTimeout(expiryTimer);
  expiryTimer = window.setTimeout(clearNativeLink, Math.max(0, expiresAt - Date.now()));
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validProof(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value);
}
export function validPreparedShop(value: unknown): value is PreparedShop {
  if (!value || typeof value !== "object") return false;
  const shop = value as PreparedShop;
  return typeof shop.shopId === "string" && UUID.test(shop.shopId)
    && typeof shop.shopDomain === "string" && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(shop.shopDomain)
    && typeof shop.shopName === "string" && shop.shopName.length > 0 && shop.shopName.length <= 160;
}

export function clearNativeLink() {
  window.clearTimeout(expiryTimer);
  expiryTimer = undefined;
  try { sessionStorage.removeItem(NATIVE_LINK_KEY); } catch { /* No alternate persistent store. */ }
}
export function readNativeLink(): NativeLinkState | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(NATIVE_LINK_KEY) ?? "null") as NativeLinkState | null;
    if (!value || !validProof(value.proof) || !Number.isFinite(value.expiresAt)
      || value.expiresAt <= Date.now() || value.expiresAt > Date.now() + MAX_AGE_MS
      || (value.tenantId !== undefined && (!UUID.test(value.tenantId) || !UUID.test(value.userId ?? "")))
      || (value.userId !== undefined && !value.tenantId)
      || (value.prepared !== undefined && (!value.tenantId || !validPreparedShop(value.prepared)))) {
      clearNativeLink();
      return null;
    }
    scheduleExpiration(value.expiresAt);
    return value;
  } catch { clearNativeLink(); return null; }
}
export function saveNativeLink(value: NativeLinkState) {
  sessionStorage.setItem(NATIVE_LINK_KEY, JSON.stringify(value));
  if (sessionStorage.getItem(NATIVE_LINK_KEY) !== JSON.stringify(value)) throw new Error("Link storage unavailable");
  scheduleExpiration(value.expiresAt);
}

// Imported before the router is constructed: a proof must never enter the login
// redirect, HTTP query, referrer, localStorage or the router's location history.
export function captureNativeLink() {
  if (window.location.pathname !== "/shopify/link") return;
  const fragment = window.location.hash;
  const query = window.location.search;
  window.history.replaceState(window.history.state, "", "/shopify/link");
  if (!fragment && !query) return;
  clearNativeLink();
  const params = new URLSearchParams(fragment.slice(1));
  const proof = params.get("proof");
  if (query || params.size !== 1 || !validProof(proof)) return;
  try { saveNativeLink({ proof, expiresAt: Date.now() + MAX_AGE_MS }); } catch { clearNativeLink(); }
}
