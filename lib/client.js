/**
 * dsh-plugin-heartbeat 客户端半（零构建）：
 * 在设置面板注册「Heartbeat 心跳」区块 —— 开关 + 频率，热写 settings。
 *
 * 机制：settings.section 槽（壳提供导航）→ settingsScope 服务绑定
 * `heartbeat` namespace（在 apply 里绑一次，disposer 归插件 fiber）
 * → useSyncExternalStore 渲染快照 → controller.set() 写回 Host
 * （Host 校验 schema，失败自动重读恢复）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-heartbeat',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    let react = require('react')

    const React = react

    const clampMinutes = (seconds) => Math.max(1, Math.round((Number(seconds) || 0) / 60))

    const rowStyle = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      padding: '14px 16px',
      borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2))',
    }
    const labelStyle = { fontSize: '14px', lineHeight: '22px' }
    const subStyle = { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary, #999)' }
    const inputStyle = {
      width: '72px',
      padding: '6px 8px',
      fontSize: '14px',
      borderRadius: '6px',
      border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.35))',
      background: 'var(--dsw-alias-bg-layer-1, transparent)',
      color: 'var(--dsw-alias-label-primary, inherit)',
    }

    function Toggle({ checked, disabled, onChange }) {
      return React.createElement('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked,
        disabled,
        onClick: () => onChange(!checked),
        style: {
          position: 'relative',
          width: '40px',
          height: '22px',
          borderRadius: '11px',
          border: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          background: checked ? 'var(--dsw-alias-brand-primary, #4c8bf5)' : 'var(--dsw-alias-label-secondary, #666)',
          opacity: disabled ? 0.5 : 1,
          transition: 'background 0.15s',
          flexShrink: 0,
        },
      }, React.createElement('span', {
        style: {
          position: 'absolute',
          top: '2px',
          left: checked ? '20px' : '2px',
          width: '18px',
          height: '18px',
          borderRadius: '9px',
          background: '#fff',
          transition: 'left 0.15s',
        },
      }))
    }

    function makeSection(controller) {
      return function HeartbeatSection() {
        const snapshot = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot)
        const value = snapshot.value
        const loading = snapshot.status === 'loading'
        const disabled = !snapshot.writable

        return React.createElement('div', { style: { padding: '8px 0' } },
          React.createElement('div', { style: rowStyle },
            React.createElement('div', null,
              React.createElement('div', { style: labelStyle }, '启用心跳'),
              React.createElement('div', { style: subStyle }, '到点主动汇报进展/风险，没事也会冒个泡'),
            ),
            React.createElement(Toggle, {
              checked: loading ? false : value?.enabled !== false,
              disabled: loading || disabled,
              onChange: (next) => controller.set('enabled', next),
            }),
          ),
          React.createElement('div', { style: rowStyle },
            React.createElement('div', null,
              React.createElement('div', { style: labelStyle }, '心跳频率'),
              React.createElement('div', { style: subStyle }, '最小 1 分钟；忙碌时不打断，任务结束补一句'),
            ),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
              React.createElement('input', {
                type: 'number',
                min: 1,
                max: 1440,
                disabled: loading || disabled,
                value: loading ? '' : clampMinutes(value?.intervalSeconds),
                onChange: (event) => {
                  const minutes = Number(event.target.value)
                  if (Number.isFinite(minutes) && minutes >= 1 && minutes <= 1440) {
                    controller.set('intervalSeconds', Math.round(minutes * 60))
                  }
                },
                style: inputStyle,
              }),
              React.createElement('span', { style: labelStyle }, '分钟'),
            ),
          ),
          React.createElement('div', { style: { padding: '14px 16px', fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary, #888)' } },
            loading ? '读取配置中…' : `当前：${value?.enabled === false ? '已暂停' : `每 ${clampMinutes(value?.intervalSeconds)} 分钟一次`}。修改即时生效，下一个周期起用。`,
          ),
        )
      }
    }

    function apply(ctx) {
      const settingsScope = ctx.get('settingsScope')
      if (settingsScope === undefined) return
      // 在插件 fiber 里绑一次：disposer 归本插件生命周期
      const controller = settingsScope.bind({ namespace: 'heartbeat' })
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', () => slots.register({
        name: 'settings.section',
        id: 'heartbeat',
        order: 100,
        label: () => '心跳 Heartbeat',
      }, makeSection(controller)))
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})
