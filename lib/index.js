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
 * | `pauseAfterMissed` | `3` | pause after N unanswered beats; a real user message resumes (0 = off) |
 *
 * The user-facing fields live in `<dshHome>/heartbeat.json`, served to the
 * browser through the plugin's own HTTP route — the settings wire only
 * serves a hard-coded namespace allowlist, so a plugin namespace is never
 * remotely writable (see `lib/store.js`).
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
import { HeartbeatConfigStore } from './store.js'
import { DEFAULT_PROMPT, renderPrompt } from './prompt.js'

export const name = 'heartbeat'

/** Services required before the plugin can start observing agents. */
export const inject = ['agents']

/** Schemastery schema applied to the plugin config before startup. */
export const Config = z.object({
  enabled: z.boolean().default(true),
  intervalSeconds: z.number().min(30).max(86400).default(600),
  prompt: z.string().default(DEFAULT_PROMPT),
  pauseAfterMissed: z.number().min(0).max(100).default(3),
  configFile: z.union([z.string(), z.const(undefined)]),
})

export const CONFIG_ROUTE_PATH = '/api/heartbeat/config'

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

  // Single user-facing config source: composition defaults + heartbeat.json.
  const store = new HeartbeatConfigStore({
    path: typeof config.configFile === 'string' && config.configFile.length > 0 ? config.configFile : undefined,
    base: {
      enabled: config.enabled !== false,
      intervalSeconds: clampIntervalSeconds(config.intervalSeconds, 600),
      pauseAfterMissed: Math.max(0, Math.trunc(Number(config.pauseAfterMissed ?? 3))),
    },
  })

  const readConfig = () => {
    const resolved = store.get()
    return {
      enabled: resolved.enabled,
      intervalSeconds: clampIntervalSeconds(resolved.intervalSeconds, 600),
      prompt: typeof config.prompt === 'string' && config.prompt.length > 0 ? config.prompt : DEFAULT_PROMPT,
      pauseAfterMissed: Math.max(0, Math.trunc(Number(resolved.pauseAfterMissed ?? 3))),
    }
  }

  // Config hot-apply: any store change re-arms every runtime immediately.
  ctx.effect(() => {
    const unwatch = store.watch(() => {
      for (const entry of runtimes.values()) entry.runtime.reschedule()
    })
    return () => {
      unwatch()
    }
  }, 'heartbeat.store-watch()')

  // Browser config route (optional: headless deployments have no webServer).
  ctx.inject(['webServer'], (webCtx) => {
    const disposeRoute = webCtx.webServer.register({
      kind: 'exact',
      path: CONFIG_ROUTE_PATH,
      handler: async (req, res) => {
        try {
          if (req.method === 'GET') {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify(store.get()))
            return
          }
          if (req.method === 'POST') {
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            const body = Buffer.concat(chunks).toString('utf8')
            let patch
            try {
              patch = JSON.parse(body)
            } catch {
              res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ error: 'body must be JSON' }))
              return
            }
            const next = store.update(patch)
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify(next))
            return
          }
          res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: 'method not allowed' }))
        } catch (error) {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        }
      },
    })
    webCtx.effect(() => disposeRoute, 'heartbeat.config-route()')
    ctx.logger?.info(`heartbeat: config route at ${CONFIG_ROUTE_PATH} (store ${store.path})`)
  })

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

export { HeartbeatRuntime, buildHeartbeatMessage, clampIntervalSeconds, renderPrompt, HeartbeatConfigStore, DEFAULT_PROMPT }
