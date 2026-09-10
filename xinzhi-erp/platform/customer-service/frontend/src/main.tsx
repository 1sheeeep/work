import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./features/auth/NativeAuth.css";

class AppErrorBoundary extends React.Component<React.PropsWithChildren, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("Xzdesk page render failed", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="app-recovery-screen">
          <section className="app-recovery-card" role="alert">
            <strong>页面加载异常</strong>
            <p>请刷新页面后重试。已登录状态不会因此被清除。</p>
            <button type="button" className="primary" onClick={() => window.location.reload()}>刷新页面</button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
