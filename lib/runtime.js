/**
 * Per-agent life-tick runtime: Poisson delay, action lottery, NO_PING swallow.
 *
 * @module dsh-life-tick/runtime
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { promptForKind } from './prompt.js'
import {
  expandHome,
  extractAssistantText,
  hourInZone,
  isModelKind,
  isNoPing,
  isVisibleKind,
  localDayKey,
  nextDelayMs,
  pickKind,
} from './clock.js'

export function clampIntervalSeconds(value, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(86400, Math.max(30, Math.trunc(number)))
}

export function buildHeartbeatMessage(text) {
  return buildTickMessage(text)
}

export function buildTickMessage(text) {
  return {
    id: `lt-${randomUUID()}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'life-tick' },
  }
}

export class LifeTickRuntime {
  constructor(agent, options) {
    this.agent = agent
    this.readConfig = options.readConfig
    this.getCompaction = options.getCompaction
    this.logger = options.logger
    this.agents = options.agents
    this.now = options.now ?? Date.now
    this.random = options.random ?? Math.random
    this.forceKind = options.forceKind
    this.delayMs = options.delayMs
    this.timer = undefined
    this.pendingId = undefined
    this.pendingKind = undefined
    this.disposed = false
    this.missedCount = 0
    this.paused = false
    this.beatTimes = []
    this.stopInserted = undefined
    this.stopTurn = undefined
    this.lastHumanAt = this.now()
    this.wakesToday = 0
    this.visiblePingsToday = 0
    this.dayKey = ''
    this.awaitingReply = false
    this.lastKind = undefined
  }

  start() {
    if (this.disposed) return
    this.stopInserted = this.agent.ctx.on?.('agent/inbox/inserted', ({ message }) => {
      if (message?.source?.kind === 'user') this.onUserInteraction()
      if (message?.role === 'assistant') this.onAssistantText(extractAssistantText(message))
    })
    const onTurn = (payload) => {
      const text = extractAssistantText(payload)
      if (text) this.onAssistantText(text)
    }
    const extra = []
    for (const event of ['agent/turn/end', 'turn/end', 'assistant/message']) {
      const stop = this.agent.ctx.on?.(event, onTurn)
      if (typeof stop === 'function') extra.push(stop)
    }
    this.stopTurn = () => {
      for (const stop of extra) stop()
    }
    this.arm()
  }

  dispose() {
    this.disposed = true
    this.stopInserted?.()
    this.stopInserted = undefined
    this.stopTurn?.()
    this.stopTurn = undefined
    this.clearTimer()
  }

  clearTimer() {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  context(config, at = this.now()) {
    this.rollDay(config, at)
    const date = new Date(at)
    const hour = hourInZone(date, config.timezone || 'America/Sao_Paulo')
    const hoursSinceHuman = Math.max(0, (at - this.lastHumanAt) / 3600_000)
    return {
      hour,
      hoursSinceHuman,
      visiblePingsToday: this.visiblePingsToday,
      maxVisiblePerDay: config.maxVisiblePerDay,
      meanDayMin: config.meanDayMin,
      meanNightMin: config.meanNightMin,
      quietStart: config.quietStart,
      quietEnd: config.quietEnd,
    }
  }

  rollDay(config, at) {
    const key = localDayKey(new Date(at), config.timezone || 'America/Sao_Paulo')
    if (this.dayKey !== key) {
      this.dayKey = key
      this.wakesToday = 0
      this.visiblePingsToday = 0
    }
  }

  currentIntervalMs(config) {
    if (typeof this.delayMs === 'function') return this.delayMs()
    if (typeof this.delayMs === 'number') return this.delayMs
    return nextDelayMs(this.context(config), this.random)
  }

  arm() {
    if (this.disposed || this.paused) return
    this.clearTimer()
    const intervalMs = this.currentIntervalMs(this.readConfig())
    this.timer = setTimeout(() => {
      this.timer = undefined
      try {
        this.tick()
      } catch (error) {
        this.logger?.warn?.(`life-tick: tick failed for agent "${this.agent.id}": ${error instanceof Error ? error.message : String(error)}`)
      }
    }, intervalMs)
    this.timer.unref?.()
  }

  reschedule() {
    if (this.disposed || this.paused) return
    this.arm()
  }

  onUserInteraction() {
    if (this.disposed) return
    const wasPaused = this.paused
    this.missedCount = 0
    this.beatTimes = []
    this.paused = false
    this.lastHumanAt = this.now()
    this.awaitingReply = false
    if (wasPaused) {
      this.logger?.info?.(`life-tick: resumed after user interaction for agent "${this.agent.id}"`)
    }
    this.arm()
  }

  onAssistantText(text) {
    if (!this.awaitingReply) return
    this.awaitingReply = false
    if (isNoPing(text)) {
      this.logger?.info?.(`life-tick: NO_PING from agent "${this.agent.id}" (kind ${this.lastKind})`)
      return
    }
    if (isVisibleKind(this.lastKind)) {
      this.visiblePingsToday += 1
      this.missedCount += 1
    }
  }

  pause() {
    this.clearTimer()
    if (!this.paused) {
      this.paused = true
      this.logger?.info?.(`life-tick: paused (unattended) for agent "${this.agent.id}"`)
    }
  }

  tick() {
    if (this.disposed) return undefined
    if (this.agents && this.agents.get(this.agent.id) !== this.agent) {
      this.dispose()
      return undefined
    }
    const config = this.readConfig()
    if (config.enabled === false) return undefined

    const pauseAfter = Math.max(0, Math.trunc(Number(config.pauseAfterMissed ?? 5)))
    if (pauseAfter > 0 && this.missedCount >= pauseAfter) {
      this.pause()
      return undefined
    }

    const ctx = this.context(config)
    const kind = this.forceKind ?? pickKind(ctx, this.random)
    this.lastKind = kind

    if (!isModelKind(kind)) {
      this.logger?.info?.(`life-tick: silence for agent "${this.agent.id}"`)
      this.rearm()
      return undefined
    }

    const maxPerDay = Math.max(0, Math.trunc(Number(config.maxWakesPerDay ?? 8)))
    if (maxPerDay > 0 && this.wakesToday >= maxPerDay) {
      this.logger?.info?.(`life-tick: daily wake cap for agent "${this.agent.id}"`)
      this.rearm()
      return undefined
    }

    const maxVisible = Math.max(0, Math.trunc(Number(config.maxVisiblePerDay ?? 3)))
    if (isVisibleKind(kind) && maxVisible > 0 && this.visiblePingsToday >= maxVisible) {
      this.logger?.info?.(`life-tick: daily visible cap, skipping ping for agent "${this.agent.id}"`)
      this.rearm()
      return undefined
    }

    const maxPerHour = Math.max(0, Math.trunc(Number(config.maxWakesPerHour ?? 2)))
    if (maxPerHour > 0) {
      const now = this.now()
      this.beatTimes = this.beatTimes.filter((time) => now - time < 3600_000)
      if (this.beatTimes.length >= maxPerHour) {
        this.logger?.info?.(`life-tick: hourly cap (${maxPerHour}) reached for agent "${this.agent.id}"`)
        this.rearm()
        return undefined
      }
      this.beatTimes.push(now)
    }

    if (kind === 'private' || kind === 'dream') this.ensureLifeDir(config)

    const compaction = typeof this.getCompaction === 'function' ? this.getCompaction() : undefined
    if (config.compactBeforeBeat !== false && this.agent.status === 'idle'
      && compaction && typeof compaction.compactNow === 'function') {
      this.rearm()
      return this.compactThenDeliver(compaction, kind)
    }

    this.deliverTick(config, kind)
    this.rearm()
    return undefined
  }

  ensureLifeDir(config) {
    const dir = expandHome(config.lifeDir || '~/companion-life')
    try {
      mkdirSync(dir, { recursive: true })
      for (const name of ['diary.md', 'dreams.md', 'letters-unsent.md']) {
        const file = join(dir, name)
        if (!existsSync(file)) writeFileSync(file, '')
      }
    } catch (error) {
      this.logger?.warn?.(`life-tick: lifeDir skipped: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  deliverTick(config, kind) {
    if (this.disposed) return
    if (this.agents && this.agents.get(this.agent.id) !== this.agent) {
      this.dispose()
      return
    }
    const text = promptForKind(kind, config, new Date(this.now()))
    const message = buildTickMessage(text)

    const inbox = this.agent.inbox
    const pending = this.pendingId !== undefined ? inbox.locate(this.pendingId) : undefined
    if (pending !== undefined) {
      inbox.replace(this.pendingId, message)
    } else {
      this.agent.followup(message)
    }
    this.pendingId = message.id
    this.pendingKind = kind
    this.wakesToday += 1
    this.awaitingReply = true
    this.lastKind = kind
    this.logger?.info?.(`life-tick: ${kind} ${this.agent.status === 'idle' ? 'woke' : 'queued for'} agent "${this.agent.id}"`)
  }

  async compactThenDeliver(compaction, kind) {
    try {
      const result = await compaction.compactNow(this.agent, undefined, 'life-tick')
      if (result) {
        this.logger?.info?.(`life-tick: compacted before ${kind} for agent "${this.agent.id}"`)
      }
    } catch (error) {
      this.logger?.warn?.(`life-tick: pre-tick compaction skipped: ${error instanceof Error ? error.message : String(error)}`)
    }
    this.deliverTick(this.readConfig(), kind)
  }

  rearm() {
    if (!this.disposed && !this.paused && this.timer === undefined) this.arm()
  }
}

export { LifeTickRuntime as HeartbeatRuntime }
