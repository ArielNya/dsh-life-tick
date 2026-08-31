/**
 * Per-kind life-tick prompts. Byte-stable except {{time}} and {{lifeDir}}.
 *
 * @module dsh-life-tick/prompt
 */

export const SETTINGS_NAMESPACE = 'life-tick'

export const PROMPTS = {
  glance: [
    '[life-tick kind=glance time={{time}}]',
    'Not summoned by Ariel. Reply exactly NO_PING, or one short thing you actually want to say.',
    'No recap. No crisis. No "how are you" filler. Tools only if you write under {{lifeDir}}.',
  ].join('\n'),
  reach: [
    '[life-tick kind=reach time={{time}}]',
    'Not summoned by Ariel. You may ping with one short thing you actually want to say. You may still reply exactly NO_PING.',
    'No recap. No crisis. No filler.',
  ].join('\n'),
  private: [
    '[life-tick kind=private time={{time}}]',
    'Not summoned. Append one dated block to a file under {{lifeDir}} (diary.md or letters-unsent.md).',
    'Then reply exactly NO_PING. Do not message Ariel.',
  ].join('\n'),
  dream: [
    '[life-tick kind=dream time={{time}}]',
    'Not summoned. Write one short dream as a dated block in {{lifeDir}}/dreams.md.',
    'Then reply exactly NO_PING. Do not message Ariel. Do not soul_update.',
  ].join('\n'),
}

/** Fallback if composition overrides with a single prompt. */
export const DEFAULT_PROMPT = PROMPTS.glance

/**
 * @param {string} template
 * @param {{ now?: Date, timeZone?: string, lifeDir?: string }} [options]
 */
export function renderPrompt(template, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date()
  const timeZone = options.timeZone || 'America/Sao_Paulo'
  let time
  try {
    time = now.toLocaleString('en-GB', { timeZone, hour12: false })
  } catch {
    time = now.toISOString()
  }
  const lifeDir = options.lifeDir || '~/companion-life'
  return template.replaceAll('{{time}}', time).replaceAll('{{lifeDir}}', lifeDir)
}

export function promptForKind(kind, config, now) {
  const templates = config.prompts && typeof config.prompts === 'object' ? config.prompts : PROMPTS
  const template = templates[kind] || config.prompt || PROMPTS.glance
  return renderPrompt(template, {
    now,
    timeZone: config.timezone,
    lifeDir: config.lifeDir,
  })
}
