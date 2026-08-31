# dsh-life-tick

Irregular companion wakes for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Fork of [dsh-plugin-heartbeat](https://github.com/LittleBlackTong/dsh-plugin-heartbeat) (MIT).

Not a cron. A Poisson clock + a lottery + permission to stay silent.

## What it does

- Host-plane plugin. Listens for `agent/created`, attaches a timer to **root** agents whose preset is in `presetIds` (default: `home` only). Work sessions are skipped.
- Next delay is exponential (`meanDayMin` / `meanNightMin`), clamped 8 min–6 h, stretched after you just spoke, stretched again after the daily visible cap.
- At fire time it rolls:
  - **silence** — no model call
  - **private** / **dream** — model may write under `~/companion-life`, must reply `NO_PING`
  - **glance** / **reach** — optional short ping; `NO_PING` is not counted as visible
- `followup()` delivery is unchanged from heartbeat: idle opens a turn, busy queues one, replace-not-stack.
- Visible pings you ignore count toward `pauseAfterMissed`. A real user message resets and re-arms.
- Daily / hourly caps on model wakes. Silence ticks are free.

`dsh web` must be running. If the process is off, she is asleep.

## Install

Uninstall stock heartbeat first if it is on this profile — two wake plugins will fight.

```sh
dsh plugin --profile web add github:ArielNya/dsh-life-tick
```

Restart `dsh web`. Settings → **Life tick**. Config file: `$DSH_HOME/life-tick.json`.

Do **not** also insert `dsh-life-tick` by hand in `cordis.patch.yml` (duplicate loader id).

## Config

| key | default | meaning |
|---|---|---|
| `enabled` | `true` | master switch |
| `timezone` | `America/Sao_Paulo` | quiet hours + day key |
| `quietStart` / `quietEnd` | `23` / `8` | night weights (wraps midnight) |
| `meanDayMin` | `45` | mean minutes between clock fires (day) |
| `meanNightMin` | `180` | mean minutes (quiet hours) |
| `maxWakesPerDay` | `8` | model calls / local day |
| `maxVisiblePerDay` | `3` | glance/reach that were not `NO_PING` |
| `maxWakesPerHour` | `2` | model calls / 60 min window |
| `pauseAfterMissed` | `5` | ignored **visible** pings before hard stop (`0` = off) |
| `presetIds` | `["home"]` | empty = every root agent |
| `lifeDir` | `~/companion-life` | diary / dreams / letters-unsent |
| `attachWhenUnknown` | `false` | attach if the session has no preset id |
| `compactBeforeBeat` | `true` | composition only |

## Life files

On the first private/dream tick the plugin creates:

```text
~/companion-life/diary.md
~/companion-life/dreams.md
~/companion-life/letters-unsent.md
```

Those are not injected as memory. Soul stays in `dsh-soul-self`.

## Tests

```sh
npm test
```

## License

MIT. Heartbeat original © LittleBlackTong; this fork © ArielNya.
