/**
 * FILE: apps/web/src/ui/bot-presets.test.ts
 * НАЗНАЧЕНИЕ: автоподстановка своего бота в мастере.
 * Смена провайдера, пункт «своя» и ручная правка, которую нельзя затереть.
 */

import { LLM_PRESET_BASE_URL } from '@tinybots/schema'
import { expect, test } from 'vitest'
import {
  CUSTOM_MODEL,
  applyProvider,
  editBaseUrl,
  editCustomModel,
  editKeyEnv,
  listedModels,
  modelSelectValue,
  presetBaseUrl,
  selectCustomModel,
  selectListedModel,
  showCustomModel,
  type ProviderFields,
} from './bot-presets.js'

function fresh(provider: string): ProviderFields {
  return applyProvider({
    provider,
    model: '',
    modelCustom: false,
    modelTouched: false,
    baseUrl: '',
    baseUrlTouched: false,
    apiKeyEnv: '',
    apiKeyEnvTouched: false,
  }, provider)
}

test('адреса берутся из пресета схемы, своего списка нет', () => {
  expect(presetBaseUrl('deepseek')).toBe(LLM_PRESET_BASE_URL.deepseek)
  expect(presetBaseUrl('qwen')).toBe(LLM_PRESET_BASE_URL.qwen)
  expect(presetBaseUrl('other')).toBe('')
})

test('смена провайдера заполняет модель, имя ключа и base_url', () => {
  const deepseek = fresh('deepseek')
  expect(deepseek.model).toBe('deepseek-chat')
  expect(deepseek.apiKeyEnv).toBe('DEEPSEEK_API_KEY')
  expect(deepseek.baseUrl).toBe(LLM_PRESET_BASE_URL.deepseek)
  expect(modelSelectValue(deepseek)).toBe('deepseek-chat')

  const qwen = applyProvider(deepseek, 'qwen')
  expect(qwen.model).toBe('qwen4-max')
  expect(listedModels('qwen')).toEqual(['qwen4-max', 'qwen3.7-plus', 'qwen3.8-flash'])
  expect(qwen.apiKeyEnv).toBe('QWEN_API_KEY')
  expect(qwen.baseUrl).toBe(LLM_PRESET_BASE_URL.qwen)
  expect(qwen.modelTouched).toBe(false)
})

test('пункт «своя» оставляет набранную модель', () => {
  const custom = editCustomModel(selectCustomModel(fresh('deepseek')), 'my-model')
  expect(showCustomModel(custom)).toBe(true)
  expect(modelSelectValue(custom)).toBe(CUSTOM_MODEL)
  expect(custom.model).toBe('my-model')

  const switched = applyProvider(custom, 'qwen')
  expect(switched.model).toBe('my-model')
  expect(switched.modelCustom).toBe(true)
  expect(switched.apiKeyEnv).toBe('QWEN_API_KEY')
  expect(switched.baseUrl).toBe(LLM_PRESET_BASE_URL.qwen)
})

test('ручная правка не затирается сменой модели и чужого провайдера', () => {
  let fields = fresh('deepseek')
  fields = editBaseUrl(fields, 'https://model.example/v1')
  fields = editKeyEnv(fields, 'MY_BOT_API_KEY')
  fields = selectListedModel(fields, 'deepseek-reasoner')
  expect(fields.baseUrl).toBe('https://model.example/v1')
  expect(fields.apiKeyEnv).toBe('MY_BOT_API_KEY')
  expect(fields.model).toBe('deepseek-reasoner')

  fields = editCustomModel(fields, 'my-model')
  expect(fields.baseUrl).toBe('https://model.example/v1')
  expect(fields.apiKeyEnv).toBe('MY_BOT_API_KEY')

  const switched = applyProvider(fields, 'qwen')
  expect(switched.model).toBe('my-model')
  expect(switched.baseUrl).toBe('https://model.example/v1')
  expect(switched.apiKeyEnv).toBe('MY_BOT_API_KEY')
  expect(showCustomModel(switched)).toBe(true)
})

test('нетронутый адрес обновляется, тронутая модель остаётся', () => {
  let fields = selectListedModel(fresh('deepseek'), 'deepseek-reasoner')
  fields = applyProvider(fields, 'qwen')
  expect(fields.model).toBe('deepseek-reasoner')
  expect(fields.baseUrl).toBe(LLM_PRESET_BASE_URL.qwen)
  expect(fields.apiKeyEnv).toBe('QWEN_API_KEY')
  expect(showCustomModel(fields)).toBe(true)
})

test('провайдер без пресета очищает только нетронутые поля', () => {
  const cleared = applyProvider(fresh('deepseek'), 'other')
  expect(cleared.model).toBe('')
  expect(cleared.modelCustom).toBe(true)
  expect(cleared.apiKeyEnv).toBe('')
  expect(cleared.baseUrl).toBe('')

  const kept = applyProvider(editKeyEnv(fresh('qwen'), 'QWEN_API_KEY'), 'other')
  expect(kept.apiKeyEnv).toBe('QWEN_API_KEY')
  expect(kept.baseUrl).toBe('')
})
