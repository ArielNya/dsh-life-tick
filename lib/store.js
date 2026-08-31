/**
 * Life-tick configuration store: one JSON file over composition defaults.
 *
 * The Web settings wire only serves a hard-coded namespace allowlist, so this
 * plugin serves GET/POST /api/life-tick/config itself.
 *
 * @module dsh-life-tick/store
 */

import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { SettingsSchema, SETTINGS_KEYS } from './schema.js'
import { parsePresetIds } from './clock.js'

export const LIFE_TICK_CONFIG_FILENAME = 'life-tick.json'

export function defaultConfigPath() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), LIFE_TICK_CONFIG_FILENAME)
}

export const DEFAULT_BASE = {
  enabled: true,
  timezone: 'America/Sao_Paulo',
  quietStart: 23,
  quietEnd: 8,
  meanDayMin: 45,
  meanNightMin: 180,
  maxWakesPerDay: 8,
  maxVisiblePerDay: 3,
  maxWakesPerHour: 2,
  pauseAfterMissed: 5,
  presetIds: ['home'],
  lifeDir: '~/companion-life',
  attachWhenUnknown: false,
}

function normalize(raw, base) {
  const merged = { ...base, ...pickFields(raw) }
  if (merged.presetIds !== undefined) merged.presetIds = parsePresetIds(merged.presetIds)
  return SettingsSchema(merged)
}

export class LifeTickConfigStore {
  constructor(options = {}) {
    this.path = options.path ?? defaultConfigPath()
    this.base = { ...DEFAULT_BASE }
    if (options.base && typeof options.base === 'object') {
      for (const key of SETTINGS_KEYS) {
        if (options.base[key] !== undefined) this.base[key] = options.base[key]
      }
    }
    if (this.base.presetIds !== undefined) this.base.presetIds = parsePresetIds(this.base.presetIds)
    this.config = { ...this.base }
    this.watchers = new Set()
    this.load()
  }

  load() {
    let raw
    try {
      if (!existsSync(this.path)) return
      raw = JSON.parse(readFileSync(this.path, 'utf8'))
    } catch {
      return
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return
    try {
      this.config = snapshot(normalize(raw, this.base))
    } catch {
      // keep last good
    }
  }

  get() {
    return this.config
  }

  update(patch) {
    if (typeof patch !== 'object' || patch === null) throw new Error('config patch must be an object')
    const next = snapshot(normalize({ ...this.config, ...pickFields(patch) }, this.base))
    this.config = next
    this.persist()
    for (const watcher of this.watchers) {
      try {
        watcher(this.config)
      } catch {
        // best-effort
      }
    }
    return this.config
  }

  watch(callback) {
    this.watchers.add(callback)
    return () => this.watchers.delete(callback)
  }

  persist() {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.tmp`
      writeFileSync(tmp, `${JSON.stringify(this.config, null, 2)}\n`)
      renameSync(tmp, this.path)
    } catch (error) {
      throw new Error(`config persisted in memory but not to disk: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

function snapshot(resolved) {
  const out = {}
  for (const key of SETTINGS_KEYS) out[key] = resolved[key]
  return out
}

function pickFields(input) {
  const picked = {}
  for (const key of SETTINGS_KEYS) {
    if (input[key] !== undefined) picked[key] = input[key]
  }
  return picked
}

/** @deprecated heartbeat name kept as an alias so old tests/docs don't explode mid-migration. */
export const HeartbeatConfigStore = LifeTickConfigStore
