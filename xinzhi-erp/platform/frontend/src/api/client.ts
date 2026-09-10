const DEFAULT_TIMEOUT_MS = 15_000;

export type ApiErrorPayload = {
  code?: string;
  message?: string;
  details?: unknown;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string;
      details?: unknown;
      requestId?: string;
    },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.requestId = options.requestId;
  }
}

export type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  timeoutMs?: number;
  skipAuth?: boolean;
  skipUnauthorizedHandler?: boolean;
  /** Tenant is the safe default; platform requests can never borrow its token. */
  authScope?: "tenant" | "platform";
};

export type BlobRequestOptions = RequestOptions & {
  acceptedContentTypes?: readonly string[];
};

type AccessTokenProvider = () => string | null;
type UnauthorizedHandler = () => void;

class ApiClient {
  private accessTokenProviders: Record<
    "tenant" | "platform",
    AccessTokenProvider
  > = {
    tenant: () => null,
    platform: () => null,
  };
  private unauthorizedHandlers: Record<
    "tenant" | "platform",
    UnauthorizedHandler
  > = {
    tenant: () => undefined,
    platform: () => undefined,
  };

  setAccessTokenProvider(
    provider: AccessTokenProvider,
    scope: "tenant" | "platform" = "tenant",
  ) {
    this.accessTokenProviders[scope] = provider;
  }

  setUnauthorizedHandler(
    handler: UnauthorizedHandler,
    scope: "tenant" | "platform" = "tenant",
  ) {
    this.unauthorizedHandlers[scope] = handler;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const {
      body,
      headers: requestHeaders,
      signal: externalSignal,
      skipAuth = false,
      skipUnauthorizedHandler = false,
      authScope = "tenant",
      timeoutMs = DEFAULT_TIMEOUT_MS,
      ...requestInit
    } = options;
    const controller = new AbortController();
    const abortFromExternalSignal = () => controller.abort();

    if (externalSignal?.aborted) {
      throw new ApiError("请求已取消。", { status: 0 });
    }

    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    externalSignal?.addEventListener("abort", abortFromExternalSignal, {
      once: true,
    });

    const headers = new Headers(requestHeaders);
    headers.set("Accept", "application/json");
    if (!headers.has("Accept-Language")) {
      const locale = document.documentElement.lang;
      if (locale === "zh-CN" || locale === "en") {
        headers.set("Accept-Language", locale);
      }
    }
    if (body !== undefined && !(body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }

    const accessToken = skipAuth
      ? null
      : this.accessTokenProviders[authScope]();
    if (accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }

    try {
      const response = await fetch(path, {
        ...requestInit,
        body:
          body === undefined || body instanceof FormData
            ? body
            : JSON.stringify(body),
        credentials: "same-origin",
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await this.createError(response);
        if (response.status === 401 && !skipAuth && !skipUnauthorizedHandler) {
          this.unauthorizedHandlers[authScope]();
        }
        throw error;
      }

      if (response.status === 204) {
        return undefined as T;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        throw new ApiError("服务返回了无法识别的数据格式，请稍后重试。", {
          status: response.status,
          requestId: response.headers.get("x-request-id") ?? undefined,
        });
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        const message = externalSignal?.aborted
          ? "请求已取消。"
          : "请求超时，请检查网络后重试。";
        throw new ApiError(message, { status: 0 });
      }
      throw new ApiError("无法连接到服务，请检查网络后重试。", { status: 0 });
    } finally {
      window.clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromExternalSignal);
    }
  }

  async requestBlob(
    path: string,
    options: BlobRequestOptions = {},
  ): Promise<Blob> {
    const {
      body,
      acceptedContentTypes = ["image/jpeg", "image/png"],
      headers: requestHeaders,
      signal: externalSignal,
      skipAuth = false,
      skipUnauthorizedHandler = false,
      authScope = "tenant",
      timeoutMs = DEFAULT_TIMEOUT_MS,
      ...requestInit
    } = options;
    if (!acceptedContentTypes.length) {
      throw new ApiError("未配置可接受的文件格式。", { status: 0 });
    }
    const controller = new AbortController();
    const abortFromExternalSignal = () => controller.abort();
    if (externalSignal?.aborted) {
      throw new ApiError("请求已取消。", { status: 0 });
    }
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    externalSignal?.addEventListener("abort", abortFromExternalSignal, {
      once: true,
    });
    const headers = new Headers(requestHeaders);
    headers.set("Accept", acceptedContentTypes.join(", "));
    if (!headers.has("Accept-Language")) {
      const locale = document.documentElement.lang;
      if (locale === "zh-CN" || locale === "en") {
        headers.set("Accept-Language", locale);
      }
    }
    if (body !== undefined && !(body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }
    const accessToken = skipAuth ? null : this.accessTokenProviders[authScope]();
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    try {
      const response = await fetch(path, {
        ...requestInit,
        body:
          body === undefined || body instanceof FormData
            ? body
            : JSON.stringify(body),
        credentials: "same-origin",
        headers,
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = await this.createError(response);
        if (response.status === 401 && !skipAuth && !skipUnauthorizedHandler) {
          this.unauthorizedHandlers[authScope]();
        }
        throw error;
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!acceptedContentTypes.some((type) => contentType.includes(type))) {
        throw new ApiError("服务返回了无法识别的文件格式，请稍后重试。", {
          status: response.status,
          requestId: response.headers.get("x-request-id") ?? undefined,
        });
      }
      return response.blob();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ApiError(
          externalSignal?.aborted ? "请求已取消。" : "请求超时，请检查网络后重试。",
          { status: 0 },
        );
      }
      throw new ApiError("无法连接到服务，请检查网络后重试。", { status: 0 });
    } finally {
      window.clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromExternalSignal);
    }
  }

  private async createError(response: Response) {
    let payload: ApiErrorPayload = {};
    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      try {
        payload = (await response.json()) as ApiErrorPayload;
      } catch {
        payload = {};
      }
    }

    return new ApiError(
      payload.message ?? this.defaultMessageForStatus(response.status),
      {
        status: response.status,
        code: payload.code,
        details: payload.details,
        requestId: response.headers.get("x-request-id") ?? undefined,
      },
    );
  }

  private defaultMessageForStatus(status: number) {
    if (status === 400) return "提交的信息有误，请检查后重试。";
    if (status === 401) return "登录状态已失效，请重新登录。";
    if (status === 403) return "当前账号没有执行此操作的权限。";
    if (status === 404) return "请求的资源不存在。";
    if (status === 409) return "数据状态已变化，请刷新后重试。";
    if (status === 429) return "请求过于频繁，请稍后重试。";
    if (status >= 500) return "服务暂时不可用，请稍后重试。";
    return "请求失败，请稍后重试。";
  }
}

export const apiClient = new ApiClient();
