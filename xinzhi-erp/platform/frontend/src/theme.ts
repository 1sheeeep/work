export const ERP_THEMES = [
  { id: "oatmeal", name: "奶杏燕麦" },
  { id: "peach", name: "蜜桃奶油" },
  { id: "rose", name: "玫瑰奶茶" },
  { id: "vanilla", name: "香草焦糖" },
  { id: "slate", name: "瓷白石墨蓝" },
  { id: "teal", name: "暖白深青" },
  { id: "blue", name: "中性商务蓝" },
  { id: "graphite", name: "雾白石墨灰" },
  { id: "sage", name: "浅白鼠尾草绿" },
] as const;

export type ErpTheme = (typeof ERP_THEMES)[number]["id"];
export const THEME_STORAGE_KEY = "xz-erp.theme";
export const DEFAULT_THEME: ErpTheme = "slate";

export function normalizeTheme(value: string | null | undefined): ErpTheme {
  return ERP_THEMES.find(theme => theme.id === value)?.id ?? DEFAULT_THEME;
}

export function readSavedTheme(): ErpTheme {
  try {
    return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(theme: ErpTheme) {
  document.documentElement.dataset.erpTheme = normalizeTheme(theme);
}

export function currentTheme(): ErpTheme {
  return normalizeTheme(document.documentElement.dataset.erpTheme ?? readSavedTheme());
}

export function saveTheme(theme: ErpTheme): boolean {
  const safeTheme = normalizeTheme(theme);
  applyTheme(safeTheme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, safeTheme);
    return true;
  } catch {
    // Theme changes still work when browser preference storage is blocked.
    return false;
  }
}
