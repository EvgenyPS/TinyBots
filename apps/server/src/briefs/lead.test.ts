/**
 * FILE: apps/server/src/briefs/lead.test.ts
 * НАЗНАЧЕНИЕ: B6. Четыре случая резолвера главного.
 * Пауза не переключается молча на главного проекта: иначе бриф ушёл бы не тому.
 */

import { expect, test } from 'vitest'
import { leadRefusal, resolveLead, type LeadBot } from './lead.js'

const ava: LeadBot = { id: 'lead1', name: 'Ава', paused: false, grok_id: 'demo-ava' }
const bit: LeadBot = { id: 'dev1', name: 'Бит', paused: false, grok_id: 'demo-bit' }
const hush: LeadBot = { id: 'hush1', name: 'Тишь', paused: true, grok_id: 'demo-hush' }

test('есть главный в чате — берём его, не главного проекта', () => {
  const lead = resolveLead({ bots: [ava, bit], chatLeadId: 'dev1', projectLeadId: 'lead1' })
  expect(lead).toEqual({ ok: true, bot: bit, via: 'chat' })
})

test('в чате главного нет, в проекте есть — берём главного проекта', () => {
  const lead = resolveLead({ bots: [ava, bit], chatLeadId: 'absent1', projectLeadId: 'lead1' })
  expect(lead).toEqual({ ok: true, bot: ava, via: 'project' })
})

test('главный чата на паузе — отказ, даже если главный проекта свободен', () => {
  const lead = resolveLead({ bots: [hush, bit], chatLeadId: 'hush1', projectLeadId: 'dev1' })
  expect(lead.ok).toBe(false)
  if (lead.ok) {
    return
  }
  expect(lead.reason).toBe('paused')
  expect(lead.who).toBe('Тишь')
  expect(leadRefusal(lead).hint).toBe('Выберите главного')
  expect(leadRefusal(lead).message).toContain('Тишь')
})

test('главного нет ни в чате, ни в проекте', () => {
  const lead = resolveLead({ bots: [bit], chatLeadId: null, projectLeadId: 'nobody1' })
  expect(lead.ok).toBe(false)
  if (lead.ok) {
    return
  }
  expect(lead.reason).toBe('missing')
  expect(leadRefusal(lead).message).toContain('не задан')
  expect(leadRefusal(lead).hint).toBe('Выберите главного')
})
