# Changelog

所有记录跟随 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格；版本号与 `package.json` 保持一致。

## [0.4.2] - 2026-08-31

### Changed

- **适配 DSH 0.1.2-alpha.1**：移除 `dsh.client.inject` 里已废弃的 `@deepseek-ai/dsh-client-runtime`（新版宿主已合并进 `dsh-client-modules`，且本插件客户端半只依赖 `react` 平台种子模块）。

## [0.4.1] - 2026-08-24

### Changed

- 包内新增 `CHANGELOG.md` 并纳入 npm 发布文件（`files` 加 `CHANGELOG.md`），随发布携带版本说明。

## [0.4.0] - 2026-08-19

### Added（防 token 烧设计）

- **退避式间隔**：初始 600s（`intervalSeconds`）；无人回复下一拍自动 `×2`、再下一拍 `×3`（`[base, 2×base, 3×base]`，可 `backoffSeconds` 显式覆盖）。冷场越久吵得越稀。
- **硬停保证（token 保护）**：连续 `pauseAfterMissed`（默认 3）拍无真人回复 → **拆掉定时器彻底停止**，绝不再空转投递；只有用户的一条消息能复活它，并从初始档重新计时。
- **真人消息全重置**：任何你的发言都计数/档位/相位全清零，聊天活跃期心跳完全安静。
- **轻量唤醒**：投递前先请求宿主 compaction 服务把长历史压成 checkpoint 摘要（`compactBeforeBeat`，默认开，失败吞掉不阻断投递）；默认 prompt 明确「不调工具 / 不复盘历史 / ≤5 句」。
- **每小时封顶（可选）**：`maxBeatsPerHour`（默认 `0`=关）给任意 60 分钟窗口设心跳上限，防「断续回复反复重置退避」的极端烧法。

### Changed

- README 更新：机制 / 配置（`backoffSeconds` / `compactBeforeBeat` / `maxBeatsPerHour`）/ 边界说明；删除「手动 cordis.patch insert」安装路径（防 manifest 与手写双轨）。

## [0.3.1] - 2026-08-18

### Changed

- **bundle manifest 进发布 tarball**：包内补 `cordis.patch.yml` + `dsh.bundle.patch` 声明并作为 npm 发布文件，保证 `dsh plugin add` / dsh-market 能从 tarball 安装（市场 npm 安装通道的硬前提）。

## [0.3.0] - 2026-08-18

### Changed

- **自建配置通道**：弃 settings namespace（web settings wire 白名单拒绝插件命名空间），自建 `~/.dsh/heartbeat.json`（schema 校验 + 原子落盘 + watch）+ host 注册 `GET/POST /api/heartbeat/config` 路由；客户端区块改 fetch 直连，写入即热应用（store.watch → runtime.reschedule）。
- **可安装/可上架**：声明 `dsh.bundle` manifest + 仓库根 `cordis.patch.yml`；README 安装方式改为以 `dsh plugin add` 为主。

## [0.2.2] - 2026-08-18

### Fixed

- 修复客户端 `useSyncExternalStore` 直接传类方法导致 `this` 丢失（`subscribe` / `getSnapshot` 显式绑定）。

## [0.2.1] - 2026-08-18

### Fixed

- 修复设置页空白：客户端半补注入 `connection` / `remote` 服务 + 错误自显示兜底。

## [0.2.0] - 2026-08-18

### Added

- **无人值守保护**：连续 `pauseAfterMissed`（默认 3，`0`=关）拍无真人回复 → 自动暂停；用户消息恢复。README 补 `pauseAfterMissed` 配置说明。

## [0.1.1] - 2026-08-18

### Added

- **设置面板 Heartbeat 区块**：开关 + 分钟频率（客户端半注入 `settings.section`，`settings` 热写）。

### Changed

- 面板热改立即重排定时器（`settings.watch` → `runtime.reschedule()`，改频率即时生效）。

## [0.1.0] - 2026-08-18

### Added（插件本体）

- 心跳插件：可配置频率，让 agent 主动在当前会话开口（OpenClaw 心跳模式）。
- 机制：host 插件监听 `agent/created` → 每个 root agent 挂 `HeartbeatRuntime` → 每拍 `agent.followup()` 注入 plugin 源 user 消息；空闲立即开轮、忙碌排队不打断、忙时多拍 `inbox.replace` 合并为一条；任务导向心跳内容。
