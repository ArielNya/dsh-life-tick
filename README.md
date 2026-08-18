# dsh-plugin-heartbeat

> A heartbeat plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): wakes the agent on a configurable interval so it proactively reports progress, risks, and blockers — or just checks in.

DeepSeek Harness 的「心跳」插件：给 agent 装一个定时唤醒的闹钟，让它**主动**开口 —— 汇报进展、风险、卡点，或者没事贫两句。类似 OpenClaw 的心跳模式。

## 怎么工作

- Host 平面的 Cordis 插件，监听 `agent/created`，给每个 **root agent**（子 agent 跳过）挂一个独立定时器。
- 每次心跳通过 `agent.followup()` 注入一条合成 user 消息（`source.kind === 'plugin'`）：
  - **agent 空闲** → 立即开新一轮，主动说话；
  - **agent 忙** → 消息排队，当前轮结束立刻处理 —— **不打断、不丢失**；
  - 连续忙时多拍心跳 → 只保留一条待处理（`inbox.replace` 原地替换，不堆积）。
- **无人值守保护**：连续 N 拍没有真人回复就自动暂停；你下一条消息立即恢复并重新计时。
- 注入的消息在对话流里渲染为一条折叠的 context 小行，不是整块用户气泡。

## 安装

```sh
dsh plugin --profile <profile> add dsh-plugin-heartbeat
```

（包内置 `dsh.bundle` manifest，`dsh plugin add` 会把它自动挂进 profile 的 bundles 层；dsh-market 里的一键安装同此通道。）

重启 DSH 后生效。之后在 **设置 → 心跳 Heartbeat** 面板里随时改频率、开关与暂停阈值，保存即热应用（无需重启）。

> ⚠️ **不要**再往 profile 的 `cordis.patch.yml` 里手写 `- insert: {id: dsh-heartbeat, ...}`：
> 那会与 bundle manifest 的自动挂载产生两条同名 entry，整个 profile 会以
> `duplicate loader entry id "dsh-heartbeat"` 启动失败（2026-08-18 实机事故，
> 当时撞的是 memory 插件的同名条目）。运行期配置走 `<dshHome>/heartbeat.json`；
> 覆盖 composition 键（如 `prompt`）用**不带 insert 的 id 覆盖条目**，见下。

## 配置

| 键 | 默认 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关（用户层存在 `<dshHome>/heartbeat.json`） |
| `intervalSeconds` | `600` | 心跳周期（钳制在 30–86400 秒） |
| `pauseAfterMissed` | `3` | 无人值守保护：连续 N 拍没有真人回复就自动暂停；用户下一条消息立即恢复并重新计时。`0` = 关闭 |
| `prompt` | 内置 | 每拍投递的指令模板，`{{time}}` 会替换为当前时间（仅 composition 配置） |
| `configFile` | `<dshHome>/heartbeat.json` | 用户配置文件路径（`enabled` / `intervalSeconds` / `pauseAfterMissed`） |

自定义心跳提示词（composition 配置，**不带 `insert`**，避免与 bundle 层重复）：

```yaml
- id: dsh-heartbeat
  config:
    prompt: |
      【心跳】当前时间 {{time}}。看一眼最近的对话和待办：
      有进展说进展、有风险说风险；都没有就一句话带过。
      总长不超过 5 句，中文。
```

> 为什么不用 settings 面板的通用 namespace？DSH 的 settings wire 只服务一张
> 硬编码白名单（`WEB_SETTINGS_NAMESPACES`），插件无法把自有 namespace 暴露给
> 浏览器写入。本插件因此在 host 自建了 `GET/POST /api/heartbeat/config`
> 路由，设置面板里的「心跳 Heartbeat」区块直连该路由，写入即热应用。

## 开发

```sh
node --test test/runtime.test.mjs
```

## 已知边界

- 心跳只在 DSH 进程活着时存在（app 关了就停）。
- 每个会话（root agent）各自一条定时器，互不干扰；子 agent 不挂心跳。
- 心跳**不打断**正在跑的任务；任务结束后它会立刻补一句。
- 心跳是「汇报」不是「新任务」：默认提示词要求它别自作主张开新活。

## License

MIT
