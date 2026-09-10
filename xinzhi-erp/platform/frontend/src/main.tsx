import "./shopify/nativeLinkEntry";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { PlatformAdminProvider } from "./platform/PlatformAdminContext";
import { I18nProvider } from "./i18n/I18nContext";
import { applyTheme, readSavedTheme } from "./theme";
import "./styles.css";
import "./erp-design-system.css";
import "./erp-theme.css";

document.title = "Xinzhi ERP";
applyTheme(readSavedTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <PlatformAdminProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </PlatformAdminProvider>
    </I18nProvider>
  </StrictMode>,
);
