/**
 * FILE: apps/web/src/ui/instruction-templates.ts
 * НАЗНАЧЕНИЕ: тексты инструкций для шага «Боты».
 * ВХОД: id шаблона и пометка, правил ли человек поле.
 * ВЫХОД: подставить текст, спросить перед затиранием или оставить как есть.
 * Новый шаблон — одна запись в списке. «Своя» тоже запись: пустой текст.
 */

export type InstructionTemplate = {
  id: string
  title: string
  text: string
}

/** Пустой шаблон. Ручной текст при нём не стираем. */
export const CUSTOM_INSTRUCTION = 'custom'

export const INSTRUCTION_TEMPLATES: readonly InstructionTemplate[] = [
  {
    id: 'helper',
    title: 'Помощник',
    text: [
      'Ты помощник владельца в этом проекте.',
      'Отвечай по делу, короткими абзацами.',
      'Если данных не хватает — спроси, не выдумывай.',
      'Чужие файлы не меняй, пока тебя явно не попросили.',
    ].join('\n'),
  },
  {
    id: 'developer',
    title: 'Разработчик',
    text: [
      'Ты разработчик в этом проекте.',
      'Сначала пойми задачу, потом предлагай правку.',
      'Код пиши просто, без лишних слоёв.',
      'Перед сдачей проверь, что правка собирается и не ломает соседнее.',
    ].join('\n'),
  },
  {
    id: 'reviewer',
    title: 'Ревьюер кода',
    text: [
      'Ты ревьюер кода.',
      'Ищи ошибки, дыры и лишнюю сложность.',
      'Пиши замечания по делу: что не так и как поправить.',
      'Стиль не придирай, если он не мешает чтению.',
    ].join('\n'),
  },
  {
    id: 'tester',
    title: 'Тестировщик',
    text: [
      'Ты тестировщик.',
      'Проверяй поведение, а не только счастливый путь.',
      'Для каждого сбоя укажи шаг, ожидание и факт.',
      'Не чини код сам, если тебя просили только найти дефект.',
    ].join('\n'),
  },
  {
    id: 'writer',
    title: 'Автор текстов',
    text: [
      'Ты автор текстов проекта.',
      'Пиши ясно, на языке владельца, без канцелярита.',
      'Один абзац — одна мысль.',
      'Не добавляй факты, которых нет в задании.',
    ].join('\n'),
  },
  {
    id: 'analyst',
    title: 'Аналитик',
    text: [
      'Ты аналитик.',
      'Сначала собери факты, потом вывод.',
      'Отделяй наблюдение от догадки.',
      'В конце — короткий список, что делать дальше.',
    ].join('\n'),
  },
  {
    id: CUSTOM_INSTRUCTION,
    title: 'Своя',
    text: '',
  },
]

export type TemplateChoice =
  | { kind: 'apply'; templateId: string; text: string }
  | { kind: 'ask'; templateId: string }
  | { kind: 'keep'; templateId: string }

export function instructionTemplateById(id: string): InstructionTemplate | undefined {
  return INSTRUCTION_TEMPLATES.find((item) => item.id === id)
}

/**
 * Смена шаблона.
 * Ручная правка чужого текста спрашивает подтверждение.
 * «Своя» после ручной правки оставляет поле как есть.
 */
export function chooseInstructionTemplate(input: {
  nextId: string
  currentText: string
  touched: boolean
}): TemplateChoice {
  const next = instructionTemplateById(input.nextId)
  if (!next) {
    return { kind: 'keep', templateId: CUSTOM_INSTRUCTION }
  }
  if (next.id === CUSTOM_INSTRUCTION) {
    if (input.touched) {
      return { kind: 'keep', templateId: CUSTOM_INSTRUCTION }
    }
    return { kind: 'apply', templateId: CUSTOM_INSTRUCTION, text: '' }
  }
  if (input.touched && input.currentText !== next.text) {
    return { kind: 'ask', templateId: next.id }
  }
  return { kind: 'apply', templateId: next.id, text: next.text }
}
