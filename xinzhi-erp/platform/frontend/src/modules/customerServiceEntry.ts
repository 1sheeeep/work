import { ApiError, apiClient } from "../api/client";

export function usesNativeCustomerService() {
  return import.meta.env.VITE_CUSTOMER_SERVICE_ENTRY_MODE === "native";
}

const ENTRY_PATH = "/api/v1/auth/erp/entry";
const GRANT_FORMAT = /^[A-Za-z0-9_-]{43}$/;
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CustomerServiceEntryGrant = {
  grant: string;
  entryUrl: string;
  tenantId: string;
  userId: string;
  expiresAt: string;
};

export function resolveCustomerServiceEntryOrigin(
  rawURL: string | undefined,
) {
  const configured = rawURL?.trim();
  if (!configured) return null;

  try {
    const target = new URL(configured);
    if (target.username || target.password || target.search || target.hash) return null;
    if (target.pathname !== "/") return null;

    const developmentLoopback = import.meta.env.DEV && (
      target.hostname === "127.0.0.1"
      || target.hostname === "localhost"
      || target.hostname === "[::1]"
    );
    if (target.protocol !== "https:" && !(developmentLoopback && target.protocol === "http:")) {
      return null;
    }
    return target.origin;
  } catch {
    return null;
  }
}

export function customerServiceEntryOrigin() {
  return resolveCustomerServiceEntryOrigin(
    import.meta.env.VITE_CUSTOMER_SERVICE_WORKBENCH_URL,
  );
}

export function customerServiceEntryErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.message.includes("浏览器阻止")) {
    return error.message;
  }
  return "暂时无法打开客服工作台，请稍后重试。";
}

export async function issueCustomerServiceEntryGrant(targetOrigin: string) {
  const response = await apiClient.request<CustomerServiceEntryGrant>(
    usesNativeCustomerService() ? "/api/v1/customer-service/native-entry-grants" : "/api/v1/customer-service/entry-grants",
    { method: "POST", body: { targetOrigin } },
  );
  if (!isSafeGrant(response, targetOrigin)) {
    throw new ApiError("客服入口返回了无效的安全响应。", { status: 0 });
  }
  return response;
}

export type CustomerServiceEntryMode = "same-window" | "new-window";

export async function openCustomerServiceEntry(
  targetOrigin: string,
  mode: CustomerServiceEntryMode = "new-window",
) {
  if (usesNativeCustomerService()) {
    if (targetOrigin !== "https://kf.xzkj.ai") {
      throw new ApiError("客服入口返回了无效的安全响应。", { status: 0 });
    }
    // Continue through the short-lived single-use form exchange below. Only
    // the opaque entry grant crosses origins, never the ERP bearer/password.
  }
  const targetName = mode === "new-window"
    ? `xz-erp-customer-service-${crypto.randomUUID()}`
    : "_self";
  const popup = mode === "new-window" ? window.open("about:blank", targetName) : null;
  if (mode === "new-window" && !popup) {
    throw new ApiError("浏览器阻止了客服窗口，请允许此站点打开新窗口后重试。", { status: 0 });
  }
  if (popup) popup.opener = null;

  try {
    const entry = await issueCustomerServiceEntryGrant(targetOrigin);
    const form = document.createElement("form");
    form.method = "POST";
    form.action = entry.entryUrl;
    form.target = targetName;
    form.hidden = true;
    for (const [name, value] of Object.entries({
      grant: entry.grant,
      tenantId: entry.tenantId,
      userId: entry.userId,
    })) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.append(input);
    }
    document.body.append(form);
    form.submit();
    form.remove();
  } catch (error) {
    popup?.close();
    throw error;
  }
}

function isSafeGrant(value: CustomerServiceEntryGrant, targetOrigin: string) {
  if (!value || !GRANT_FORMAT.test(value.grant)
      || !UUID_FORMAT.test(value.tenantId) || !UUID_FORMAT.test(value.userId)
      || !Number.isFinite(Date.parse(value.expiresAt))) {
    return false;
  }
  try {
    const entry = new URL(value.entryUrl);
    return entry.origin === targetOrigin
      && entry.pathname === ENTRY_PATH
      && !entry.search && !entry.hash
      && !entry.username && !entry.password;
  } catch {
    return false;
  }
}
