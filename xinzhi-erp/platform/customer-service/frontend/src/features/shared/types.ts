export type ToastTone = "info" | "error" | "success";
export type ToastMessage = { tone: ToastTone; text: string };
export type Language = "zh" | "en";
export type ShopConfigMenuKey = "info" | "shopify" | "email";
export type T = Record<string, string>;
export type InstantAnswerConfig = {
  id: string;
  title: string;
  answer: string;
  mode: "text" | "order_tracking";
  enabled: boolean;
  sort: number;
};

export const DEFAULT_WIDGET_LANGUAGE = "auto";
export const INSTANT_ANSWERS_VERSION = "1";
export const DEFAULT_INSTANT_ANSWER: InstantAnswerConfig = {
  id: "track_order",
  title: "Track my order",
  answer: "Enter your order number and email address to see the latest order and tracking status.",
  mode: "order_tracking",
  enabled: true,
  sort: 0
};
export const SHOPIFY_STORE_ID_EXAMPLE = "1fop5n-fz";
