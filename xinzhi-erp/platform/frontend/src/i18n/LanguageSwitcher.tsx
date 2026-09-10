import { useI18n } from "./I18nContext";

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  const nextLocale = locale === "en" ? "zh-CN" : "en";
  const label = locale === "en" ? t("切换至中文") : t("切换至英文");

  return (
    <button
      className={`language-switcher ${className}`.trim()}
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setLocale(nextLocale)}
    >
      <span>{locale === "en" ? "中文" : "EN"}</span>
    </button>
  );
}
