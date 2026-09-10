import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiError, apiClient } from "../api/client";
import { sessionStore } from "../auth/sessionStore";
import {
  httpPlatformAdminAdapter,
  type PlatformAdminAdapter,
} from "./platformAdminApi";
import { platformSessionStore } from "./platformSessionStore";
import type {
  PlatformAuthContextValue,
  PlatformLoginRequest,
  PlatformSession,
  PlatformStatus,
  TenantAccess,
} from "./types";

const PlatformAdminContext = createContext<PlatformAuthContextValue | null>(
  null,
);
export const TENANT_SESSION_CHANGED = "xz-erp:tenant-session-changed";

apiClient.setAccessTokenProvider(
  () => platformSessionStore.accessToken(),
  "platform",
);

export function PlatformAdminProvider({
  adapter = httpPlatformAdminAdapter,
  children,
}: PropsWithChildren<{ adapter?: PlatformAdminAdapter }>) {
  const [status, setStatus] = useState<PlatformStatus>("initializing");
  const [session, setSession] = useState<PlatformSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const operationVersion = useRef(0);

  const clearLocalSessions = useCallback(() => {
    platformSessionStore.clear();
    sessionStore.clear();
    window.dispatchEvent(new Event(TENANT_SESSION_CHANGED));
  }, []);

  const clearAuthentication = useCallback(() => {
    operationVersion.current += 1;
    clearLocalSessions();
    setSession(null);
    setError(null);
    setStatus("unauthenticated");
  }, [clearLocalSessions]);

  useEffect(() => {
    apiClient.setUnauthorizedHandler(clearAuthentication, "platform");
    return () => apiClient.setUnauthorizedHandler(() => undefined, "platform");
  }, [clearAuthentication]);

  const loadSession = useCallback(async () => {
    if (!platformSessionStore.accessToken()) {
      setSession(null);
      setStatus("unauthenticated");
      return;
    }
    const version = ++operationVersion.current;
    setStatus("initializing");
    setError(null);
    try {
      const nextSession = await adapter.getSession();
      if (version !== operationVersion.current) return;
      setSession(nextSession);
      setStatus("authenticated");
    } catch (reason) {
      if (version !== operationVersion.current) return;
      if (reason instanceof ApiError && reason.status === 401) {
        clearAuthentication();
        return;
      }
      setSession(null);
      setStatus("unavailable");
      setError("平台认证服务暂时不可用，请稍后重试。");
    }
  }, [adapter, clearAuthentication]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const login = useCallback(
    async (request: PlatformLoginRequest) => {
      const version = ++operationVersion.current;
      setError(null);
      const result = await adapter.login(request);
      if (version !== operationVersion.current) return;
      platformSessionStore.write(result.credentials);
      setSession(result.session);
      setStatus("authenticated");
    },
    [adapter],
  );

  const leaveTenant = useCallback(async () => {
    try {
      if (sessionStore.accessToken()) await adapter.logoutTenant();
    } finally {
      sessionStore.clear();
      window.dispatchEvent(new Event(TENANT_SESSION_CHANGED));
    }
  }, [adapter]);

  const logout = useCallback(async () => {
    const version = ++operationVersion.current;
    let platformError = false;
    if (sessionStore.accessToken()) {
      try {
        await adapter.logoutTenant();
      } catch {
        platformError = true;
      }
    }
    try {
      await adapter.logoutPlatform();
    } catch {
      platformError = true;
    }
    if (version !== operationVersion.current) return;
    clearLocalSessions();
    setSession(null);
    setStatus("unauthenticated");
    setError(
      platformError ? "已退出当前设备；会话状态同步失败，请稍后重新登录确认。" : null,
    );
  }, [adapter, clearLocalSessions]);

  const enterTenant = useCallback(
    async (tenantId: string): Promise<TenantAccess> => {
      const version = ++operationVersion.current;
      const access = await adapter.enterTenant(tenantId);
      if (version !== operationVersion.current)
        throw new ApiError("企业切换已被取消。", { status: 0 });
      sessionStore.write(access.credentials);
      window.dispatchEvent(new Event(TENANT_SESSION_CHANGED));
      return access;
    },
    [adapter],
  );

  const value = useMemo<PlatformAuthContextValue>(
    () => ({
      status,
      session,
      error,
      login,
      logout,
      retry: loadSession,
      enterTenant,
      leaveTenant,
    }),
    [
      enterTenant,
      error,
      leaveTenant,
      loadSession,
      login,
      logout,
      session,
      status,
    ],
  );

  return (
    <PlatformAdminContext.Provider value={value}>
      {children}
    </PlatformAdminContext.Provider>
  );
}

export function usePlatformAdmin() {
  const context = useContext(PlatformAdminContext);
  if (!context)
    throw new Error(
      "usePlatformAdmin must be used within PlatformAdminProvider",
    );
  return context;
}
