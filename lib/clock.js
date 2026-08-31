/**
 * Poisson delays, quiet-hours, action lottery, preset matching, NO_PING.
 * Pure functions — no Cordis, no timers — so tests do not need a fake agent.
 *
 * @module dsh-life-tick/clock
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

export const KINDS = Object.freeze(['silence', 'private', 'dream', 'glance', 'reach'])

export const WEIGHTS = Object.freeze({
  day: Object.freeze({ silence: 0.45, private: 0.20, dream: 0.05, glance: 0.23, reach: 0.07 }),
  night: Object.freeze({ silence: 0.55, private: 0.25, dream: 0.15, glance: 0.04, reach: 0.01 }),
  justTalked: Object.freeze({ silence: 0.80, private: 0.15, dream: 0, glance: 0.05, reach: 0 }),
})

const MIN_DELAY_MS = 8 * 60_000
const MAX_DELAY_MS = 6 * 60 * 60_000

export function hourInZone(now, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(now)
    const hour = Number(parts.find((part) => part.type === 'hour')?.value)
    if (!Number.isFinite(hour)) return now.getHours()
    return hour === 24 ? 0 : hour
  } catch {
    return now.getHours()
  }
}

/** Quiet window. Start >= end means it wraps midnight (23 → 8). */
export function isQuiet(hour, quietStart, quietEnd) {
  const start = Math.trunc(Number(quietStart))
  const end = Math.trunc(Number(quietEnd))
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return false
  if (start < end) return hour >= start && hour < end
  return hour >= start || hour < end
}

export function nextDelayMs(input, random = Math.random) {
  const meanDay = Math.max(1, Number(input.meanDayMin) || 45)
  const meanNight = Math.max(1, Number(input.meanNightMin) || 180)
  let meanMin = isQuiet(input.hour, input.quietStart, input.quietEnd) ? meanNight : meanDay
  const since = Number(input.hoursSinceHuman)
  if (Number.isFinite(since) && since < 1) meanMin *= 3
  if (Number.isFinite(since) && since > 6) meanMin *= 0.6
  const cap = Math.max(0, Math.trunc(Number(input.maxVisiblePerDay) || 0))
  if (cap > 0 && (input.visiblePingsToday ?? 0) >= cap) meanMin *= 4
  const u = Math.min(1 - 1e-9, Math.max(1e-9, Number(random()) || 1e-9))
  const delay = -Math.log(u) * meanMin * 60_000
  return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, delay))
}

export function shouldWake(input, random = Math.random) {
  const since = Number(input.hoursSinceHuman)
  if (Number.isFinite(since) && since < 0.5) return false
  let p = 0.35
  if (isQuiet(input.hour, input.quietStart, input.quietEnd)) p *= 0.25
  return random() < p
}

export function kindWeights(input) {
  const since = Number(input.hoursSinceHuman)
  if (Number.isFinite(since) && since < 1) return WEIGHTS.justTalked
  if (isQuiet(input.hour, input.quietStart, input.quietEnd)) return WEIGHTS.night
  return WEIGHTS.day
}

export function rollKind(weights, random = Math.random) {
  const entries = Object.entries(weights)
  const sum = entries.reduce((total, [, weight]) => total + weight, 0)
  if (sum <= 0) return 'silence'
  let acc = 0
  const u = random()
  for (const [kind, weight] of entries) {
    acc += weight / sum
    if (u < acc) return kind
  }
  return entries[entries.length - 1][0]
}

export function pickKind(input, random = Math.random) {
  if (!shouldWake(input, random)) return 'silence'
  return rollKind(kindWeights(input), random)
}

export function isNoPing(text) {
  if (typeof text !== 'string') return false
  const trimmed = text.trim()
  if (!trimmed) return false
  return trimmed === 'NO_PING' || trimmed.startsWith('NO_PING')
}

export function isVisibleKind(kind) {
  return kind === 'glance' || kind === 'reach'
}

export function isModelKind(kind) {
  return kind === 'private' || kind === 'dream' || kind === 'glance' || kind === 'reach'
}

export function localDayKey(now, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
  } catch {
    return now.toISOString().slice(0, 10)
  }
}

export function extractAssistantText(payload) {
  if (payload == null) return ''
  if (typeof payload === 'string') return payload
  const message = payload.message ?? payload.assistant ?? payload
  if (typeof message === 'string') return message
  if (typeof message?.text === 'string') return message.text
  const content = message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((block) => (typeof block === 'string' ? block : block?.text ?? '')).join('')
  }
  return ''
}

export function resolvePresetId(agent) {
  if (!agent || typeof agent !== 'object') return null
  const values = [
    agent.session?.header?.agentPreset,
    agent.session?.agentPreset,
    agent.presetId,
    typeof agent.preset === 'string' ? agent.preset : agent.preset?.id,
    agent.agentPreset,
    agent.session?.presetId,
    typeof agent.session?.preset === 'string' ? agent.session.preset : agent.session?.preset?.id,
    agent.session?.meta?.agentPreset,
    agent.meta?.agentPreset,
    agent.options?.presetId,
    agent.options?.preset,
    agent.agentOptions?.preset,
    agent.agentOptions?.presetId,
  ]
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

export function shouldAttach(agent, presetIds, attachWhenUnknown = false) {
  if (!Array.isArray(presetIds) || presetIds.length === 0) return true
  const id = resolvePresetId(agent)
  if (!id) return attachWhenUnknown === true
  const wanted = new Set(presetIds.map((item) => String(item).toLowerCase()))
  return wanted.has(id.toLowerCase())
}

export function expandHome(path) {
  if (typeof path !== 'string' || path.length === 0) return path
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

export function parsePresetIds(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  if (typeof value === 'string') {
    return value.split(/[, \n]+/).map((item) => item.trim()).filter(Boolean)
  }
  return ['home']
}

export { MIN_DELAY_MS, MAX_DELAY_MS }
