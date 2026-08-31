/**
 * dsh-life-tick runtime + plugin wiring tests.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, Config, name, inject, CONFIG_ROUTE_PATH } from '../lib/index.js'
import { SettingsSchema } from '../lib/schema.js'
import { LifeTickRuntime, buildTickMessage } from '../lib/runtime.js'
import { renderPrompt, PROMPTS } from '../lib/prompt.js'
import { shouldAttach } from '../lib/clock.js'

class FakeInbox {
  constructor() {
    this.state = { 'next-turn': [], 'next-step': [] }
  }
  locate(id) {
    for (const target of ['next-turn', 'next-step']) {
      const index = this.state[target].findIndex((message) => message.id === id)
      if (index >= 0) return { target, index }
    }
    return undefined
  }
  replace(id, message) {
    const location = this.locate(id)
    if (location === undefined) return false
    this.state[location.target][location.index] = message
    return true
  }
  claim(target) {
    return this.state[target].splice(0, this.state[target].length)
  }
}

class FakeAgent {
  constructor(id = 'test-agent', presetId = 'home') {
    this.id = id
    this.presetId = presetId
    this.meta = { agentPreset: presetId }
    this.session = { header: { agentPreset: presetId } }
    this.status = 'idle'
    this.inbox = new FakeInbox()
    this.followed = []
    this._cleanups = []
    this._listeners = new Map()
    this.ctx = {
      effect: (callback) => {
        const raw = callback()
        const cleanup = () => {
          raw?.()
          this._cleanups = this._cleanups.filter((entry) => entry !== cleanup)
        }
        this._cleanups.push(cleanup)
        return cleanup
      },
      on: (event, callback) => {
        const key = Symbol()
        this._listeners.set(key, { event, callback })
        return () => this._listeners.delete(key)
      },
    }
  }
  followup(message) {
    this.followed.push(message)
    this.inbox.state['next-turn'].push(message)
    this.status = 'running'
  }
  emitInserted(message) {
    for (const { event, callback } of [...this._listeners.values()]) {
      if (event === 'agent/inbox/inserted') callback({ message })
    }
  }
  disposeCtx() {
    for (const cleanup of this._cleanups.splice(0)) cleanup?.()
  }
}

const agentRegistry = () => {
  const live = new Map()
  return {
    live,
    roots: () => [...live.values()],
    get: (id) => live.get(id),
    add: (agent) => live.set(agent.id, agent),
    remove: (id) => live.delete(id),
  }
}

const TWO_HOURS = 2 * 3600_000

function config(overrides = {}) {
  return {
    enabled: true,
    timezone: 'America/Sao_Paulo',
    quietStart: 23,
    quietEnd: 8,
    meanDayMin: 45,
    meanNightMin: 180,
    maxWakesPerDay: 8,
    maxVisiblePerDay: 3,
    maxWakesPerHour: 0,
    pauseAfterMissed: 5,
    presetIds: ['home'],
    lifeDir: '/tmp/companion-life-test',
    attachWhenUnknown: false,
    compactBeforeBeat: false,
    prompts: PROMPTS,
    ...overrides,
  }
}

function runtimeFor(agent, overrides = {}, options = {}) {
  const rt = new LifeTickRuntime(agent, {
    readConfig: () => config(overrides),
    delayMs: 60_000,
    forceKind: options.forceKind ?? 'glance',
    now: options.now ?? (() => Date.now()),
    ...options,
  })
  rt.lastHumanAt = Date.now() - TWO_HOURS
  return rt
}

test('plugin metadata survives the loader unwrap', () => {
  assert.equal(apply.name, name)
  assert.deepEqual(apply.inject, inject)
  assert.equal(typeof apply.Config, 'function')
})

test('Config schema applies life-tick defaults', () => {
  const resolved = Config({})
  assert.equal(resolved.enabled, true)
  assert.equal(resolved.timezone, 'America/Sao_Paulo')
  assert.equal(resolved.meanDayMin, 45)
  assert.equal(resolved.pauseAfterMissed, 5)
  assert.deepEqual(resolved.presetIds, ['home'])
  assert.equal(resolved.lifeDir, '~/companion-life')
})

test('SettingsSchema shares the bounds', () => {
  assert.equal(SettingsSchema({}).meanDayMin, 45)
  assert.throws(() => SettingsSchema({ meanDayMin: 0 }))
})

test('renderPrompt substitutes time and lifeDir', () => {
  const text = renderPrompt('at {{time}} in {{lifeDir}}', {
    now: new Date('2026-08-31T15:00:00Z'),
    timeZone: 'UTC',
    lifeDir: '/tmp/life',
  })
  assert.match(text, /in \/tmp\/life/)
  assert.match(text, /31/)
})

test('buildTickMessage has the harness shape', () => {
  const message = buildTickMessage('hi')
  assert.equal(message.role, 'user')
  assert.equal(message.source.kind, 'plugin')
  assert.equal(message.source.plugin, 'life-tick')
  assert.deepEqual(message.content, [{ type: 'text', text: 'hi' }])
  assert.match(message.id, /^lt-/)
})

test('idle glance opens a turn via followup', () => {
  const agent = new FakeAgent()
  const runtime = runtimeFor(agent)
  runtime.tick()
  assert.equal(agent.followed.length, 1)
  assert.equal(agent.followed[0].source.plugin, 'life-tick')
  assert.match(agent.followed[0].content[0].text, /kind=glance/)
})

test('silence kind does not call the model', () => {
  const agent = new FakeAgent()
  const runtime = runtimeFor(agent, {}, { forceKind: 'silence' })
  runtime.tick()
  assert.equal(agent.followed.length, 0)
})

test('busy ticks coalesce: replace, never pile up', () => {
  const agent = new FakeAgent()
  const runtime = runtimeFor(agent)
  runtime.tick()
  runtime.tick()
  runtime.tick()
  assert.equal(agent.followed.length, 1)
  assert.equal(agent.inbox.state['next-turn'].length, 1)
  assert.equal(agent.inbox.state['next-turn'][0].id, runtime.pendingId)
  assert.equal(runtime.missedCount, 1)
  assert.equal(runtime.wakesToday, 1)
})

test('once claimed, the next tick sends a fresh message', () => {
  const agent = new FakeAgent()
  const runtime = runtimeFor(agent)
  runtime.tick()
  agent.inbox.claim('next-turn')
  runtime.tick()
  assert.equal(agent.followed.length, 2)
  assert.notEqual(agent.followed[0].id, agent.followed[1].id)
})

test('disabled config stays silent', () => {
  const agent = new FakeAgent()
  const runtime = runtimeFor(agent, { enabled: false })
  runtime.tick()
  assert.equal(agent.followed.length, 0)
})

test('NO_PING does not count as a visible ping and rolls back missedCount', () => {
  const agent = new FakeAgent()
  const runtime = runtimeFor(agent, { pauseAfterMissed: 1 })
  runtime.start()
  runtime.lastHumanAt = Date.now() - TWO_HOURS
  runtime.tick()
  assert.equal(agent.followed.length, 1)
  assert.equal(runtime.missedCount, 1)
  runtime.onAssistantText('NO_PING')
  assert.equal(runtime.visiblePingsToday, 0)
  assert.equal(runtime.missedCount, 0)
  agent.inbox.claim('next-turn')
  runtime.tick()
  assert.equal(agent.followed.length, 2)
  assert.equal(runtime.paused, false)
  runtime.dispose()
})

test('visible glance counts as missed immediately so pause works without assistant events', () => {
  const agent = new FakeAgent()
  const runtime = runtimeFor(agent, { pauseAfterMissed: 1 })
  runtime.tick()
  assert.equal(runtime.missedCount, 1)
  agent.inbox.claim('next-turn')
  runtime.tick()
  assert.equal(runtime.paused, true)
  assert.equal(agent.followed.length, 1)
})

test('a real visible reply increments visiblePingsToday and can pause', () => {
  const agent = new FakeAgent()
  const runtime = runtimeFor(agent, { pauseAfterMissed: 1 })
  runtime.start()
  runtime.lastHumanAt = Date.now() - TWO_HOURS
  runtime.tick()
  runtime.onAssistantText('hey, thinking of you')
  assert.equal(runtime.visiblePingsToday, 1)
  assert.equal(runtime.missedCount, 1)
  agent.inbox.claim('next-turn')
  runtime.tick()
  assert.equal(runtime.paused, true)
  assert.equal(agent.followed.length, 1)
  runtime.dispose()
})

test('a real user message resumes a paused runtime', () => {
  const agent = new FakeAgent()
  const runtime = runtimeFor(agent, { pauseAfterMissed: 1 })
  runtime.start()
  runtime.lastHumanAt = Date.now() - TWO_HOURS
  runtime.tick()
  runtime.onAssistantText('ping')
  agent.inbox.claim('next-turn')
  runtime.tick()
  assert.equal(runtime.paused, true)
  agent.emitInserted({ id: 'user-1', source: { kind: 'user' } })
  assert.equal(runtime.paused, false)
  assert.equal(runtime.missedCount, 0)
  runtime.lastHumanAt = Date.now() - TWO_HOURS
  runtime.tick()
  assert.equal(agent.followed.length, 2)
  runtime.dispose()
})

test('private kind still delivers but is not visible', () => {
  const agent = new FakeAgent()
  const runtime = runtimeFor(agent, {}, { forceKind: 'private' })
  runtime.tick()
  assert.equal(agent.followed.length, 1)
  assert.match(agent.followed[0].content[0].text, /kind=private/)
  assert.equal(runtime.missedCount, 0)
  runtime.onAssistantText('NO_PING')
  assert.equal(runtime.visiblePingsToday, 0)
})

test('daily visible cap skips further glance/reach', () => {
  const agent = new FakeAgent()
  const runtime = runtimeFor(agent, { maxVisiblePerDay: 1, pauseAfterMissed: 0 })
  runtime.tick()
  runtime.onAssistantText('hello')
  agent.inbox.claim('next-turn')
  runtime.tick()
  assert.equal(agent.followed.length, 1)
})

test('hourly cap skips model wakes', () => {
  const agent = new FakeAgent()
  const runtime = runtimeFor(agent, { maxWakesPerHour: 2, pauseAfterMissed: 0, maxVisiblePerDay: 10 })
  runtime.tick()
  agent.inbox.claim('next-turn')
  runtime.awaitingReply = false
  runtime.tick()
  agent.inbox.claim('next-turn')
  runtime.awaitingReply = false
  runtime.tick()
  assert.equal(agent.followed.length, 2)
  assert.equal(runtime.paused, false)
})

test('dead agent stops the runtime', () => {
  const registry = agentRegistry()
  const agent = new FakeAgent()
  registry.add(agent)
  const runtime = runtimeFor(agent, {}, { agents: registry })
  registry.remove(agent.id)
  runtime.tick()
  assert.equal(agent.followed.length, 0)
  assert.equal(runtime.disposed, true)
})

test('timer chain fires after delayMs override', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const agent = new FakeAgent()
  const runtime = runtimeFor(agent, {}, { delayMs: 60_000 })
  runtime.start()
  runtime.lastHumanAt = Date.now() - TWO_HOURS
  t.mock.timers.tick(60_000)
  assert.equal(agent.followed.length, 1)
  runtime.dispose()
})

test('dispose cancels the armed timer', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const agent = new FakeAgent()
  const runtime = runtimeFor(agent, {}, { delayMs: 60_000 })
  runtime.start()
  runtime.dispose()
  t.mock.timers.tick(10 * 3600_000)
  assert.equal(agent.followed.length, 0)
})

test('apply attaches only home roots, skips work', async () => {
  const listeners = new Map()
  const registry = agentRegistry()
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    agents: registry,
    on: (event, callback) => {
      const key = Symbol()
      listeners.set(key, { event, callback })
      return () => listeners.delete(key)
    },
    effect: (callback) => {
      const cleanup = callback()
      return cleanup
    },
    inject: () => {},
  }
  const dispose = apply(ctx, { configFile: `/tmp/lt-test-${Date.now()}.json` })

  const home = new FakeAgent('root-home', 'home')
  registry.add(home)
  for (const { event, callback } of [...listeners.values()]) {
    if (event === 'agent/created') callback({ agent: home })
  }
  assert.equal(home._cleanups.length, 1)

  const work = new FakeAgent('root-work', 'work')
  registry.add(work)
  for (const { event, callback } of [...listeners.values()]) {
    if (event === 'agent/created') callback({ agent: work })
  }
  assert.equal(work._cleanups.length, 0)
  assert.equal(shouldAttach(work, ['home']), false)

  const sub = new FakeAgent('sub-1', 'home')
  registry.add(sub)
  registry.roots = () => [home, work]
  for (const { event, callback } of [...listeners.values()]) {
    if (event === 'agent/created') callback({ agent: sub })
  }
  assert.equal(sub._cleanups.length, 0)

  await dispose()
})

test('apply registers the config route on the web server', () => {
  const routes = new Map()
  const injected = []
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    agents: agentRegistry(),
    on: () => () => {},
    effect: () => () => {},
    inject: (deps, callback) => injected.push({ deps, callback }),
  }
  const dispose = apply(ctx, {})
  const web = injected.find(({ deps }) => deps[0] === 'webServer')
  assert.ok(web, 'webServer injection registered')
  const injectedCtx = {
    webServer: {
      register: (route) => {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    },
    effect: () => () => {},
  }
  web.callback(injectedCtx)
  assert.equal(routes.has(CONFIG_ROUTE_PATH), true)
  assert.equal(CONFIG_ROUTE_PATH, '/api/life-tick/config')
  dispose()
})

test('config route GET/POST', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const file = path.join(os.tmpdir(), `lt-test-${Date.now()}.json`)
  const { LifeTickConfigStore } = await import('../lib/store.js')
  const store = new LifeTickConfigStore({ path: file, base: { meanDayMin: 40 } })
  assert.equal(store.get().meanDayMin, 40)
  store.update({ meanDayMin: 50, presetIds: 'home, lounge' })
  assert.equal(store.get().meanDayMin, 50)
  assert.deepEqual(store.get().presetIds, ['home', 'lounge'])
  assert.throws(() => store.update({ meanDayMin: 0 }))
  const reloaded = new LifeTickConfigStore({ path: file })
  assert.equal(reloaded.get().meanDayMin, 50)
  fs.rmSync(file, { force: true })
})

test('pre-tick compaction runs for an idle agent when available', async () => {
  const agent = new FakeAgent()
  const calls = []
  const compaction = { compactNow: async () => { calls.push('compact'); return { ok: true } } }
  const runtime = runtimeFor(agent, { compactBeforeBeat: true }, { getCompaction: () => compaction })
  await runtime.tick()
  assert.deepEqual(calls, ['compact'])
  assert.equal(agent.followed.length, 1)
})

test('pre-tick compaction failure never blocks the wake', async () => {
  const agent = new FakeAgent()
  const compaction = { compactNow: async () => { throw new Error('boom') } }
  const runtime = runtimeFor(agent, { compactBeforeBeat: true }, {
    getCompaction: () => compaction,
    logger: { info: () => {}, warn: () => {} },
  })
  await runtime.tick()
  assert.equal(agent.followed.length, 1)
})

test('client loader id matches package name', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const file = fs.readFileSync(path.join(import.meta.dirname, '../lib/client.js'), 'utf8')
  assert.match(file, /id: 'dsh-life-tick'/)
  assert.doesNotMatch(file, /id: 'dsh-plugin-heartbeat'/)
})
