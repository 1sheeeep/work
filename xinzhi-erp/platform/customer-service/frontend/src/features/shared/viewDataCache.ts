type ViewDataCacheEntry = {
  value: unknown;
  updatedAt: number;
};

const caches = new WeakMap<object, Map<string, ViewDataCacheEntry>>();

export function readViewDataCache<T>(owner: object, key: string, maxAgeMs: number): T | null {
  const entry = caches.get(owner)?.get(key);
  if (!entry || Date.now() - entry.updatedAt > maxAgeMs) return null;
  return entry.value as T;
}

export function writeViewDataCache<T>(owner: object, key: string, value: T) {
  let cache = caches.get(owner);
  if (!cache) {
    cache = new Map<string, ViewDataCacheEntry>();
    caches.set(owner, cache);
  }
  cache.set(key, { value, updatedAt: Date.now() });
}

export function clearViewDataCache(owner: object, key: string) {
  caches.get(owner)?.delete(key);
}
