import { useState } from "react";
import { Palette } from "lucide-react";
import { useI18n } from "../i18n/I18nContext";
import { currentTheme, ERP_THEMES, normalizeTheme, saveTheme } from "../theme";

export function ThemeSwitcher() {
  const { t } = useI18n();
  const [theme, setTheme] = useState(currentTheme);
  const [saved, setSaved] = useState(true);

  return (
    <div className="erp-theme-preference">
      <label className="erp-theme-label" htmlFor="erp-theme-select">
        <Palette size={16} aria-hidden="true" />{t("界面主题")}
        <span className="erp-theme-swatches" aria-hidden="true"><i /><i /><i /></span>
      </label>
      <select id="erp-theme-select" value={theme} aria-describedby="erp-theme-help" onChange={event => {
        const next = normalizeTheme(event.target.value);
        setSaved(saveTheme(next));
        setTheme(next);
      }}>
        {ERP_THEMES.map(item => <option key={item.id} value={item.id}>{t(item.name)}</option>)}
      </select>
      <small id="erp-theme-help" role="status">
        {t(saved ? "仅保存在当前浏览器，切换立即生效" : "已应用；浏览器禁止保存，刷新后可能恢复默认")}
      </small>
    </div>
  );
}
