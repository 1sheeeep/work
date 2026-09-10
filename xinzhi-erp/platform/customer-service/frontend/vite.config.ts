import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  const backendTarget = env.VITE_XZDESK_BACKEND || "http://127.0.0.1:8787";
  const backendProxy = {
    target: backendTarget,
    changeOrigin: true
  };

  return {
    plugins: [react()],
    clearScreen: false,
    server: {
      port: 5174,
      strictPort: true,
      proxy: {
        "/api": backendProxy,
        "/healthz": backendProxy,
        "/outlook": backendProxy,
        "/gmail": backendProxy,
        "/auth": backendProxy,
        "/shopify": backendProxy,
        "/webhooks": backendProxy,
        "/chat": backendProxy,
        "/ws": {
          ...backendProxy,
          ws: true
        }
      }
    }
  };
});
