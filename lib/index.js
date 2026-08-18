/**
 * dsh-plugin-heartbeat — proactive wake-ups for DeepSeek Harness agents.
 *
 * ## What it does
 *
 * A host-plane Cordis plugin that listens for `agent/created` and attaches a
 * per-session timer to every ROOT agent (subagents are skipped). On each
 * tick the agent receives a synthetic user-role message (source kind
 * `plugin`) through `agent.followup()`:
 *
 * - idle → a fresh turn opens immediately, so the agent proactively reports
 *   progress, risks, blockers, or just says hi;
 * - busy → the heartbeat parks in the `next-turn` inbox and is delivered
 *   right after the current turn ends — it never interrupts running work
 *   and never gets lost;
 * - consecutive busy ticks replace the queued heartbeat in place, so at
 *   most one is ever pending.
 *
 * ## Config
 *
 * | key | default | meaning |
 * |---|---|---|
 * | `enabled` | `true` | master switch for every session |
 * | `intervalSeconds` | `600` | heartbeat period (clamped to 30–86400) |
 * | `prompt` | built-in | instruction template delivered on each beat (`{{time}}` is substituted) |
 * | `settingsUi` | `true` | also register the `heartbeat` settings namespace so `enabled` / `intervalSeconds` appear in the Settings panel and can be edited live |
 *
 * ## Install
 *
 * ```sh
 * pnpm add dsh-plugin-heartbeat
 * ```
 *
 * Then add a row to your profile `cordis.patch.yml`:
 *
 * ```yaml
 * - insert:
 *     - id: dsh-heartbeat
 *       name: dsh-plugin-heartbeat
 *       config:
 *         intervalSeconds: 600
 * ```
 *
 * @module dsh-plugin-heartbeat
 */

import z from '@deepseek-ai/schemastery'
import { HeartbeatRuntime, buildHeartbeatMessage, clampIntervalSeconds } from './runtime.js'
import { DEFAULT_PROMPT, renderPrompt, SETTINGS_NAMESPACE } from './prompt.js'

export const name = 'heartbeat'

/** Services required before the plugin can start observing agents. */
export const inject = ['agents']

/** Schemastery schema applied to the plugin config before startup. */
export const Config = z.object({
  enabled: z.boolean().default(true),
  intervalSeconds: z.number().min(30).max(86400).default(600),
  prompt: z.string().default(DEFAULT_PROMPT),
  settingsUi: z.boolean().default(true),
})

/** The user-facing settings schema: composition config is the base layer. */
export const SettingsSchema = z.object({
  enabled: z.boolean().default(true),
  intervalSeconds: z.number().min(30).max(86400).default(600),
})

/**
 * Cordis plugin entry.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {import('../types/index.d.ts').HeartbeatConfig} config
 * @returns {() => void} disposer
 */
export function apply(ctx, config = {}) {
  const runtimes = new Map()
  let stopping = false

  // Optional settings surface: the resolved value (composition base + user
  // layer) feeds every tick, so edits in the Settings panel hot-apply.
  let settingsScope
  ctx.inject(['settings'], (settingsCtx) => {
    if (config.settingsUi === false) return
    settingsScope = settingsCtx.settings.register(SETTINGS_NAMESPACE, SettingsSchema, {
      base: {
        enabled: config.enabled !== false,
        intervalSeconds: clampIntervalSeconds(config.intervalSeconds, 600),
      },
    })
    settingsCtx.effect(() => () => {
      settingsScope = undefined
    }, 'heartbeat.settings()')
  })

  const readConfig = () => {
    const resolved = settingsScope?.get()
    return {
      enabled: resolved?.enabled ?? config.enabled !== false,
      intervalSeconds: clampIntervalSeconds(resolved?.intervalSeconds ?? config.intervalSeconds, 600),
      prompt: typeof config.prompt === 'string' && config.prompt.length > 0 ? config.prompt : DEFAULT_PROMPT,
    }
  }

  // 设置面板热改：任一 heartbeat 设置变化 → 所有 runtime 立即按新配置重排
  ctx.effect(() => {
    const unwatch = settingsScope?.watch(() => {
      for (const entry of runtimes.values()) entry.runtime.reschedule()
    })
    return () => {
      unwatch?.()
    }
  }, 'heartbeat.settings-watch()')

  return ctx.effect(() => {
    const stopCreated = ctx.on('agent/created', ({ agent }) => {
      if (stopping || runtimes.has(agent) || !ctx.agents.roots().includes(agent)) return
      const runtime = new HeartbeatRuntime(agent, {
        readConfig,
        logger: ctx.logger,
        agents: ctx.agents,
      })
      const cleanup = agent.ctx.effect(() => {
        runtime.start()
        return () => {
          runtime.dispose()
        }
      }, 'heartbeat.runtime()')
      runtimes.set(agent, { runtime, cleanup })
      ctx.logger?.info(`heartbeat: attached to root agent "${agent.id}" (interval ${readConfig().intervalSeconds}s)`)
    })
    return async () => {
      stopping = true
      stopCreated()
      const entries = [...runtimes.values()]
      runtimes.clear()
      await Promise.allSettled(entries.map((entry) => Promise.resolve(entry.cleanup())))
    }
  }, 'heartbeat.lifecycle()')
}

// DSH's loader unwraps a package's default export before it starts the
// Cordis plugin. Keep the default export callable for direct consumers, but
// attach the Cordis metadata to that function so injected services and the
// config schema survive the unwrap step.
Object.defineProperties(apply, {
  name: { value: name },
  inject: { value: inject },
  Config: { value: Config },
})

export default apply

export { HeartbeatRuntime, buildHeartbeatMessage, clampIntervalSeconds, renderPrompt, DEFAULT_PROMPT, SETTINGS_NAMESPACE }
