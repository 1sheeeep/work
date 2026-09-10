import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import en from "./locales/en";
import zhCN from "./locales/zh-CN";

export type AppLocale = "zh-CN" | "en";
export type TranslationValues = Record<string, string | number>;

const LOCALE_STORAGE_KEY = "xz-erp.locale";
const catalogs: Record<AppLocale, Record<string, string>> = {
  "zh-CN": zhCN,
  en,
};

function normalizeLocale(value: string | null | undefined): AppLocale | null {
  const normalized = value?.trim().toLowerCase().replace("_", "-");
  if (!normalized) return null;
  if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  return null;
}

function initialLocale(): AppLocale {
  if (typeof window === "undefined") return "zh-CN";
  const queryLocale = normalizeLocale(new URLSearchParams(window.location.search).get("locale"));
  if (queryLocale) return queryLocale;
  try {
    const stored = normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
    if (stored) return stored;
  } catch {
    // A blocked preference store must not block the application.
  }
  return normalizeLocale(window.navigator.language) ?? "zh-CN";
}

function interpolate(template: string, values?: TranslationValues) {
  if (!values) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  );
}

type I18nContextValue = {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: (source: string, values?: TranslationValues) => string;
  formatDateTime: (value: string | Date) => string;
  formatNumber: (value: number) => string;
};

const fallbackContext: I18nContextValue = {
  locale: "zh-CN",
  setLocale: () => undefined,
  t: (source, values) => interpolate(source, values),
  formatDateTime: (value) => new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(typeof value === "string" ? new Date(value) : value),
  formatNumber: (value) => new Intl.NumberFormat("zh-CN").format(value),
};

const I18nContext = createContext<I18nContextValue>(fallbackContext);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<AppLocale>(initialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Local preference persistence is optional.
    }
  }, [locale]);

  const t = useCallback((source: string, values?: TranslationValues) => {
    const translated = catalogs[locale][source] ?? source;
    return interpolate(translated, values);
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => {
    const intlLocale = locale === "en" ? "en-US" : "zh-CN";
    const dateTimeFormatter = new Intl.DateTimeFormat(intlLocale, {
      dateStyle: "short",
      timeStyle: "short",
    });
    const numberFormatter = new Intl.NumberFormat(intlLocale);
    return {
      locale,
      setLocale,
      t,
      formatDateTime: (input) => dateTimeFormatter.format(
        typeof input === "string" ? new Date(input) : input,
      ),
      formatNumber: (input) => numberFormatter.format(input),
    };
  }, [locale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export function localeFromShopifyParameter(value: string | null | undefined) {
  return normalizeLocale(value);
}
