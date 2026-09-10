import { useState } from "react";
import { Cable, LockKeyhole, Rocket } from "lucide-react";
import { SettingsPageHeader } from "../components/SettingsPageLayout";
import {
  LogisticsProviderConfigSection,
  ShopifyAppReleaseSection,
  ShopifyComplianceSection,
} from "./PlatformAdminConsolePage";

type OperatorSection = "release" | "privacy" | "providers";

const sections = [
  { id: "release", label: "应用发布", icon: Rocket },
  { id: "privacy", label: "隐私请求", icon: LockKeyhole },
  { id: "providers", label: "物流接口", icon: Cable },
] as const;

export function ErpOperatorConsolePage() {
  const [activeSection, setActiveSection] =
    useState<OperatorSection>("release");

  return (
    <main className="settings-page" aria-labelledby="erp-operator-title">
      <SettingsPageHeader
        id="erp-operator-title"
        section="系统设置"
        title="ERP 运维"
        description="维护 ERP 自有的应用发布、Shopify 隐私请求和物流商系统接口；仅 One 平台管理员进入企业后可用。"
      />

      <section className="warehouse-archive-card">
        <nav
          className="warehouse-archive-tabs"
          role="tablist"
          aria-label="ERP 运维功能"
        >
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                id={`erp-operator-tab-${section.id}`}
                type="button"
                role="tab"
                aria-selected={activeSection === section.id}
                aria-controls={`erp-operator-panel-${section.id}`}
                onClick={() => setActiveSection(section.id)}
              >
                <Icon size={16} aria-hidden="true" />
                {section.label}
              </button>
            );
          })}
        </nav>
      </section>

      <div
        id={`erp-operator-panel-${activeSection}`}
        role="tabpanel"
        aria-labelledby={`erp-operator-tab-${activeSection}`}
      >
        {activeSection === "release" && <ShopifyAppReleaseSection />}
        {activeSection === "privacy" && <ShopifyComplianceSection />}
        {activeSection === "providers" && <LogisticsProviderConfigSection />}
      </div>
    </main>
  );
}
