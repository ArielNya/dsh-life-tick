/**
 * Pre-flight rehearsal against a profile-installed copy.
 * Run: node scripts/rehearse.mjs
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const profileDir = process.env.DSH_PROFILE_DIR || `${process.env.HOME}/.dsh/profiles/web`
const packagePath = require.resolve('dsh-life-tick/package.json', { paths: [profileDir] })
const packageJson = require(packagePath)
const entryUrl = packagePath.replace(/package\.json$/, packageJson.exports['.'].default)
const plugin = await import(entryUrl)

console.log(`loaded ${packageJson.name}@${packageJson.version} from ${packagePath}`)

const apply = plugin.default ?? plugin.apply
if (typeof apply !== 'function') throw new Error('default export is not callable')
if (apply.name !== plugin.name) throw new Error(`metadata lost: ${apply.name} !== ${plugin.name}`)
if (!Array.isArray(apply.inject) || apply.inject[0] !== 'agents') throw new Error('inject metadata lost')
if (typeof apply.Config !== 'function') throw new Error('Config schema lost')

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
    this.presetId = 'home'
    this.meta = { agentPreset: 'home' }
    this.status = 'idle'
    this.inbox = new FakeInbox()
    this.followed = []
    this.ctx = {
      effect: (callback) => {
        const cleanup = callback()
        return () => cleanup?.()
      },
      on: () => () => {},
    }
  }
  followup(message) {
    this.followed.push(message)
    this.inbox.state['next-turn'].push(message)
    this.status = 'running'
  }
}

const routes = new Map()
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
    if (deps.includes('webServer')) {
      callback({
        webServer: {
          register: (route) => {
            routes.set(route.path, route)
            console.log('  [route]', route.kind, route.path)
            return () => routes.delete(route.path)
          },
        },
        effect: () => () => {},
      })
    }
  },
}

console.log('applying plugin (mock ctx, temp config file)…')
const tmpConfigFile = `/tmp/lt-rehearse-${Date.now()}.json`
apply(ctx, { configFile: tmpConfigFile })

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
apply(ctx2, { configFile: tmpConfigFile })

const agent = new FakeAgent('rehearsal-agent')
registry.live.set(agent.id, agent)
listeners.get('agent/created')({ agent })

const route = routes.get('/api/life-tick/config')
if (route === undefined) throw new Error('config route missing')
const EventEmitter = (await import('node:events')).EventEmitter
const roundtrip = async (method, body) => {
  const response = new EventEmitter()
  response.writeHead = function (code) { this.statusCode = code }
  response.end = function (data) { this.emit('data', Buffer.from(data ?? '')); this.emit('end') }
  const done = new Promise((resolve) => {
    const chunks = []
    response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
  })
  await route.handler({ method, [Symbol.asyncIterator]: async function* () { if (body) yield Buffer.from(body) } }, response)
  return done
}
const initial = await roundtrip('GET')
console.log('  [route GET]', initial.status, initial.body)
const updated = await roundtrip('POST', JSON.stringify({ meanDayMin: 30 }))
console.log('  [route POST]', updated.status, updated.body)
if (JSON.parse(updated.body).meanDayMin !== 30) throw new Error('POST did not apply')

const { LifeTickRuntime } = await import(entryUrl)
const runtime = new LifeTickRuntime(agent, {
  readConfig: () => ({
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
    lifeDir: '/tmp/companion-life-rehearse',
    compactBeforeBeat: false,
  }),
  forceKind: 'glance',
  delayMs: 1000,
})
runtime.lastHumanAt = Date.now() - 2 * 3600_000
runtime.tick()
const message = agent.followed[0]
if (!message) throw new Error('no life-tick message delivered')
if (message.role !== 'user' || message.source.kind !== 'plugin' || message.source.plugin !== 'life-tick') {
  throw new Error(`bad message shape: ${JSON.stringify({ role: message.role, source: message.source })}`)
}
console.log('life-tick delivered:', JSON.stringify(message.content[0].text).slice(0, 80), '…')
runtime.dispose()

console.log('✔ pre-flight rehearsal passed')
