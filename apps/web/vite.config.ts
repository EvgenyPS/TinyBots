import tailwind from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { LLM_PRESET_BASE_URL } from '../../packages/schema/src/config.ts'

const webRoot = path.dirname(fileURLToPath(import.meta.url))

/**
 * В браузер кладём только два официальных адреса.
 * Пакет схемы целиком тянет node:net, его в страницу нельзя.
 * Источник тот же: LLM_PRESET_BASE_URL, второй список в репозитории не хранится.
 */
function llmPresetBaseUrl(): Plugin {
  const virtual = '\0virtual:llm-preset-base-url'
  return {
    name: 'llm-preset-base-url',
    resolveId(source) {
      if (source === 'virtual:llm-preset-base-url') {
        return virtual
      }
      return undefined
    },
    load(id) {
      if (id !== virtual) {
        return undefined
      }
      return `export const LLM_PRESET_BASE_URL = ${JSON.stringify(LLM_PRESET_BASE_URL)}\n`
    },
  }
}

// Dev-сервер тоже только на loopback: флаг --host без адреса открыл бы все интерфейсы.
export default defineConfig({
  plugins: [react(), tailwind(), llmPresetBaseUrl()],
  resolve: {
    alias: { '@': path.join(webRoot, 'src') },
  },
  server: {
    host: '127.0.0.1',
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
  },
})
