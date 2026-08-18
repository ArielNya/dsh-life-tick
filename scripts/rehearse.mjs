/**
 * Pre-flight rehearsal: load the plugin EXACTLY as the profile will —
 * from the profile's own node_modules copy — and drive apply() through a
 * realistic mock context, then fire one heartbeat tick through a fake
 * agent to verify the followup/inbox wiring end to end.
 *
 * Run: node scripts/rehearse.mjs
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const profileDir = '/Users/crazy/.dsh/profiles/desktop'
const packagePath = require.resolve('dsh-plugin-heartbeat/package.json', { paths: [profileDir] })
const packageJson = require(packagePath)
const entryUrl = packagePath.replace(/package\.json$/, packageJson.exports['.'].default)
const plugin = await import(entryUrl)

console.log(`loaded ${packageJson.name}@${packageJson.version} from ${packagePath}`)

// ── loader-shape assertions ──────────────────────────────────────────────
const apply = plugin.default ?? plugin.apply
if (typeof apply !== 'function') throw new Error('default export is not callable')
if (apply.name !== plugin.name) throw new Error(`metadata lost: ${apply.name} !== ${plugin.name}`)
if (!Array.isArray(apply.inject) || apply.inject[0] !== 'agents') throw new Error('inject metadata lost')
if (typeof apply.Config !== 'function') throw new Error('Config schema lost')

// ── mock runtime ─────────────────────────────────────────────────────────
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
}
class FakeAgent {
  constructor(id) {
    this.id = id
    this.status = 'idle'
    this.inbox = new FakeInbox()
    this.followed = []
    this.ctx = {
      effect: (callback) => {
        const cleanup = callback()
        return () => cleanup?.()
      },
    }
  }
  followup(message) {
    this.followed.push(message)
    this.inbox.state['next-turn'].push(message)
    this.status = 'running'
  }
}

const registrations = []
const registry = {
  live: new Map(),
  roots() {
    return [...this.live.values()]
  },
  get(id) {
    return this.live.get(id)
  },
}
const ctx = {
  logger: { info: (...a) => console.log('  [log]', ...a), warn: (...a) => console.log('  [warn]', ...a) },
  agents: registry,
  on: () => () => {},
  effect: () => () => {},
  inject: (deps, callback) => {
    if (deps.includes('settings')) {
      callback({
        settings: {
          register: (ns, schema, options) => {
            registrations.push({ ns, base: options.base })
            return { get: () => ({ ...options.base }), watch: () => () => {}, update: async () => {}, replace: async () => {} }
          },
        },
        effect: () => () => {},
      })
    }
  },
}

console.log('applying plugin (mock ctx)…')
apply(ctx, { intervalSeconds: 600 })

// The real plugin subscribes to agent/created; the mock on() swallowed the
// listener, so drive the runtime path directly through a second apply with
// a listener-capturing ctx.
const listeners = new Map()
const ctx2 = {
  logger: { info: () => {}, warn: (m) => console.log('  [warn]', m) },
  agents: registry,
  on: (event, callback) => {
    listeners.set(event, callback)
    return () => listeners.delete(event)
  },
  effect: (callback) => callback(),
  inject: () => {},
}
apply(ctx2, { intervalSeconds: 60 })

const agent = new FakeAgent('rehearsal-agent')
registry.live.set(agent.id, agent)
listeners.get('agent/created')({ agent })

console.log('settings registered:', registrations.map((r) => `${r.ns}=${JSON.stringify(r.base)}`).join(', '))

// Trigger the attached runtime's timer callback manually through its tick —
// simulate one interval elapsing by reaching into the runtime via a fresh
// HeartbeatRuntime instance (the plugin does not expose the runtime map).
const { HeartbeatRuntime } = await import(entryUrl)
const runtime = new HeartbeatRuntime(agent, {
  readConfig: () => ({ enabled: true, intervalSeconds: 60, prompt: '【心跳】{{time}}' }),
  agents: registry,
})
runtime.tick()
const message = agent.followed[0]
if (!message) throw new Error('no heartbeat message delivered')
if (message.role !== 'user' || message.source.kind !== 'plugin' || message.source.plugin !== 'heartbeat') {
  throw new Error(`bad message shape: ${JSON.stringify({ role: message.role, source: message.source })}`)
}
console.log('heartbeat delivered:', JSON.stringify(message.content[0].text).slice(0, 80), '…')
runtime.dispose()

console.log('✔ pre-flight rehearsal passed')
