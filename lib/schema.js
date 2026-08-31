/**
 * Shared schemas for dsh-life-tick.
 *
 * @module dsh-life-tick/schema
 */

import z from '@deepseek-ai/schemastery'

export const SettingsSchema = z.object({
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
})

export const SETTINGS_KEYS = [
  'enabled',
  'timezone',
  'quietStart',
  'quietEnd',
  'meanDayMin',
  'meanNightMin',
  'maxWakesPerDay',
  'maxVisiblePerDay',
  'maxWakesPerHour',
  'pauseAfterMissed',
  'presetIds',
  'lifeDir',
  'attachWhenUnknown',
]
