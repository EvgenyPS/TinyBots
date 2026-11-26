/**
 * FILE: apps/web/src/ui/setup-bots.tsx
 * НАЗНАЧЕНИЕ: шаг «Боты». Вкладки, кнопка аватара 72px, поповер 96px и сетка 6×2.
 * ВХОД: форма и правки одного бота. ВЫХОД: те же поля, плюс шаблон инструкций и id с суффиксом -bot.
 * «Дополнительно» — details: e2e читает .open и жмёт Enter на summary.
 * Список шаблонов — поповер на странице, чтобы открытый перечень был виден и в светлой теме.
 */

import { CircleHelp, Plus } from 'lucide-react'
import { useState, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react'
import { Accordion, AccordionContent, AccordionTrigger } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  CUSTOM_MODEL,
  applyProvider,
  editBaseUrl,
  editCustomModel,
  editKeyEnv,
  listedModels,
  modelSelectValue,
  selectCustomModel,
  selectListedModel,
  showCustomModel,
} from './bot-presets'
import { AVATAR_LIST, AVATAR_PALETTE, BotAvatar, avatarName, colorLabel } from './bot-avatar'
import { chooseInstructionTemplate, instructionTemplateById, INSTRUCTION_TEMPLATES } from './instruction-templates'
import { botIdFieldError, emptyBot, fieldsOf, withFields, type BotForm, type Form } from './setup-model'

export function BotsStep({
  form,
  tab,
  setTab,
  avatarOpen,
  setAvatarOpen,
  layer,
  setForm,
  updateBot,
  writeBot,
  commitBotId,
  idError,
}: {
  form: Form
  tab: number
  setTab: (index: number) => void
  avatarOpen: boolean
  setAvatarOpen: (open: boolean) => void
  layer: HTMLElement | null
  setForm: Dispatch<SetStateAction<Form>>
  updateBot: (botIndex: number, patch: Partial<BotForm>, touchId?: boolean) => void
  writeBot: (botIndex: number, recipe: (bot: BotForm) => BotForm) => void
  commitBotId: (botIndex: number) => void
  idError: string | null
}) {
  const [templateOpen, setTemplateOpen] = useState(false)
  const [askTemplate, setAskTemplate] = useState<{ tab: number; id: string } | null>(null)
  const bot = form.bots[tab]
  if (!bot) {
    return null
  }
  const asking = askTemplate && askTemplate.tab === tab ? askTemplate.id : null
  const askingTitle = asking ? instructionTemplateById(asking)?.title : undefined
  const idMessage = botIdFieldError(form.bots, tab)
  const showIdMessage = idError !== null && idMessage !== null && idError === idMessage

  function pickTemplate(nextId: string) {
    setTemplateOpen(false)
    const choice = chooseInstructionTemplate({
      nextId,
      currentText: bot.instructions,
      touched: bot.instructionsTouched,
    })
    if (choice.kind === 'ask') {
      setAskTemplate({ tab, id: choice.templateId })
      return
    }
    setAskTemplate(null)
    if (choice.kind === 'apply') {
      updateBot(tab, { instructionTemplate: choice.templateId, instructions: choice.text, instructionsTouched: false })
      return
    }
    updateBot(tab, { instructionTemplate: choice.templateId })
  }

  function replaceInstructions() {
    if (!asking) return
    const choice = chooseInstructionTemplate({ nextId: asking, currentText: '', touched: false })
    if (choice.kind !== 'apply') return
    updateBot(tab, { instructionTemplate: choice.templateId, instructions: choice.text, instructionsTouched: false })
    setAskTemplate(null)
  }

  function pickAvatar(id: string) {
    const meta = AVATAR_LIST.find((item) => item.id === id)
    updateBot(tab, { avatarId: id, avatarColor: meta?.defaultColor ?? null })
  }

  function onAvatarKey(event: KeyboardEvent<HTMLDivElement>) {
    const ids = AVATAR_LIST.map((item) => item.id)
    const at = Math.max(0, ids.indexOf(bot.avatarId ?? ids[0] ?? ''))
    let next = at
    if (event.key === 'ArrowRight') {
      next = Math.min(ids.length - 1, at + 1)
    } else if (event.key === 'ArrowLeft') {
      next = Math.max(0, at - 1)
    } else if (event.key === 'ArrowDown') {
      next = Math.min(ids.length - 1, at + 6)
    } else if (event.key === 'ArrowUp') {
      next = Math.max(0, at - 6)
    } else {
      return
    }
    event.preventDefault()
    const id = ids[next]
    if (id) {
      pickAvatar(id)
    }
  }

  function hint(text: string) {
    return (
      <Tooltip>
        <TooltipTrigger className="inline-flex text-muted-foreground" aria-label={text}>
          <CircleHelp width={14} height={14} />
        </TooltipTrigger>
        <TooltipContent container={layer}>{text}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={String(tab)} onValueChange={(value) => { setTab(Number(value)); setAvatarOpen(false); setTemplateOpen(false) }}>
          <TabsList>
            {form.bots.map((item, botIndex) => (
              <TabsTrigger key={botIndex} value={String(botIndex)}>
                <span className="grid size-6 place-items-center">
                  {item.avatarId ? <BotAvatar id={item.avatarId} color={item.avatarColor} state="idle" size={22} /> : <span className="size-4 rounded-full bg-border" />}
                </span>
                {item.name || `Бот ${botIndex + 1}`}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {form.bots.length < 8 ? (
          <Button variant="ghost" size="sm" onClick={() => { setForm((prev) => ({ ...prev, bots: [...prev.bots, emptyBot()] })); setTab(form.bots.length) }}>
            <Plus width={14} height={14} /> Добавить бота
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-3.5 rounded-lg border border-border p-4">
        <div className="flex items-end gap-4 max-[719px]:flex-col max-[719px]:items-stretch">
          <Popover open={avatarOpen} onOpenChange={setAvatarOpen} modal={false}>
            <PopoverTrigger asChild>
              <button type="button" data-testid={`bot-avatar-open-${tab}`} className="relative grid size-[72px] shrink-0 place-items-center rounded-2xl border border-dashed border-input bg-accent/70" aria-label="Выбрать аватар">
                {bot.avatarId ? <BotAvatar id={bot.avatarId} color={bot.avatarColor} state="idle" size={56} /> : <Plus width={18} height={18} />}
                <span className="absolute inset-x-0 bottom-1 text-center text-[10.5px] font-bold text-primary">{bot.avatarId ? 'Сменить' : 'Выбрать'}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent container={layer} data-testid={`bot-avatar-pop-${tab}`} className="wz-pop flex w-[560px] max-w-[calc(100vw-24px)] overflow-hidden p-0" onOpenAutoFocus={(event) => event.preventDefault()}>
              <div className="flex w-[156px] shrink-0 flex-col items-center gap-1 border-r border-border bg-accent/50 px-3 py-4">
                <div className="mb-2 grid size-28 place-items-center rounded-[20px] bg-popover shadow-[inset_0_0_0_1px_var(--border)]">
                  {bot.avatarId ? <BotAvatar id={bot.avatarId} color={bot.avatarColor} state="happy" size={96} /> : <span className="text-xs text-muted-foreground">нет</span>}
                </div>
                <b className="text-sm">{bot.avatarId ? avatarName(bot.avatarId) : 'Без аватара'}</b>
                <span className="text-xs text-muted-foreground">{bot.avatarId ? `цвет: ${colorLabel(bot.avatarColor)}` : 'не пишется в конфиг'}</span>
                <Button variant="ghost" size="sm" className="mt-2" data-testid={`bot-avatar-none-${tab}`} onClick={() => { updateBot(tab, { avatarId: null, avatarColor: null }); setAvatarOpen(false) }}>
                  Без аватара
                </Button>
              </div>
              <div className="flex flex-1 flex-col gap-3 p-4">
                <div className="flex items-baseline justify-between"><b className="text-sm">Персонаж</b><span className="text-xs text-muted-foreground">12</span></div>
                <div className="grid grid-cols-6 gap-1.5" role="radiogroup" aria-label="Аватар" onKeyDown={onAvatarKey}>
                  {AVATAR_LIST.map((item) => {
                    const on = bot.avatarId === item.id
                    return (
                      <button key={item.id} type="button" role="radio" aria-checked={on} aria-label={item.name} data-testid={`bot-avatar-id-${item.id}`} className={on ? 'grid size-14 place-items-center rounded-xl border-2 border-primary bg-accent' : 'grid size-14 place-items-center rounded-xl border border-transparent bg-muted'} onClick={() => pickAvatar(item.id)}>
                        <BotAvatar id={item.id} color={on ? bot.avatarColor : item.defaultColor} state="idle" size={44} />
                      </button>
                    )
                  })}
                </div>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Цвет">
                  {(Object.keys(AVATAR_PALETTE) as (keyof typeof AVATAR_PALETTE)[]).map((key) => (
                    <button key={key} type="button" role="radio" aria-checked={bot.avatarColor === key} aria-label={colorLabel(key)} data-testid={`bot-avatar-color-${key}`} className={bot.avatarColor === key ? 'size-[26px] rounded-full shadow-[0_0_0_2px_var(--primary)]' : 'size-[26px] rounded-full shadow-[0_0_0_1px_var(--border)]'} style={{ background: AVATAR_PALETTE[key].mid }} onClick={() => updateBot(tab, { avatarId: bot.avatarId ?? 'grape', avatarColor: key })} />
                  ))}
                  <button type="button" data-testid={`bot-avatar-own-${tab}`} className="grid size-[26px] place-items-center rounded-full border border-dashed border-input bg-muted text-[10px] text-muted-foreground" onClick={() => updateBot(tab, { avatarId: bot.avatarId ?? 'grape', avatarColor: null })}>
                    Свой
                  </button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <div className="wz-pair min-w-0 flex-1" data-testid={`bot-pair-name-${tab}`}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`bot-name-${tab}`}>Имя</Label>
              <Input id={`bot-name-${tab}`} data-testid={`bot-name-${tab}`} value={bot.name} autoComplete="off" onChange={(event) => updateBot(tab, { name: event.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`bot-role-${tab}`}>Роль</Label>
              <Input id={`bot-role-${tab}`} data-testid={`bot-role-${tab}`} value={bot.role} autoComplete="off" onChange={(event) => updateBot(tab, { role: event.target.value })} />
            </div>
          </div>
        </div>
        <Switch compact data-testid={`bot-api-${tab}`} checked={bot.api} label="Свой API-бот" hint="Модель по вашему ключу. Выключено — бот Grok из Grok Bot." onChange={(event) => {
          const api = event.target.checked
          writeBot(tab, (current) => api ? withFields({ ...current, api: true }, applyProvider(fieldsOf(current), current.provider)) : { ...current, api: false })
        }} />
        {bot.api ? (
          <>
            <div className="wz-pair" data-testid={`bot-pair-model-${tab}`}>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`bot-provider-${tab}`}>Провайдер</Label>
                <Select id={`bot-provider-${tab}`} data-testid={`bot-provider-${tab}`} value={bot.provider} onChange={(event) => {
                  const provider = event.target.value
                  writeBot(tab, (current) => withFields(current, applyProvider(fieldsOf(current), provider)))
                }}>
                  <option value="deepseek">DeepSeek</option>
                  <option value="qwen">Qwen</option>
                  <option value="other">Другой</option>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor={`bot-model-${tab}`}>Модель</Label>
                  {hint('Модель из списка провайдера. Пункт «своя» открывает ручной ввод.')}
                </div>
                <Select id={`bot-model-${tab}`} className="wz-mono" data-testid={`bot-model-${tab}`} value={modelSelectValue(fieldsOf(bot))} onChange={(event) => {
                  const value = event.target.value
                  writeBot(tab, (current) => withFields(current, value === CUSTOM_MODEL ? selectCustomModel(fieldsOf(current)) : selectListedModel(fieldsOf(current), value)))
                }}>
                  <optgroup label={bot.provider}>
                    {listedModels(bot.provider).map((model) => <option key={model} value={model}>{model}</option>)}
                  </optgroup>
                  <option value={CUSTOM_MODEL}>своя</option>
                </Select>
              </div>
            </div>
            {showCustomModel(fieldsOf(bot)) ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`bot-model-custom-${tab}`}>Своя модель</Label>
                <Input id={`bot-model-custom-${tab}`} className="wz-mono" data-testid={`bot-model-custom-${tab}`} value={bot.model} autoComplete="off" onChange={(event) => {
                  const model = event.target.value
                  writeBot(tab, (current) => withFields(current, editCustomModel(fieldsOf(current), model)))
                }} />
              </div>
            ) : null}
            <div className="wz-pair">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`bot-template-${tab}`}>Шаблон</Label>
                <Popover open={templateOpen} onOpenChange={setTemplateOpen} modal={false}>
                  <PopoverTrigger asChild>
                    <button type="button" id={`bot-template-${tab}`} data-testid={`bot-template-${tab}`} className="wz-select flex h-9 w-full items-center rounded-md border border-input bg-card px-3 text-left text-sm font-normal text-foreground shadow-[var(--wz-shadow)]" aria-haspopup="listbox" aria-expanded={templateOpen}>
                      {instructionTemplateById(bot.instructionTemplate)?.title ?? 'Своя'}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent container={layer} side="bottom" avoidCollisions={false} data-testid={`bot-template-list-${tab}`} className="w-[var(--radix-popover-trigger-width)] p-1" onOpenAutoFocus={(event) => event.preventDefault()}>
                    <div role="listbox" aria-label="Шаблон инструкций" className="flex flex-col">
                      {INSTRUCTION_TEMPLATES.map((item) => {
                        const on = bot.instructionTemplate === item.id
                        return (
                          <button key={item.id} type="button" role="option" aria-selected={on} data-testid={`bot-template-option-${item.id}`} className={on ? 'w-full cursor-pointer rounded-md border-0 bg-accent px-2.5 py-1.5 text-left text-sm font-semibold' : 'w-full cursor-pointer rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left text-sm hover:bg-accent'} onClick={() => pickTemplate(item.id)}>
                            {item.title}
                          </button>
                        )
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
                {asking ? (
                  <div role="alertdialog" aria-labelledby={`bot-template-ask-${tab}`} data-testid={`bot-template-confirm-${tab}`} className="rounded-lg border border-border bg-accent/60 px-3 py-2.5">
                    <p id={`bot-template-ask-${tab}`} className="text-[13px]">В поле уже ваш текст. Заменить его шаблоном «{askingTitle}»?</p>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" data-testid={`bot-template-replace-${tab}`} onClick={replaceInstructions}>Заменить</Button>
                      <Button size="sm" variant="outline" data-testid={`bot-template-keep-${tab}`} onClick={() => setAskTemplate(null)}>Оставить</Button>
                    </div>
                  </div>
                ) : null}
                <Label htmlFor={`bot-instructions-${tab}`}>Инструкции</Label>
                <Textarea id={`bot-instructions-${tab}`} data-testid={`bot-instructions-${tab}`} value={bot.instructions} onChange={(event) => updateBot(tab, { instructions: event.target.value, instructionsTouched: true })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`bot-tools-${tab}`}>Доступ к папке проекта</Label>
                <Select id={`bot-tools-${tab}`} data-testid={`bot-tools-${tab}`} value={bot.projectTools} onChange={(event) => updateBot(tab, { projectTools: event.target.value === 'read' || event.target.value === 'propose' ? event.target.value : 'off' })}>
                  <option value="off">выключен</option>
                  <option value="read">только чтение</option>
                  <option value="propose">чтение и предложения</option>
                </Select>
                <p className="text-xs text-muted-foreground">Выключен — бот не видит файлы. Чтение — только смотрит. Предложения — готовит правку, применяете вы.</p>
              </div>
            </div>
          </>
        ) : <p className="text-[13px] text-muted-foreground">У бота Grok доступа к папке нет. Ключ ему не нужен.</p>}
        <Accordion data-testid={`bot-extra-${tab}`} open={bot.extraOpen} onToggle={(event) => {
          const open = event.currentTarget.open
          writeBot(tab, (current) => (current.extraOpen === open ? current : { ...current, extraOpen: open }))
        }}>
          <AccordionTrigger data-testid={`bot-extra-summary-${tab}`}>
            <span className="flex flex-wrap items-baseline gap-2.5"><b>Дополнительно</b><small className="text-xs font-normal text-muted-foreground">id, имя ключа и base_url</small></span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`bot-id-${tab}`}>Id</Label>
              <Input id={`bot-id-${tab}`} className="wz-mono" data-testid={`bot-id-${tab}`} value={bot.id} autoComplete="off" onChange={(event) => updateBot(tab, { id: event.target.value }, true)} onBlur={() => { if (bot.idTouched) commitBotId(tab) }} />
              {showIdMessage ? <p className="text-xs font-semibold text-[#9f1239] dark:text-[#fecdd3]" data-testid={`bot-id-error-${tab}`} role="alert">{idMessage}</p> : null}
              <p className="text-xs text-muted-foreground">Короткое имя латиницей, в конце -bot. Пока не поправите, собирается из имени.</p>
            </div>
            {bot.api ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor={`bot-key-${tab}`}>Имя переменной ключа</Label>
                    {hint('Имя, под которым лаунчер хранит ключ. Сам ключ вводится в окне «Ключи», не здесь.')}
                    {!bot.apiKeyEnvTouched && bot.apiKeyEnv ? <Badge variant="soft">авто</Badge> : null}
                  </div>
                  <Input id={`bot-key-${tab}`} className="wz-mono" data-testid={`bot-key-${tab}`} value={bot.apiKeyEnv} autoComplete="off" onChange={(event) => {
                    const apiKeyEnv = event.target.value
                    writeBot(tab, (current) => withFields(current, editKeyEnv(fieldsOf(current), apiKeyEnv)))
                  }} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor={`bot-base-${tab}`}>base_url</Label>
                    {!bot.baseUrlTouched && bot.baseUrl ? <Badge variant="soft">авто</Badge> : null}
                  </div>
                  <Input id={`bot-base-${tab}`} className="wz-mono" data-testid={`bot-base-${tab}`} value={bot.baseUrl} autoComplete="off" onChange={(event) => {
                    const baseUrl = event.target.value
                    writeBot(tab, (current) => withFields(current, editBaseUrl(fieldsOf(current), baseUrl)))
                  }} />
                  <p className="text-xs text-muted-foreground">Адрес API. Для DeepSeek и Qwen уже подставлен, можно заменить.</p>
                </div>
                {bot.baseUrlTouched || bot.apiKeyEnvTouched ? (
                  <Button variant="link" onClick={() => writeBot(tab, (current) => withFields(current, applyProvider({ ...fieldsOf(current), baseUrlTouched: false, apiKeyEnvTouched: false }, current.provider)))}>
                    Вернуть подстановку
                  </Button>
                ) : null}
              </>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`bot-avatar-${tab}`}>Своя картинка, путь</Label>
              <Input id={`bot-avatar-${tab}`} className="wz-mono" data-testid={`bot-avatar-${tab}`} value={bot.avatar} autoComplete="off" placeholder="assets/bot.svg" onChange={(event) => updateBot(tab, { avatar: event.target.value })} />
              <p className="text-xs text-muted-foreground">Необязательно. Это путь к файлу, не встроенный персонаж выше.</p>
            </div>
          </AccordionContent>
        </Accordion>
        {form.bots.length > 1 ? (
          <Button variant="outline" onClick={() => { setForm((prev) => ({ ...prev, bots: prev.bots.filter((_, i) => i !== tab) })); setTab(0); setAvatarOpen(false) }}>Убрать</Button>
        ) : null}
      </div>
      <p className="text-[13px] text-muted-foreground">Ключ остаётся в .env или в хранилище. В конфиг пишется только имя переменной.</p>
    </div>
  )
}
