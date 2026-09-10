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
import { httpAuthAdapter, type AuthAdapter } from "./authApi";
import { sessionStore } from "./sessionStore";
import { TENANT_SESSION_CHANGED } from "../platform/PlatformAdminContext";
import type {
  AuthContextValue,
  AuthSession,
  AuthStatus,
  LoginRequest,
} from "./types";

const AuthContext = createContext<AuthContextValue | null>(null);

apiClient.setAccessTokenProvider(() => sessionStore.accessToken());

type AuthProviderProps = PropsWithChildren<{
  adapter?: AuthAdapter;
}>;

export function AuthProvider({
  adapter = httpAuthAdapter,
  children,
}: AuthProviderProps) {
  const [status, setStatus] = useState<AuthStatus>("initializing");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const operationVersion = useRef(0);

  const clearAuthentication = useCallback(() => {
    operationVersion.current += 1;
    sessionStore.clear();
    setSession(null);
    setError(null);
    setStatus("unauthenticated");
  }, []);

  useEffect(() => {
    apiClient.setUnauthorizedHandler(clearAuthentication);

    return () => apiClient.setUnauthorizedHandler(() => undefined);
  }, [clearAuthentication]);

  const loadSession = useCallback(async () => {
    const version = operationVersion.current + 1;
    operationVersion.current = version;
    setStatus("initializing");
    setError(null);

    try {
      const response = await adapter.getSession();
      if (version !== operationVersion.current) return;
      setSession(response.session);
      setStatus("authenticated");
    } catch (sessionError) {
      if (version !== operationVersion.current) return;
      if (sessionError instanceof ApiError && sessionError.status === 401) {
        clearAuthentication();
        return;
      }

      setSession(null);
      setStatus("unavailable");
      setError("认证服务暂时不可用，请稍后重试。");
    }
  }, [adapter, clearAuthentication]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    const reload = () => {
      void loadSession();
    };
    window.addEventListener(TENANT_SESSION_CHANGED, reload);
    return () => window.removeEventListener(TENANT_SESSION_CHANGED, reload);
  }, [loadSession]);

  const login = useCallback(
    async (request: LoginRequest) => {
      const version = operationVersion.current + 1;
      operationVersion.current = version;
      setError(null);
      const response = await adapter.login(request);
      if (version !== operationVersion.current) return;
      sessionStore.write(response.credentials);
      setSession(response.session);
      setStatus("authenticated");
    },
    [adapter],
  );

  const logout = useCallback(async () => {
    const version = operationVersion.current + 1;
    operationVersion.current = version;
    try {
      await adapter.logout();
    } catch {
      // Local credentials must still be removed if the server session is already gone.
    } finally {
      if (version === operationVersion.current) {
        clearAuthentication();
      }
    }
  }, [adapter, clearAuthentication]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      currentTenant: session?.tenant ?? null,
      currentUser: session?.user ?? session?.platformAdmin ?? null,
      error,
      login,
      logout,
      retry: loadSession,
      hasPermission: (permission) =>
        session?.permissions.includes(permission) ?? false,
      hasApplication: (applicationCode) =>
        session?.applications?.some(
          (application) => application.code === applicationCode,
        ) ?? false,
      hasApplicationModule: (applicationCode, moduleCode) =>
        session?.applications?.some(
          (application) =>
            application.code === applicationCode &&
            application.modules.includes(moduleCode),
        ) ?? false,
    }),
    [error, loadSession, login, logout, session, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
