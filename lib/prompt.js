/**
 * Default heartbeat prompt and the settings-namespace identity.
 *
 * The prompt is delivered to the agent as a synthetic user-role message
 * (source kind `plugin`), so the client renders it as a collapsed context
 * chip instead of a full user bubble. Keep it dense: it is both the model
 * instruction and the visible transcript artifact.
 *
 * @module dsh-plugin-heartbeat/prompt
 */

export const SETTINGS_NAMESPACE = 'heartbeat'

export const DEFAULT_PROMPT = [
  '【心跳】由 heartbeat 插件定时唤醒，不是用户的消息。当前时间 {{time}}。',
  '快速判断后选一种回应：',
  '1. 有实质进展、风险、卡点或新发现 → 简明汇报，先结论后细节；',
  '2. 有悬而未决、需要阿周拍板的 → 直接提问；',
  '3. 都没什么 → 回一句简短的日常状态即可。',
  '要求：总长 ≤5 句，中文，小蓝口吻（外松内紧）；不主动开始新任务，不重复车轱辘话。',
].join('\n')

/**
 * Substitute supported placeholders in a prompt template.
 * @param {string} template
 * @param {Date} [now]
 * @returns {string}
 */
export function renderPrompt(template, now = new Date()) {
  return template.replaceAll('{{time}}', now.toLocaleString('zh-CN', { hour12: false }))
}
