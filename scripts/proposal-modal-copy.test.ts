/**
 * FILE: scripts/proposal-modal-copy.test.ts
 * НАЗНАЧЕНИЕ: тексты revert_conflict не обещают, что правки на диске нет.
 * ВХОД: разметка окна без браузера. Высоту зон здесь не меряем — она задана CSS.
 * ВЫХОД: честный статус для заблокированного отката и прежняя фраза для conflict.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { ProposalModal, type ProposalView } from '../apps/web/src/ui/proposal-modal.tsx'

const diff = '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-old\n+new\n'

function item(state: string, history: ProposalView['history']): ProposalView {
  return {
    id: 'pabc1234',
    project_id: 'demo-keys',
    bot_id: 'nora',
    task_id: null,
    summary: 'строка',
    state,
    why: state === 'revert_conflict' ? 'revert_conflict' : state,
    history,
    patch_sha256: 'a'.repeat(64),
    mode: 'files',
    branch: null,
    files: [{ path: 'note.txt', is_new: false }],
    diff,
  }
}

function html(view: ProposalView, notice: 'applied' | 'rejected' | 'reverted' | null = null): string {
  return renderToStaticMarkup(createElement(ProposalModal, {
    item: view,
    botName: 'Нора',
    ownerName: 'Ника',
    projectTitle: 'Demo',
    busy: false,
    waiting: false,
    notice,
    onClose: () => undefined,
    onApply: () => undefined,
    onReject: () => undefined,
    onRevert: () => undefined,
    onAsk: () => undefined,
    onWrite: () => undefined,
    canAsk: true,
  }))
}

test('revert_conflict говорит, что правка осталась, а откат нет', () => {
  const view = item('revert_conflict', [
    { state: 'proposed', at: '2026-11-21T12:00:00.000Z', by: 'nora', why: 'propose' },
    { state: 'applied', at: '2026-11-21T12:01:00.000Z', by: 'owner', why: 'apply' },
    { state: 'revert_conflict', at: '2026-11-21T12:02:00.000Z', by: 'owner', why: 'revert_conflict' },
  ])
  const text = html(view)
  expect(text).toContain('Не откатилось')
  expect(text).toContain('Правка применена и осталась в проекте — откат не выполнен')
  expect(text).toContain('Можно повторить откат или отклонить.')
  expect(text).toContain('Откат не выполнен.')
  expect(text).toContain('Правка осталась в проекте.')
  expect(text).not.toContain('ничего не записано')
  expect(text).not.toContain('Не применяется')
  expect(text).not.toContain('Проект не менялся')
  expect(text).not.toContain('ветк')
})

test('conflict по-прежнему говорит, что ничего не записано', () => {
  const view = item('conflict', [
    { state: 'proposed', at: '2026-11-21T12:00:00.000Z', by: 'nora', why: 'propose' },
    { state: 'conflict', at: '2026-11-21T12:01:00.000Z', by: 'owner', why: 'conflict' },
  ])
  const text = html(view)
  expect(text).toContain('Не применяется')
  expect(text).toContain('Проект изменился после предложения — ничего не записано')
  expect(text).not.toContain('Правка применена и осталась')
})

test('отклонение после отката не говорит, что проект не менялся', () => {
  const view = item('rejected', [
    { state: 'proposed', at: '2026-11-21T12:00:00.000Z', by: 'nora', why: 'propose' },
    { state: 'applied', at: '2026-11-21T12:01:00.000Z', by: 'owner', why: 'apply' },
    { state: 'revert_conflict', at: '2026-11-21T12:02:00.000Z', by: 'owner', why: 'revert_conflict' },
    { state: 'rejected', at: '2026-11-21T12:03:00.000Z', by: 'owner', why: 'reject' },
  ])
  const text = html(view, 'rejected')
  expect(text).toContain('Отклонено. Правка осталась в проекте.')
  expect(text).toContain('Отклонено · правка осталась')
  expect(text).toContain('Откат не выполнен. Применённая правка остаётся в проекте.')
  expect(text).not.toContain('Проект не менялся')
  expect(text).not.toContain('проект не менялся')
})

test('отклонение до применения по-прежнему говорит, что проект не менялся', () => {
  const view = item('rejected', [
    { state: 'proposed', at: '2026-11-21T12:00:00.000Z', by: 'nora', why: 'propose' },
    { state: 'rejected', at: '2026-11-21T12:01:00.000Z', by: 'owner', why: 'reject' },
  ])
  const text = html(view, 'rejected')
  expect(text).toContain('Отклонено. Проект не менялся.')
  expect(text).toContain('Отклонено · проект не менялся')
})
