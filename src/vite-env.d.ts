/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CSP_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.css'
