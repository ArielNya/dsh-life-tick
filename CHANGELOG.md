# Changelog

## [0.5.0] - 2026-08-31

Forked from `dsh-plugin-heartbeat` 0.4.2 as **dsh-life-tick**.

### Added

- Poisson next-delay (`meanDayMin` / `meanNightMin`) instead of a fixed interval.
- Action lottery: silence / private / dream / glance / reach, with night and just-talked weights.
- `NO_PING` replies are not counted as visible pings.
- Home-only attach via `presetIds` (default `["home"]`).
- `~/companion-life` diary / dreams / letters-unsent files on private/dream ticks.
- Daily / hourly model-wake caps; quiet hours; IANA timezone.
- Settings panel **Life tick** (`/api/life-tick/config`, `$DSH_HOME/life-tick.json`).

### Removed

- Fixed `intervalSeconds` backoff schedule as the primary clock.
- Default Chinese progress-report heartbeat prompt.

## [0.4.2] - 2026-08-31

Upstream heartbeat: adapt to DSH 0.1.2-alpha.1.
