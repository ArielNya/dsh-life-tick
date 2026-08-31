/**
 * Pure clock / lottery tests for dsh-life-tick.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  hourInZone,
  isQuiet,
  nextDelayMs,
  shouldWake,
  kindWeights,
  rollKind,
  pickKind,
  isNoPing,
  isVisibleKind,
  isModelKind,
  localDayKey,
  extractAssistantText,
  resolvePresetId,
  shouldAttach,
  expandHome,
  parsePresetIds,
  WEIGHTS,
  MIN_DELAY_MS,
  MAX_DELAY_MS,
} from '../lib/clock.js'

test('isQuiet wraps midnight', () => {
  assert.equal(isQuiet(23, 23, 8), true)
  assert.equal(isQuiet(2, 23, 8), true)
  assert.equal(isQuiet(8, 23, 8), false)
  assert.equal(isQuiet(15, 23, 8), false)
  assert.equal(isQuiet(12, 9, 17), true)
  assert.equal(isQuiet(8, 9, 17), false)
})

test('hourInZone America/Sao_Paulo', () => {
  const noonUtc = new Date('2026-08-31T15:00:00Z') // 12:00 in -03
  assert.equal(hourInZone(noonUtc, 'America/Sao_Paulo'), 12)
})

test('nextDelayMs clamps and scales', () => {
  const base = { hour: 14, hoursSinceHuman: 2, visiblePingsToday: 0, maxVisiblePerDay: 3, meanDayMin: 45, meanNightMin: 180, quietStart: 23, quietEnd: 8 }
  const delay = nextDelayMs(base, () => Math.exp(-1)) // -ln(1/e) = 1 → ~45 min
  assert.ok(delay >= MIN_DELAY_MS && delay <= MAX_DELAY_MS)
  const night = nextDelayMs({ ...base, hour: 1 }, () => Math.exp(-1))
  assert.ok(night > delay)
  const recent = nextDelayMs({ ...base, hoursSinceHuman: 0.2 }, () => Math.exp(-1))
  assert.ok(recent > delay)
})

test('shouldWake is false right after a human message', () => {
  assert.equal(shouldWake({ hour: 14, hoursSinceHuman: 0.1, quietStart: 23, quietEnd: 8 }, () => 0), false)
  assert.equal(shouldWake({ hour: 14, hoursSinceHuman: 2, quietStart: 23, quietEnd: 8 }, () => 0.01), true)
  assert.equal(shouldWake({ hour: 14, hoursSinceHuman: 2, quietStart: 23, quietEnd: 8 }, () => 0.99), false)
})

test('rollKind follows weights', () => {
  assert.equal(rollKind(WEIGHTS.day, () => 0), 'silence')
  assert.equal(rollKind(WEIGHTS.day, () => 0.5), 'private')
  assert.equal(rollKind(WEIGHTS.day, () => 0.8), 'glance')
  assert.equal(rollKind(WEIGHTS.day, () => 0.99), 'reach')
  assert.equal(kindWeights({ hour: 2, hoursSinceHuman: 3, quietStart: 23, quietEnd: 8 }), WEIGHTS.night)
  assert.equal(kindWeights({ hour: 14, hoursSinceHuman: 0.2, quietStart: 23, quietEnd: 8 }), WEIGHTS.justTalked)
})

test('pickKind can stay silent without a second roll consuming the stream oddly', () => {
  let i = 0
  const seq = [0.99, 0.0] // shouldWake false
  assert.equal(pickKind({ hour: 14, hoursSinceHuman: 3, quietStart: 23, quietEnd: 8 }, () => seq[i++]), 'silence')
})

test('isNoPing', () => {
  assert.equal(isNoPing('NO_PING'), true)
  assert.equal(isNoPing('NO_PING\nI wrote a diary'), true)
  assert.equal(isNoPing('  NO_PING  '), true)
  assert.equal(isNoPing('hey'), false)
  assert.equal(isNoPing(''), false)
})

test('kind flags', () => {
  assert.equal(isVisibleKind('glance'), true)
  assert.equal(isVisibleKind('private'), false)
  assert.equal(isModelKind('silence'), false)
  assert.equal(isModelKind('dream'), true)
})

test('localDayKey is timezone stable', () => {
  const late = new Date('2026-09-01T02:00:00Z') // still Aug 31 in Sao Paulo
  assert.equal(localDayKey(late, 'America/Sao_Paulo'), '2026-08-31')
})

test('extractAssistantText', () => {
  assert.equal(extractAssistantText('NO_PING'), 'NO_PING')
  assert.equal(extractAssistantText({ content: [{ type: 'text', text: 'hi' }] }), 'hi')
  assert.equal(extractAssistantText({ message: { content: 'NO_PING' } }), 'NO_PING')
})

test('resolvePresetId / shouldAttach', () => {
  assert.equal(resolvePresetId({ session: { header: { agentPreset: 'home' } } }), 'home')
  assert.equal(resolvePresetId({ meta: { agentPreset: 'home' } }), 'home')
  assert.equal(resolvePresetId({ session: { meta: { agentPreset: 'work' } } }), 'work')
  assert.equal(resolvePresetId({ presetId: 'home' }), 'home')
  assert.equal(shouldAttach({ presetId: 'home' }, ['home']), true)
  assert.equal(shouldAttach({ presetId: 'work' }, ['home']), false)
  assert.equal(shouldAttach({ id: 'x' }, ['home'], false), false)
  assert.equal(shouldAttach({ id: 'x' }, ['home'], true), true)
  assert.equal(shouldAttach({ presetId: 'work' }, [], false), true)
})

test('parsePresetIds and expandHome', () => {
  assert.deepEqual(parsePresetIds('home, work'), ['home', 'work'])
  assert.deepEqual(parsePresetIds(['home']), ['home'])
  assert.ok(expandHome('~/companion-life').includes('companion-life'))
})
