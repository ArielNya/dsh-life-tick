import type { Context } from '@deepseek-ai/cordis'

export interface HeartbeatConfig {
  /** Master switch for every session. Default `true`. */
  enabled?: boolean
  /** Heartbeat period in seconds, clamped to 30–86400. Default `600`. */
  intervalSeconds?: number
  /** Instruction template delivered on each beat; `{{time}}` is substituted. */
  prompt?: string
  /** Also register the `heartbeat` settings namespace for the Settings panel. Default `true`. */
  settingsUi?: boolean
}

export const name: 'heartbeat'
export const inject: ['agents']

/** Schemastery schema applied to the plugin config before startup. */
export const Config: import('@deepseek-ai/schemastery').default<HeartbeatConfig>

export function apply(ctx: Context, config?: HeartbeatConfig): () => void

export default apply
