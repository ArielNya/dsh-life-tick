/**
 * dsh-life-tick client: Settings → Life tick.
 * Talks to GET/POST /api/life-tick/config. Loader id must match the package name.
 */
window.__ModuleLoader__.load({
  id: 'dsh-life-tick',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    let react = require('react')

    const React = react
    const CONFIG_URL = '/api/life-tick/config'

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
    const errorStyle = { padding: '0 16px 8px', fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-state-error-primary, #e5484d)' }
    const inputStyle = {
      width: '88px',
      padding: '6px 8px',
      fontSize: '14px',
      borderRadius: '6px',
      border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.35))',
      background: 'var(--dsw-alias-bg-layer-1, transparent)',
      color: 'var(--dsw-alias-label-primary, inherit)',
    }
    const wideInput = { ...inputStyle, width: '160px' }

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

    function ErrorText({ message }) {
      return React.createElement('div', { style: { padding: '14px 16px', fontSize: '13px', lineHeight: '20px', color: 'var(--dsw-alias-state-error-primary, #e5484d)' } },
        'Life tick settings failed to load: ', message)
    }

    class SectionBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: undefined }
      }
      static getDerivedStateFromError(error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
      render() {
        if (this.state.error !== undefined) return React.createElement(ErrorText, { message: this.state.error })
        return this.props.children
      }
    }

    function NumberRow({ label, hint, value, min, max, suffix, disabled, onCommit, width }) {
      return React.createElement('div', { style: rowStyle },
        React.createElement('div', null,
          React.createElement('div', { style: labelStyle }, label),
          React.createElement('div', { style: subStyle }, hint),
        ),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
          React.createElement('input', {
            type: 'number',
            min,
            max,
            disabled,
            value: value ?? '',
            onChange: (event) => {
              const next = Number(event.target.value)
              if (Number.isFinite(next) && next >= min && next <= max) onCommit(next)
            },
            style: width === 'wide' ? wideInput : inputStyle,
          }),
          suffix ? React.createElement('span', { style: labelStyle }, suffix) : null,
        ),
      )
    }

    function LifeTickSection() {
      return React.createElement(SectionBoundary, null, React.createElement(LifeTickForm))
    }

    function LifeTickForm() {
      const [config, setConfig] = React.useState(undefined)
      const [status, setStatus] = React.useState('loading')
      const [error, setError] = React.useState(undefined)
      const [saving, setSaving] = React.useState(false)

      React.useEffect(() => {
        let alive = true
        fetch(CONFIG_URL)
          .then(async (response) => {
            if (!response.ok) throw new Error(`GET ${response.status}`)
            return response.json()
          })
          .then((value) => {
            if (!alive) return
            setConfig(value)
            setStatus('ready')
          })
          .catch((err) => {
            if (!alive) return
            setStatus('failed')
            setError(err instanceof Error ? err.message : String(err))
          })
        return () => {
          alive = false
        }
      }, [])

      const applyPatch = (patch) => {
        setSaving(true)
        setError(undefined)
        fetch(CONFIG_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        })
          .then(async (response) => {
            const body = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(body.error ?? `POST ${response.status}`)
            setConfig(body)
          })
          .catch((err) => {
            setError(err instanceof Error ? err.message : String(err))
          })
          .finally(() => setSaving(false))
      }

      if (status === 'loading') {
        return React.createElement('div', { style: { padding: '14px 16px', fontSize: '13px', color: 'var(--dsw-alias-label-secondary, #888)' } }, 'Loading…')
      }
      if (status === 'failed') return React.createElement(ErrorText, { message: error ?? 'unknown' })

      const value = config ?? {}
      const disabled = saving
      const presets = Array.isArray(value.presetIds) ? value.presetIds.join(', ') : (value.presetIds ?? 'home')

      return React.createElement('div', { style: { padding: '8px 0' } },
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, 'Enable life tick'),
            React.createElement('div', { style: subStyle }, 'Irregular wakes. Most ticks stay silent or private.'),
          ),
          React.createElement(Toggle, {
            checked: value.enabled !== false,
            disabled,
            onChange: (next) => applyPatch({ enabled: next }),
          }),
        ),
        React.createElement(NumberRow, {
          label: 'Day mean',
          hint: 'Average minutes between clock fires during the day (exponential, not fixed)',
          value: value.meanDayMin ?? 45,
          min: 1,
          max: 720,
          suffix: 'min',
          disabled,
          onCommit: (next) => applyPatch({ meanDayMin: Math.round(next) }),
        }),
        React.createElement(NumberRow, {
          label: 'Night mean',
          hint: 'Average minutes between fires during quiet hours',
          value: value.meanNightMin ?? 180,
          min: 1,
          max: 720,
          suffix: 'min',
          disabled,
          onCommit: (next) => applyPatch({ meanNightMin: Math.round(next) }),
        }),
        React.createElement(NumberRow, {
          label: 'Quiet start',
          hint: 'Local hour (0–23) when night weights begin',
          value: value.quietStart ?? 23,
          min: 0,
          max: 23,
          suffix: 'h',
          disabled,
          onCommit: (next) => applyPatch({ quietStart: Math.round(next) }),
        }),
        React.createElement(NumberRow, {
          label: 'Quiet end',
          hint: 'Local hour when night weights end',
          value: value.quietEnd ?? 8,
          min: 0,
          max: 23,
          suffix: 'h',
          disabled,
          onCommit: (next) => applyPatch({ quietEnd: Math.round(next) }),
        }),
        React.createElement(NumberRow, {
          label: 'Model wakes / day',
          hint: 'Hard cap on ticks that call the model (silence is free)',
          value: value.maxWakesPerDay ?? 8,
          min: 0,
          max: 100,
          disabled,
          onCommit: (next) => applyPatch({ maxWakesPerDay: Math.round(next) }),
        }),
        React.createElement(NumberRow, {
          label: 'Visible pings / day',
          hint: 'glance/reach that are not NO_PING',
          value: value.maxVisiblePerDay ?? 3,
          min: 0,
          max: 50,
          disabled,
          onCommit: (next) => applyPatch({ maxVisiblePerDay: Math.round(next) }),
        }),
        React.createElement(NumberRow, {
          label: 'Pause after ignored pings',
          hint: 'Visible pings you did not answer. 0 = never pause',
          value: value.pauseAfterMissed ?? 5,
          min: 0,
          max: 100,
          disabled,
          onCommit: (next) => applyPatch({ pauseAfterMissed: Math.round(next) }),
        }),
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, 'Presets'),
            React.createElement('div', { style: subStyle }, 'Only these agent presets get a clock (comma-separated). Empty = all.'),
          ),
          React.createElement('input', {
            type: 'text',
            disabled,
            defaultValue: presets,
            onBlur: (event) => applyPatch({ presetIds: event.target.value }),
            style: wideInput,
          }),
        ),
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, 'Life folder'),
            React.createElement('div', { style: subStyle }, 'diary.md / dreams.md / letters-unsent.md'),
          ),
          React.createElement('input', {
            type: 'text',
            disabled,
            defaultValue: value.lifeDir ?? '~/companion-life',
            onBlur: (event) => {
              const next = event.target.value.trim()
              if (next) applyPatch({ lifeDir: next })
            },
            style: wideInput,
          }),
        ),
        React.createElement('div', { style: rowStyle },
          React.createElement('div', null,
            React.createElement('div', { style: labelStyle }, 'Timezone'),
            React.createElement('div', { style: subStyle }, 'IANA zone for quiet hours and dated files'),
          ),
          React.createElement('input', {
            type: 'text',
            disabled,
            defaultValue: value.timezone ?? 'America/Sao_Paulo',
            onBlur: (event) => {
              const next = event.target.value.trim()
              if (next) applyPatch({ timezone: next })
            },
            style: wideInput,
          }),
        ),
        error !== undefined ? React.createElement('div', { style: errorStyle }, 'Save failed: ', error) : null,
        React.createElement('div', { style: { padding: '14px 16px', fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary, #888)' } },
          value.enabled === false
            ? 'Paused. No ticks fire.'
            : `On. Day mean ${value.meanDayMin ?? 45} min, night mean ${value.meanNightMin ?? 180} min. Work presets are skipped.`,
        ),
      )
    }

    function apply(ctx) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'life-tick',
        order: 100,
        label: () => 'Life tick',
      }, LifeTickSection))
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
