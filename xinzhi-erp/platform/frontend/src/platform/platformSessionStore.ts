import type { StoredCredentials } from "../auth/types";

const PLATFORM_SESSION_STORAGE_KEY = "xz-erp.platform-admin.credentials";
let memoryCredentials: StoredCredentials | null = null;

export const platformSessionStore = {
  read(): StoredCredentials | null {
    if (memoryCredentials) return memoryCredentials;
    try {
      const stored = window.sessionStorage.getItem(
        PLATFORM_SESSION_STORAGE_KEY,
      );
      if (!stored) return null;
      const parsed = JSON.parse(stored) as StoredCredentials;
      if (
        typeof parsed.accessToken !== "string" ||
        parsed.tokenType !== "Bearer"
      )
        return null;
      memoryCredentials = parsed;
      return parsed;
    } catch {
      return null;
    }
  },
  write(credentials?: StoredCredentials) {
    memoryCredentials = credentials ?? null;
    try {
      if (credentials)
        window.sessionStorage.setItem(
          PLATFORM_SESSION_STORAGE_KEY,
          JSON.stringify(credentials),
        );
      else window.sessionStorage.removeItem(PLATFORM_SESSION_STORAGE_KEY);
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
