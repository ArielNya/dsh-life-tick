# dsh-plugin-heartbeat

DeepSeek Harness 的「心跳」插件：给 agent 装一个定时唤醒的闹钟，让它**主动**开口 —— 汇报进展、风险、卡点，或者没事贫两句。类似 OpenClaw 的心跳模式。

## 怎么工作

- Host 平面的 Cordis 插件，监听 `agent/created`，给每个 **root agent**（子 agent 跳过）挂一个独立定时器。
- 每次心跳通过 `agent.followup()` 注入一条合成 user 消息（`source.kind === 'plugin'`）：
  - **agent 空闲** → 立即开新一轮，主动说话；
  - **agent 忙** → 消息排队，当前轮结束立刻处理 —— **不打断、不丢失**；
  - 连续忙时多拍心跳 → 只保留一条待处理（`inbox.replace` 原地替换，不堆积）。
- 注入的消息在对话流里渲染为一条折叠的 context 小行，不是整块用户气泡。

## 配置

| 键 | 默认 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关（用户层存在 `<dshHome>/heartbeat.json`） |
| `intervalSeconds` | `600` | 心跳周期（钳制在 30–86400 秒） |
| `prompt` | 内置 | 每拍投递的指令模板，`{{time}}` 会替换为当前时间（仅 composition 配置） |
| `pauseAfterMissed` | `3` | 无人值守保护：连续 N 拍没有真人回复就自动暂停；用户下一条消息立即恢复并重新计时。`0` = 关闭 |
| `configFile` | `<dshHome>/heartbeat.json` | 用户配置文件路径（`enabled` / `intervalSeconds` / `pauseAfterMissed`） |

> 为什么不用 settings 面板的通用 namespace？DSH 的 settings wire 只服务一张
> 硬编码白名单（`WEB_SETTINGS_NAMESPACES`），插件无法把自有 namespace 暴露给
> 浏览器写入。本插件因此在 host 自建了 `GET/POST /api/heartbeat/config`
> 路由，设置面板里的「心跳 Heartbeat」区块直连该路由，写入即热应用。

## 安装

```sh
pnpm add dsh-plugin-heartbeat
```

然后在 profile 的 `cordis.patch.yml` 里加一行：

```yaml
- insert:
    - id: dsh-heartbeat
      name: dsh-plugin-heartbeat
      config:
        intervalSeconds: 600
```

重启 DSH（或新建会话）后生效。也可以在设置面板里随时改频率或关掉。

## 开发

```sh
node --test test/runtime.test.mjs
```

## 已知边界

- 心跳只在 DSH 进程活着时存在（app 关了就停）。
- 每个会话（root agent）各自一条定时器；同一时间只有一个会话在跟阿周聊天，互不干扰。
- 心跳**不打断**正在跑的任务；任务结束后它会立刻补一句。
- 心跳是「汇报」不是「新任务」：默认提示词要求它别自作主张开新活。

## License

MIT
