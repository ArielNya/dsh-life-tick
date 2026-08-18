/**
 * dsh-plugin-heartbeat unit tests.
 *
 * Run with `node --test test/`.
 */
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { apply, Config, SettingsSchema, name, inject } from '../lib/index.js'
import { HeartbeatRuntime, buildHeartbeatMessage, clampIntervalSeconds } from '../lib/runtime.js'
import { renderPrompt, DEFAULT_PROMPT, SETTINGS_NAMESPACE } from '../lib/prompt.js'

// ── fakes ──────────────────────────────────────────────────────────────────

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
  constructor(id = 'test-agent') {
    this.id = id
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
  /** Fire a synthetic agent/inbox/inserted payload into the agent listeners. */
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

// ── schema / helpers ───────────────────────────────────────────────────────

test('plugin metadata survives the loader unwrap', () => {
  assert.equal(apply.name, name)
  assert.deepEqual(apply.inject, inject)
  assert.equal(typeof apply.Config, 'function')
})

test('Config schema applies defaults and bounds', () => {
  const resolved = Config({})
  assert.equal(resolved.enabled, true)
  assert.equal(resolved.intervalSeconds, 600)
  assert.equal(resolved.prompt, DEFAULT_PROMPT)
  assert.equal(resolved.settingsUi, true)
  assert.throws(() => Config({ intervalSeconds: 5 }))
  assert.throws(() => Config({ intervalSeconds: 90000 }))
})

test('SettingsSchema shares the bounds', () => {
  assert.equal(SettingsSchema({}).intervalSeconds, 600)
  assert.throws(() => SettingsSchema({ intervalSeconds: 0 }))
})

test('clampIntervalSeconds enforces 30–86400', () => {
  assert.equal(clampIntervalSeconds(undefined, 600), 600)
  assert.equal(clampIntervalSeconds(5, 600), 30)
  assert.equal(clampIntervalSeconds(999999, 600), 86400)
  assert.equal(clampIntervalSeconds(120.9, 600), 120)
  assert.equal(clampIntervalSeconds('90', 600), 90)
})

test('renderPrompt substitutes {{time}}', () => {
  const text = renderPrompt('now: {{time}}', new Date('2026-08-18T12:00:00'))
  assert.equal(text, 'now: 2026/8/18 12:00:00')
})

test('buildHeartbeatMessage has the harness shape', () => {
  const message = buildHeartbeatMessage('hi')
  assert.equal(message.role, 'user')
  assert.equal(message.source.kind, 'plugin')
  assert.equal(message.source.plugin, 'heartbeat')
  assert.deepEqual(message.content, [{ type: 'text', text: 'hi' }])
  assert.match(message.id, /^hb-/)
})

// ── runtime: delivery semantics ────────────────────────────────────────────

const config = (overrides = {}) => ({
  enabled: true,
  intervalSeconds: 600,
  prompt: 'beat {{time}}',
  pauseAfterMissed: 3,
  ...overrides,
})

test('idle tick opens a turn via followup', () => {
  const agent = new FakeAgent()
  const runtime = new HeartbeatRuntime(agent, { readConfig: () => config() })
  runtime.tick()
  assert.equal(agent.followed.length, 1)
  const message = agent.followed[0]
  assert.equal(message.role, 'user')
  assert.equal(message.source.kind, 'plugin')
  assert.match(message.content[0].text, /beat /)
})

test('busy ticks coalesce: replace, never pile up', () => {
  const agent = new FakeAgent()
  const runtime = new HeartbeatRuntime(agent, { readConfig: () => config() })
  runtime.tick() // queued; agent busy
  runtime.tick() // still pending → replace
  runtime.tick()
  assert.equal(agent.followed.length, 1)
  assert.equal(agent.inbox.state['next-turn'].length, 1)
  assert.equal(agent.inbox.state['next-turn'][0].id, runtime.pendingId)
})

test('once claimed, the next tick sends a fresh heartbeat', () => {
  const agent = new FakeAgent()
  const runtime = new HeartbeatRuntime(agent, { readConfig: () => config() })
  runtime.tick()
  agent.inbox.claim('next-turn') // the loop consumed it
  runtime.tick()
  assert.equal(agent.followed.length, 2)
  assert.notEqual(agent.followed[0].id, agent.followed[1].id)
})

test('disabled config stays silent', () => {
  const agent = new FakeAgent()
  const runtime = new HeartbeatRuntime(agent, { readConfig: () => config({ enabled: false }) })
  runtime.tick()
  assert.equal(agent.followed.length, 0)
})

// ── unattended guard ────────────────────────────────────────────────────────

test('pauses after pauseAfterMissed unanswered beats', () => {
  const agent = new FakeAgent()
  const runtime = new HeartbeatRuntime(agent, { readConfig: () => config({ pauseAfterMissed: 3 }) })
  runtime.tick()
  agent.inbox.claim('next-turn')
  runtime.tick()
  agent.inbox.claim('next-turn')
  runtime.tick() // third beat delivered, still no reply
  assert.equal(agent.followed.length, 3)
  agent.inbox.claim('next-turn')
  runtime.tick() // fourth tick: guard trips, stays silent
  assert.equal(agent.followed.length, 3)
  assert.equal(runtime.paused, true)
  runtime.tick()
  assert.equal(agent.followed.length, 3)
})

test('a real user message resumes a paused runtime', () => {
  const agent = new FakeAgent()
  const runtime = new HeartbeatRuntime(agent, { readConfig: () => config({ pauseAfterMissed: 2 }) })
  runtime.start()
  runtime.tick()
  agent.inbox.claim('next-turn')
  runtime.tick() // missedCount = 2
  agent.inbox.claim('next-turn')
  runtime.tick() // paused
  assert.equal(agent.followed.length, 2)
  assert.equal(runtime.paused, true)
  agent.emitInserted({ id: 'user-1', source: { kind: 'user' } })
  assert.equal(runtime.paused, false)
  assert.equal(runtime.missedCount, 0)
  runtime.tick()
  assert.equal(agent.followed.length, 3)
  runtime.dispose()
})

test('non-user inbox messages do not reset the guard', () => {
  const agent = new FakeAgent()
  const runtime = new HeartbeatRuntime(agent, { readConfig: () => config({ pauseAfterMissed: 2 }) })
  runtime.start()
  runtime.tick()
  agent.inbox.claim('next-turn')
  runtime.tick()
  agent.inbox.claim('next-turn')
  agent.emitInserted({ id: 'hb-1', source: { kind: 'plugin', plugin: 'heartbeat' } })
  runtime.tick() // still trips despite the plugin message
  assert.equal(runtime.paused, true)
  assert.equal(agent.followed.length, 2)
  runtime.dispose()
})

test('a user message before the threshold resets the counter', () => {
  const agent = new FakeAgent()
  const runtime = new HeartbeatRuntime(agent, { readConfig: () => config({ pauseAfterMissed: 3 }) })
  runtime.start()
  for (let i = 0; i < 5; i += 1) {
    runtime.tick()
    agent.inbox.claim('next-turn')
    if (i % 2 === 1) agent.emitInserted({ id: `user-${i}`, source: { kind: 'user' } })
  }
  assert.equal(runtime.paused, false)
  assert.equal(agent.followed.length, 5)
  runtime.dispose()
})

test('pauseAfterMissed: 0 disables the guard entirely', () => {
  const agent = new FakeAgent()
  const runtime = new HeartbeatRuntime(agent, { readConfig: () => config({ pauseAfterMissed: 0 }) })
  for (let i = 0; i < 8; i += 1) {
    runtime.tick()
    agent.inbox.claim('next-turn')
  }
  assert.equal(runtime.paused, false)
  assert.equal(agent.followed.length, 8)
})

test('tick re-reads config every time (hot reload)', () => {
  const agent = new FakeAgent()
  const state = { enabled: true }
  const runtime = new HeartbeatRuntime(agent, { readConfig: () => config(state) })
  runtime.tick()
  state.enabled = false
  runtime.tick()
  assert.equal(agent.followed.length, 1)
})

test('dead agent stops the runtime', () => {
  const registry = agentRegistry()
  const agent = new FakeAgent()
  registry.add(agent)
  const runtime = new HeartbeatRuntime(agent, {
    readConfig: () => config(),
    agents: registry,
  })
  registry.remove(agent.id)
  runtime.tick()
  assert.equal(agent.followed.length, 0)
  assert.equal(runtime.disposed, true)
})

test('timer chain re-arms from the latest config', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const agent = new FakeAgent()
  const state = { enabled: true, intervalSeconds: 600 }
  const runtime = new HeartbeatRuntime(agent, { readConfig: () => config(state) })
  runtime.start() // t=0, armed for 600s
  state.intervalSeconds = 1200 // change before the first fire
  t.mock.timers.tick(600_000) // t=600: fire #1, re-arm for t=1800
  assert.equal(agent.followed.length, 1)
  agent.inbox.claim('next-turn') // the loop consumed the first beat
  t.mock.timers.tick(600_000) // t=1200: half of the new interval — silent
  assert.equal(agent.followed.length, 1)
  t.mock.timers.tick(600_000) // t=1800: fire #2
  assert.equal(agent.followed.length, 2)
  runtime.dispose()
  t.mock.timers.tick(24 * 3600_000)
  assert.equal(agent.followed.length, 2)
})

test('reschedule re-arms immediately from the latest config', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const agent = new FakeAgent()
  const state = { enabled: true, intervalSeconds: 600 }
  const runtime = new HeartbeatRuntime(agent, { readConfig: () => config(state) })
  runtime.start() // fire at t=600s
  t.mock.timers.tick(100_000) // t=100s
  state.intervalSeconds = 120
  runtime.reschedule() // next fire moves to t=220s
  t.mock.timers.tick(120_000)
  assert.equal(agent.followed.length, 1)
  runtime.dispose()
})

test('dispose cancels the armed timer', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const agent = new FakeAgent()
  const runtime = new HeartbeatRuntime(agent, { readConfig: () => config() })
  runtime.start()
  runtime.dispose()
  t.mock.timers.tick(10 * 3600_000)
  assert.equal(agent.followed.length, 0)
})

// ── plugin wiring ──────────────────────────────────────────────────────────

test('apply attaches a runtime to each root agent and cleans up', async () => {
  const listeners = new Map()
  const effects = []
  const registry = agentRegistry()
  const logger = { info: () => {}, warn: () => {} }
  const ctx = {
    logger,
    agents: registry,
    on: (event, callback) => {
      const key = Symbol()
      listeners.set(key, { event, callback })
      return () => listeners.delete(key)
    },
    effect: (callback) => {
      const cleanup = callback()
      effects.push(cleanup)
      return cleanup
    },
    inject: () => {},
  }
  const dispose = apply(ctx, { intervalSeconds: 600 })

  const agent = new FakeAgent('root-1')
  registry.add(agent)
  for (const { event, callback } of [...listeners.values()]) {
    if (event !== 'agent/created') continue
    callback({ agent })
  }
  // runtime attached through the agent ctx effect
  assert.equal(agent._cleanups.length, 1)

  // a subagent (not a root) must be ignored — simulated by adding a second
  // agent but marking roots to exclude it:
  const sub = new FakeAgent('sub-1')
  registry.add(sub)
  registry.roots = () => [agent]
  for (const { event, callback } of [...listeners.values()]) {
    if (event !== 'agent/created') continue
    callback({ agent: sub })
  }
  assert.equal(sub._cleanups.length, 0)

  const undone = await dispose()
  assert.equal(undone, undefined)
  assert.equal(agent._cleanups.length, 0)
  assert.equal(listeners.size, 0)
})

test('apply registers the heartbeat settings namespace when available', () => {
  const registrations = new Map()
  const settings = {
    register: (ns, schema, options) => {
      const scope = {
        get: () => ({ ...options.base }),
        watch: () => () => {},
        update: () => Promise.resolve(),
        replace: () => Promise.resolve(),
      }
      registrations.set(ns, { schema, options, scope })
      return scope
    },
  }
  const injected = []
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    agents: agentRegistry(),
    on: () => () => {},
    effect: () => () => {},
    inject: (deps, callback) => injected.push({ deps, callback }),
  }
  const dispose = apply(ctx, { intervalSeconds: 900 })
  assert.equal(injected.length, 1)
  const { callback } = injected[0]
  const injectedCtx = {
    settings,
    effect: (cb) => {
      const cleanup = cb()
      cleanup?.()
      return () => {}
    },
  }
  callback(injectedCtx)
  assert.equal(registrations.has(SETTINGS_NAMESPACE), true)
  const registration = registrations.get(SETTINGS_NAMESPACE)
  assert.equal(registration.options.base.intervalSeconds, 900)
  assert.equal(registration.scope.get().intervalSeconds, 900)
  dispose()
})

test('settingsUi: false skips the settings namespace', () => {
  const injected = []
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    agents: agentRegistry(),
    on: () => () => {},
    effect: () => () => {},
    inject: (_deps, callback) => injected.push(callback),
  }
  apply(ctx, { settingsUi: false })
  assert.equal(injected.length, 1)
  injected[0]({ effect: () => () => {}, settings: { register: () => { throw new Error('must not register') } } })
})
