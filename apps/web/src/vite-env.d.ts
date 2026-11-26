/// <reference types="vite/client" />

/** Адрес пресета. Значение при сборке берётся из LLM_PRESET_BASE_URL схемы. */
declare module 'virtual:llm-preset-base-url' {
  export const LLM_PRESET_BASE_URL: {
    readonly deepseek: string
    readonly qwen: string
  }
}
