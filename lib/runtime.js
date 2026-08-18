/**
 * Per-agent heartbeat runtime: one re-arming timer per live root agent.
 *
 * Mirrors the `dsh-schedule` design — a host-plane plugin listens for
 * `agent/created`, builds one runtime per root agent, and hangs that
 * runtime's lifecycle off the agent's own context so it dies with the
 * session.
 *
 * Delivery semantics (verified against `dsh-agent-loop`):
 * - agent idle  → `followup()` opens a new turn immediately;
 * - agent busy  → the message parks in the `next-turn` inbox and is claimed
 *   right after the current turn ends (never interrupts, never gets lost);
 * - busy ticks  → at most ONE heartbeat stays pending: the previous one is
 *   replaced in place via `inbox.replace`, so no backlog piles up.
 *
 * Unattended guard (`pauseAfterMissed`):
 * - every delivered beat increments `missedCount`;
 * - a real user message (`source.kind === 'user'`) resets it to zero;
 * - once `missedCount` reaches the configured threshold the runtime pauses
 *   (stops delivering, keeps listening) until the user speaks again, which
 *   resumes it on a fresh interval.
 *
 * @module dsh-plugin-heartbeat/runtime
 */

import { randomUUID } from 'node:crypto'
import { renderPrompt } from './prompt.js'

const MIN_INTERVAL_SECONDS = 30
const MAX_INTERVAL_SECONDS = 86400

/** Normalize a possibly-undefined numeric input into a valid interval. */
export function clampIntervalSeconds(value, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(MAX_INTERVAL_SECONDS, Math.max(MIN_INTERVAL_SECONDS, Math.trunc(number)))
}

/**
 * Build one heartbeat message in the exact shape `dsh-agent-loop` expects
 * for `followup()` — the same shape the harness itself uses in
 * `injectUserContext` (createUserMessage + source kind `plugin`).
 * @param {string} text
 * @returns {{ id: string, role: 'user', content: [{type:'text', text:string}], source: {kind:'plugin', plugin:string} }}
 */
export function buildHeartbeatMessage(text) {
  return {
    id: `hb-${randomUUID()}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'heartbeat' },
  }
}

/**
 * @typedef {object} HeartbeatOptions
 * @property {() => { enabled: boolean, intervalSeconds: number, prompt: string, pauseAfterMissed: number }} readConfig
 *   Resolve the effective config on every tick (settings layer wins over
 *   composition config; hot reload takes effect at the next tick).
 * @property {unknown} logger Optional logger with info/warn methods.
 * @property {object} [agents] Optional live-agent registry for liveness checks.
 */

export class HeartbeatRuntime {
  /**
   * @param {object} agent the live root agent (ReactLoopAgent shape)
   * @param {HeartbeatOptions} options
   */
  constructor(agent, options) {
    this.agent = agent
    this.readConfig = options.readConfig
    this.logger = options.logger
    this.agents = options.agents
    this.timer = undefined
    this.pendingId = undefined
    this.disposed = false
    this.missedCount = 0
    this.paused = false
    this.stopInserted = undefined
  }

  /** Begin the timer chain and subscribe to the agent's inbox feed. */
  start() {
    if (this.disposed) return
    this.stopInserted = this.agent.ctx.on?.('agent/inbox/inserted', ({ message }) => {
      if (message?.source?.kind === 'user') this.onUserInteraction()
    })
    this.arm()
  }

  /** Cancel pending work; the timer chain stops at the next boundary. */
  dispose() {
    this.disposed = true
    this.stopInserted?.()
    this.stopInserted = undefined
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  arm() {
    if (this.disposed) return
    const intervalMs = clampIntervalSeconds(this.readConfig().intervalSeconds, 600) * 1000
    this.timer = setTimeout(() => {
      this.timer = undefined
      try {
        this.tick()
      } catch (error) {
        this.logger?.warn?.(`heartbeat: tick failed for agent "${this.agent.id}": ${error instanceof Error ? error.message : String(error)}`)
      }
      this.arm()
    }, intervalMs)
    // Node timers refuse values above 2^31-1 ms; the clamp above keeps us far below it.
    this.timer.unref?.()
  }

  /** Drop the armed timer and re-arm from the latest config (settings hot-reload). */
  reschedule() {
    if (this.disposed) return
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.arm()
  }

  /**
   * A real user message arrived: reset the missed counter and resume the
   * heartbeat on a fresh interval if the unattended guard had paused it.
   */
  onUserInteraction() {
    if (this.disposed) return
    const wasPaused = this.paused
    this.missedCount = 0
    this.paused = false
    if (wasPaused) {
      this.reschedule()
      this.logger?.info?.(`heartbeat: resumed after user interaction for agent "${this.agent.id}"`)
    }
  }

  tick() {
    if (this.disposed) return
    if (this.agents && this.agents.get(this.agent.id) !== this.agent) {
      this.dispose()
      return
    }
    const config = this.readConfig()
    if (config.enabled === false) return

    // Unattended guard: pause once enough beats went unanswered. 0 disables.
    const pauseAfter = Math.max(0, Math.trunc(Number(config.pauseAfterMissed ?? 3)))
    if (pauseAfter > 0 && this.missedCount >= pauseAfter) {
      if (!this.paused) {
        this.paused = true
        this.logger?.info?.(`heartbeat: paused after ${pauseAfter} missed beats for agent "${this.agent.id}"`)
      }
      return
    }

    const text = renderPrompt(config.prompt || '【心跳】', new Date())
    const message = buildHeartbeatMessage(text)

    const inbox = this.agent.inbox
    const pending = this.pendingId !== undefined ? inbox.locate(this.pendingId) : undefined
    if (pending !== undefined) {
      // Still queued from an earlier tick (agent busy): replace in place so
      // at most one heartbeat is ever pending.
      inbox.replace(this.pendingId, message)
    } else {
      this.agent.followup(message)
    }
    this.pendingId = message.id
    this.missedCount += 1
    this.logger?.info?.(`heartbeat: ${this.agent.status === 'idle' ? 'woke' : 'queued for'} agent "${this.agent.id}" (missed ${this.missedCount})`)
  }
}
