/**
 * FILE: apps/web/src/ui/secrets-panel.tsx
 * НАЗНАЧЕНИЕ: окно ключа владельца.
 * ВХОД: csrf и список ботов. GET отдаёт метаданные и «задан», значение не приходит.
 * ВЫХОД: POST в хранилище ОС. Поле значения после записи очищается и обратно не заполняется.
 * Allowlist и боты меняются только отсюда.
 */

import { useEffect, useState } from 'react'

type Allow = { host: string; methods: string[] }

type SecretView = {
  name: string
  description: string
  header: string
  body: boolean
  allow: Allow[]
  bots: string[]
  set: boolean
}

const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']

export function SecretsPanel(props: {
  csrf: string
  bots: Array<{ id: string; name: string }>
  onClose: () => void
}) {
  const [rows, setRows] = useState<SecretView[]>([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [header, setHeader] = useState('Authorization: Bearer')
  const [body, setBody] = useState(false)
  const [host, setHost] = useState('')
  const [methods, setMethods] = useState<string[]>(['GET'])
  const [allow, setAllow] = useState<Allow[]>([])
  const [bots, setBots] = useState<string[]>([])
  const [value, setValue] = useState('')
  const [wasSet, setWasSet] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function reload() {
    const res = await fetch('/api/secrets')
    if (!res.ok) {
      setNote('Список не прочитался')
      return
    }
    const data = (await res.json()) as { secrets?: SecretView[] }
    const text = JSON.stringify(data)
    if (value && text.includes(value)) {
      setNote('Сервер вернул значение')
      return
    }
    setRows(data.secrets ?? [])
  }

  useEffect(() => {
    void reload()
  }, [])

  function loadRow(row: SecretView) {
    setName(row.name)
    setDescription(row.description)
    setHeader(row.header)
    setBody(row.body)
    setAllow(row.allow)
    setBots(row.bots)
    setWasSet(row.set)
    setValue('')
    setNote(row.set ? 'задан' : 'не задан')
  }

  function toggleMethod(method: string) {
    setMethods((current) => current.includes(method) ? current.filter((item) => item !== method) : [...current, method])
  }

  function addHost() {
    const next = host.trim()
    if (!next || methods.length === 0) {
      return
    }
    setAllow((current) => [...current.filter((item) => item.host !== next), { host: next, methods: [...methods] }])
    setHost('')
  }

  async function save() {
    if (!props.csrf || busy) {
      return
    }
    setBusy(true)
    setNote(null)
    try {
      const res = await fetch('/api/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': props.csrf },
        body: JSON.stringify({
          name,
          description,
          header,
          body,
          allow,
          bots,
          ...(value.trim().length > 0 ? { value, replace: wasSet } : {}),
        }),
      })
      const data = (await res.json()) as { error?: string; secret?: SecretView }
      const text = JSON.stringify(data)
      if (value && text.includes(value)) {
        setNote('Сервер вернул значение')
        return
      }
      if (!res.ok) {
        setNote(data.error === 'exists' ? 'Уже задан. Введите значение ещё раз для замены.' : 'Не записалось')
        return
      }
      setValue('')
      setWasSet(data.secret?.set === true)
      setNote(data.secret?.set ? 'задан' : 'не задан')
      await reload()
    } catch {
      setNote('Не записалось')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-bg pm-center">
      <div className="set" role="dialog" aria-modal="true" aria-label="Ключи" data-testid="secrets-dialog">
        <div className="set-h">
          <div>
            <div className="k">Хранилище ОС</div>
            <h2>Ключи</h2>
          </div>
          <button type="button" className="x" onClick={props.onClose} aria-label="Закрыть ключи">×</button>
        </div>
        <div className="set-b">
          <ul className="plain" data-testid="secrets-list">
            {rows.map((row) => (
              <li key={row.name}>
                <button type="button" data-testid={`secret-row-${row.name}`} onClick={() => loadRow(row)}>
                  {row.name} · {row.set ? 'задан' : 'не задан'} · {row.description}
                </button>
              </li>
            ))}
          </ul>
          <label className="field">
            <span>Имя</span>
            <input data-testid="secret-name" value={name} onChange={(event) => setName(event.target.value.toUpperCase())} autoComplete="off" />
          </label>
          <label className="field">
            <span>Описание</span>
            <input data-testid="secret-description" value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label className="field">
            <span>Заголовок</span>
            <input data-testid="secret-header" value={header} onChange={(event) => setHeader(event.target.value)} />
          </label>
          <label className="check">
            <input data-testid="secret-body" type="checkbox" checked={body} onChange={(event) => setBody(event.target.checked)} />
            можно в теле
          </label>
          <label className="field">
            <span>Хост allowlist</span>
            <input data-testid="secret-host" value={host} onChange={(event) => setHost(event.target.value)} />
          </label>
          <div className="seg" data-testid="secret-methods">
            {METHODS.map((method) => (
              <label key={method} className={methods.includes(method) ? 'on' : ''}>
                <input type="checkbox" checked={methods.includes(method)} onChange={() => toggleMethod(method)} />
                {method}
              </label>
            ))}
          </div>
          <button type="button" className="btn" data-testid="secret-add-host" onClick={addHost}>Добавить хост</button>
          <ul className="plain" data-testid="secret-allow">
            {allow.map((item) => (
              <li key={item.host}>{item.host} · {item.methods.join(',')}</li>
            ))}
          </ul>
          <div data-testid="secret-bots">
            {props.bots.map((bot) => (
              <label key={bot.id} className="check">
                <input
                  type="checkbox"
                  data-testid={`secret-bot-${bot.id}`}
                  checked={bots.includes(bot.id)}
                  onChange={(event) => {
                    setBots((current) => event.target.checked ? [...current, bot.id] : current.filter((id) => id !== bot.id))
                  }}
                />
                {bot.name}
              </label>
            ))}
          </div>
          <label className="field">
            <span>Значение (только запись)</span>
            <input
              data-testid="secret-value"
              type="password"
              value={value}
              autoComplete="new-password"
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
        </div>
        <div className="set-f">
          <button type="button" className="btn primary" data-testid="secret-save" disabled={busy} onClick={() => void save()}>Сохранить</button>
          {note ? <p className="sub" data-testid="secret-note">{note}</p> : null}
        </div>
      </div>
    </div>
  )
}
