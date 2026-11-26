/**
 * FILE: apps/web/src/ui/bot-avatar.tsx
 * НАЗНАЧЕНИЕ: живой аватар v3. SVG инлайном, не через img: иначе нет state, цвета и взгляда.
 * ВХОД: id из 12, цвет палитры или пусто («свой»), состояние, размер в пикселях.
 * ВЫХОД: span с svg. Стиль один на приложение, <style> из файла вырезается.
 * followPointer() зовёт мастер один раз. Класс на svg — tb-av2, так устроен v3.
 */

import { useEffect, useRef } from 'react'
import manifest from '../avatars/manifest.json'
import { setColor, setState, uniquify } from '../avatars/tinybots-avatar.js'
import '../avatars/tinybots-avatars.css'
import berry from '../avatars/svg/berry.svg?raw'
import bunny from '../avatars/svg/bunny.svg?raw'
import ember from '../avatars/svg/ember.svg?raw'
import ghost from '../avatars/svg/ghost.svg?raw'
import grape from '../avatars/svg/grape.svg?raw'
import kitty from '../avatars/svg/kitty.svg?raw'
import mint from '../avatars/svg/mint.svg?raw'
import ocean from '../avatars/svg/ocean.svg?raw'
import plum from '../avatars/svg/plum.svg?raw'
import robo from '../avatars/svg/robo.svg?raw'
import sky from '../avatars/svg/sky.svg?raw'
import sunny from '../avatars/svg/sunny.svg?raw'

const SVG: Record<string, string> = {
  sunny, berry, mint, grape, sky, ember, ocean, plum, kitty, bunny, ghost, robo,
}

export type AvatarState = 'idle' | 'thinking' | 'talking' | 'happy' | 'error' | 'sleep'

export const AVATAR_LIST = manifest.avatars
export const AVATAR_PALETTE = manifest.palette

const COLOR_LABEL: Record<string, string> = {
  violet: 'фиолетовый',
  pink: 'розовый',
  coral: 'коралловый',
  orange: 'оранжевый',
  yellow: 'жёлтый',
  green: 'зелёный',
  teal: 'бирюзовый',
  blue: 'синий',
  lilac: 'сиреневый',
  slate: 'грифельный',
}

export function colorLabel(color: string | null): string {
  if (!color) {
    return 'свой'
  }
  return COLOR_LABEL[color] ?? color
}

export function avatarName(id: string | null): string {
  return AVATAR_LIST.find((item) => item.id === id)?.name ?? ''
}

/** Общий CSS уже подключён. Повторный <style> в каждом svg раздувает DOM и дублирует анимации. */
function stripStyle(svg: string): string {
  return svg.replace(/<style[\s\S]*?<\/style>/, '')
}

export function BotAvatar({
  id,
  color,
  state,
  size,
}: {
  id: string
  color: string | null
  state: AvatarState
  size: number
}) {
  const host = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const root = host.current
    const raw = SVG[id]
    if (!root || !raw) {
      return
    }
    const current = root.querySelector('svg')
    if (!current || current.getAttribute('data-avatar') !== id) {
      root.innerHTML = uniquify(stripStyle(raw))
    }
    const svg = root.querySelector('svg')
    if (!svg) {
      return
    }
    svg.setAttribute('width', String(size))
    svg.setAttribute('height', String(size))
    setState(svg, state)
    setColor(svg, color ?? '')
  }, [id, color, state, size])

  return <span ref={host} className="inline-grid place-items-center" style={{ width: size, height: size }} />
}
