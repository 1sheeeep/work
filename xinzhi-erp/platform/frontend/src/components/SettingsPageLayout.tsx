import type { ReactNode } from "react";
import "./SettingsPageLayout.css";

type SettingsPageHeaderProps = {
  id: string;
  section: string;
  title: string;
  description: string;
  actions?: ReactNode;
};

export function SettingsPageHeader({
  id,
  section,
  title,
  description,
  actions,
}: SettingsPageHeaderProps) {
  return (
    <header className="settings-page-header">
      <div className="settings-page-header-copy">
        <p className="settings-page-section">{section}</p>
        <div>
          <h1 id={id}>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      {actions ? <div className="settings-page-header-actions">{actions}</div> : null}
    </header>
  );
}
