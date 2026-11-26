/**
 * FILE: apps/web/src/ui/bot-presets.ts
 * НАЗНАЧЕНИЕ: подстановка модели, имени ключа и base_url на шаге «Боты».
 * ВХОД: провайдер и пометки, правил ли человек поле руками.
 * ВЫХОД: следующее состояние полей. Адрес берётся из LLM_PRESET_BASE_URL.
 * Смена модели не трогает ключ и адрес. Смена провайдера пересчитывает только нетронутые поля.
 * Список моделей — подсказка интерфейса, в схему конфига он не входит.
 */

// Сборка подставляет объект из packages/schema. В браузер не попадает node:net из схемы.
import { LLM_PRESET_BASE_URL } from 'virtual:llm-preset-base-url'

/** Пункт «своя»: открывает ручной ввод и не совпадает ни с одним id модели. */
export const CUSTOM_MODEL = '__custom__'

/**
 * Готовые id для выпадающего списка.
 * Qwen — текстовые модели DashScope (Model Studio, страница обновлена 2026-11-25):
 * qwen4-max, qwen3.7-plus, qwen3.8-flash. Тот же id уходит в OpenAI-совместимый chat/completions.
 */
export const PROVIDER_MODELS: Record<string, readonly string[]> = {
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  qwen: ['qwen4-max', 'qwen3.7-plus', 'qwen3.8-flash'],
}

/** Имя переменной, под которым лаунчер хранит ключ. Само значение сюда не пишется. */
export const PROVIDER_KEY_ENV: Record<string, string> = {
  deepseek: 'DEEPSEEK_API_KEY',
  qwen: 'QWEN_API_KEY',
}

export type ProviderFields = {
  provider: string
  model: string
  modelCustom: boolean
  modelTouched: boolean
  baseUrl: string
  baseUrlTouched: boolean
  apiKeyEnv: string
  apiKeyEnvTouched: boolean
}

export function listedModels(provider: string): readonly string[] {
  return PROVIDER_MODELS[provider] ?? []
}

/** Официальный адрес из схемы. Своего второго списка адресов нет. */
export function presetBaseUrl(provider: string): string {
  if (provider === 'deepseek' || provider === 'qwen') {
    return LLM_PRESET_BASE_URL[provider]
  }
  return ''
}

export function presetKeyEnv(provider: string): string {
  return PROVIDER_KEY_ENV[provider] ?? ''
}

/**
 * Провайдер сменился.
 * Поле с modelTouched / baseUrlTouched / apiKeyEnvTouched остаётся как ввёл человек.
 */
export function applyProvider(fields: ProviderFields, provider: string): ProviderFields {
  const models = listedModels(provider)
  const next: ProviderFields = { ...fields, provider }
  if (!fields.modelTouched) {
    next.model = models[0] ?? ''
    next.modelCustom = models.length === 0
  }
  if (!fields.baseUrlTouched) {
    next.baseUrl = presetBaseUrl(provider)
  }
  if (!fields.apiKeyEnvTouched) {
    next.apiKeyEnv = presetKeyEnv(provider)
  }
  return next
}

/** Выбор из списка. Это уже решение человека: смена провайдера модель не подменит. */
export function selectListedModel(fields: ProviderFields, model: string): ProviderFields {
  return { ...fields, model, modelCustom: false, modelTouched: true }
}

/** «Своя» оставляет уже набранный текст, чтобы его можно было поправить. */
export function selectCustomModel(fields: ProviderFields): ProviderFields {
  return { ...fields, modelCustom: true, modelTouched: true }
}

export function editCustomModel(fields: ProviderFields, model: string): ProviderFields {
  return { ...fields, model, modelCustom: true, modelTouched: true }
}

export function editBaseUrl(fields: ProviderFields, baseUrl: string): ProviderFields {
  return { ...fields, baseUrl, baseUrlTouched: true }
}

export function editKeyEnv(fields: ProviderFields, apiKeyEnv: string): ProviderFields {
  return { ...fields, apiKeyEnv, apiKeyEnvTouched: true }
}

/** В списке нет такой модели — показываем ручной ввод, текст не стираем. */
export function modelSelectValue(fields: ProviderFields): string {
  const models = listedModels(fields.provider)
  if (fields.modelCustom || !models.includes(fields.model)) {
    return CUSTOM_MODEL
  }
  return fields.model
}

export function showCustomModel(fields: ProviderFields): boolean {
  return modelSelectValue(fields) === CUSTOM_MODEL
}
