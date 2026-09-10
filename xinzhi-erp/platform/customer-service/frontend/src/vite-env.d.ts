/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_XZDESK_BACKEND?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
