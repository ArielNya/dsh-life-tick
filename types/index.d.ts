import type { Context } from '@deepseek-ai/cordis'

export interface LifeTickConfig {
  enabled?: boolean
  timezone?: string
  quietStart?: number
  quietEnd?: number
  meanDayMin?: number
  meanNightMin?: number
  maxWakesPerDay?: number
  maxVisiblePerDay?: number
  maxWakesPerHour?: number
  pauseAfterMissed?: number
  presetIds?: string[]
  lifeDir?: string
  attachWhenUnknown?: boolean
  prompt?: string
  configFile?: string
  compactBeforeBeat?: boolean
}

export const name: 'life-tick'
export const inject: ['agents']

export const Config: import('@deepseek-ai/schemastery').default<LifeTickConfig>

export function apply(ctx: Context, config?: LifeTickConfig): () => void

export default apply
