/**
 * dsh-life-tick — irregular, mostly-invisible companion wakes for DSH.
 *
 * Host-plane Cordis plugin. Listens for `agent/created`, attaches a Poisson
 * timer to matching **root** agents (default: preset `home` only). Each fire
 * either stays silent, writes a private file, or injects a typed followup.
 * `NO_PING` replies are not counted as visible pings.
 *
 * @module dsh-life-tick
 */

import z from '@deepseek-ai/schemastery'
import { LifeTickRuntime, buildTickMessage, clampIntervalSeconds } from './runtime.js'
import { LifeTickConfigStore } from './store.js'
import { DEFAULT_PROMPT, PROMPTS, renderPrompt } from './prompt.js'
import { shouldAttach, parsePresetIds } from './clock.js'

export const name = 'life-tick'

export const inject = ['agents']

export const Config = z.object({
  enabled: z.boolean().default(true),
  timezone: z.string().default('America/Sao_Paulo'),
  quietStart: z.number().min(0).max(23).default(23),
  quietEnd: z.number().min(0).max(23).default(8),
  meanDayMin: z.number().min(1).max(720).default(45),
  meanNightMin: z.number().min(1).max(720).default(180),
  maxWakesPerDay: z.number().min(0).max(100).default(8),
  maxVisiblePerDay: z.number().min(0).max(50).default(3),
  maxWakesPerHour: z.number().min(0).max(100).default(2),
  pauseAfterMissed: z.number().min(0).max(100).default(5),
  presetIds: z.array(z.string()).default(['home']),
  lifeDir: z.string().default('~/companion-life'),
  attachWhenUnknown: z.boolean().default(false),
  prompt: z.string().default(DEFAULT_PROMPT),
  configFile: z.union([z.string(), z.const(undefined)]),
  compactBeforeBeat: z.boolean().default(true),
})

export const CONFIG_ROUTE_PATH = '/api/life-tick/config'

export function apply(ctx, config = {}) {
  const runtimes = new Map()
  let stopping = false

  const store = new LifeTickConfigStore({
    path: typeof config.configFile === 'string' && config.configFile.length > 0 ? config.configFile : undefined,
    base: {
      enabled: config.enabled !== false,
      timezone: config.timezone,
      quietStart: config.quietStart,
      quietEnd: config.quietEnd,
      meanDayMin: config.meanDayMin,
      meanNightMin: config.meanNightMin,
      maxWakesPerDay: config.maxWakesPerDay,
      maxVisiblePerDay: config.maxVisiblePerDay,
      maxWakesPerHour: config.maxWakesPerHour,
      pauseAfterMissed: config.pauseAfterMissed,
      presetIds: config.presetIds,
      lifeDir: config.lifeDir,
      attachWhenUnknown: config.attachWhenUnknown,
    },
  })

  const readConfig = () => {
    const resolved = store.get()
    return {
      ...resolved,
      prompt: typeof config.prompt === 'string' && config.prompt.length > 0 ? config.prompt : DEFAULT_PROMPT,
      prompts: PROMPTS,
      compactBeforeBeat: config.compactBeforeBeat !== false,
    }
  }

  let compaction
  ctx.inject(['compaction'], (compactionCtx) => {
    compaction = compactionCtx.compaction
  })

  ctx.effect(() => {
    const unwatch = store.watch(() => {
      for (const entry of runtimes.values()) entry.runtime.reschedule()
    })
    return () => {
      unwatch()
    }
  }, 'life-tick.store-watch()')

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
            if (patch && typeof patch.presetIds === 'string') patch.presetIds = parsePresetIds(patch.presetIds)
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
    webCtx.effect(() => disposeRoute, 'life-tick.config-route()')
    ctx.logger?.info(`life-tick: config route at ${CONFIG_ROUTE_PATH} (store ${store.path})`)
  })

  return ctx.effect(() => {
    const stopCreated = ctx.on('agent/created', ({ agent }) => {
      if (stopping || runtimes.has(agent) || !ctx.agents.roots().includes(agent)) return
      const resolved = readConfig()
      if (!shouldAttach(agent, resolved.presetIds, resolved.attachWhenUnknown)) {
        ctx.logger?.info(`life-tick: skip agent "${agent.id}" (preset not in [${resolved.presetIds.join(', ')}])`)
        return
      }
      const runtime = new LifeTickRuntime(agent, {
        readConfig,
        getCompaction: () => compaction,
        logger: ctx.logger,
        agents: ctx.agents,
      })
      const cleanup = agent.ctx.effect(() => {
        runtime.start()
        return () => {
          runtime.dispose()
        }
      }, 'life-tick.runtime()')
      runtimes.set(agent, { runtime, cleanup })
      ctx.logger?.info(`life-tick: attached to root agent "${agent.id}"`)
    })
    return async () => {
      stopping = true
      stopCreated()
      const entries = [...runtimes.values()]
      runtimes.clear()
      await Promise.allSettled(entries.map((entry) => Promise.resolve(entry.cleanup())))
    }
  }, 'life-tick.lifecycle()')
}

Object.defineProperties(apply, {
  name: { value: name },
  inject: { value: inject },
  Config: { value: Config },
})

export default apply

export {
  LifeTickRuntime,
  LifeTickRuntime as HeartbeatRuntime,
  buildTickMessage,
  buildTickMessage as buildHeartbeatMessage,
  clampIntervalSeconds,
  renderPrompt,
  LifeTickConfigStore,
  LifeTickConfigStore as HeartbeatConfigStore,
  DEFAULT_PROMPT,
  PROMPTS,
}
