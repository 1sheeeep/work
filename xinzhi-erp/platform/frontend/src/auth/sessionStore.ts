import type { StoredCredentials } from "./types";

const SESSION_STORAGE_KEY = "xz-erp.auth.credentials";

let memoryCredentials: StoredCredentials | null = null;

function validCredentials(value: unknown): value is StoredCredentials {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const credentials = value as Record<string, unknown>;
  return (
    typeof credentials.accessToken === "string" &&
    credentials.accessToken.length > 0 &&
    credentials.accessToken.length <= 2048 &&
    credentials.tokenType === "Bearer"
  );
}

export const sessionStore = {
  read(): StoredCredentials | null {
    if (memoryCredentials) return memoryCredentials;
    try {
      const stored = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!stored) return null;
      const parsed = JSON.parse(stored) as unknown;
      if (!validCredentials(parsed)) {
        window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
        return null;
      }
      memoryCredentials = parsed;
      return parsed;
    } catch {
      try {
        window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      } catch {
        // Storage can be unavailable; no in-memory credential is retained.
      }
      return null;
    }
  },

  write(credentials?: StoredCredentials) {
    memoryCredentials = credentials ?? null;
    try {
      if (credentials)
        window.sessionStorage.setItem(
          SESSION_STORAGE_KEY,
          JSON.stringify(credentials),
        );
      else window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Current-page authentication remains available when storage is unavailable.
    }
  },

  clear() {
    this.write();
  },

  accessToken() {
    return this.read()?.accessToken ?? null;
  },
};
