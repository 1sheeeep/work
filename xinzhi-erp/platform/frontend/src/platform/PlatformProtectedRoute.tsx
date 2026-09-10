import { LoaderCircle, RotateCcw } from "lucide-react";
import { Outlet } from "@tanstack/react-router";
import { usePlatformAdmin } from "./PlatformAdminContext";

export function PlatformProtectedRoute() {
  const { status, error, retry } = usePlatformAdmin();
  if (status === "initializing")
    return (
      <main className="full-page-state" aria-busy="true">
        <LoaderCircle className="spin" size={28} />
        <h1>正在确认平台管理员身份</h1>
      </main>
    );
  if (status === "unavailable")
    return (
      <main className="full-page-state" role="alert">
        <RotateCcw size={28} />
        <h1>暂时无法验证平台身份</h1>
        <p>{error}</p>
        <button className="button button-primary" onClick={() => void retry()}>
          重新连接
        </button>
      </main>
    );
  if (status !== "authenticated")
    return (
      <main className="full-page-state" aria-busy="true">
        <LoaderCircle className="spin" size={28} />
        <h1>正在返回平台管理员登录</h1>
      </main>
    );
  return <Outlet />;
}
