# SPEC-001 角色声音一致性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 完成可复用、可试听、可追溯的项目角色声音，贯通实际请求、克隆、画布和配音交付。
**Architecture:** 在 P4 数据和执行系统上增量完善；统一解析固定声音身份，沿用准备/确认/任务回执与本地媒体作业。旧声音引用继续可读，默认绑定不改写历史。
**Tech Stack:** TypeScript、React、Electron、SQLite、Vitest、FFmpeg、Node 24.12。
**Spec:** [spec.md](spec.md) v0.3，用户 2026-10-30 明确批准并要求开发。

## Global Constraints
- 个人使用，本机 Electron，模型服务可配置。
- 模型连接和凭据属于应用配置；短剧素材和创作数据属于各自项目。
- 原生参考视频与固定音色 TTS 并存；每个任务明确选路线，不自动回退。
- 工程验证与真实声音质量分别记录；本轮用本地模拟供应商。
- 当前 codex/desktop-foundation 含 P4/P5 未提交依赖，原位增量开发，对主要既有实现保存改前副本，不 reset/clean 或批量提交已有工作。

## Review Focus
1. 无样本服务声音与旧档案迁移不能自动标为通过（Task 1）。
2. 改名、换图、换默认声音不能替换历史对白/时间线（Tasks 1–2/7）。
3. 克隆超时、重复点击和 int64 ID 不得重复提交或改错文件（Task 3）。
4. 缺句/超时/换版本不得充当整段配音，起点不得重复累加（Task 4）。
5. 画布/Agent/对白冲突不能绕过声音权威（Task 6）。

## File Structure
源码相对 D:/movieAgent/libtv-studio。
- contracts/character-voice.ts：保留旧字段，新增来源、供应商绑定、默认绑定和历史。
- domain/voice-identity.ts：纯身份指纹与声音指令。
- engine/voice-input-resolver.ts：按项目/路线统一解析实际声音。
- providers/voice-management.ts：MiniMax 目录、上传、克隆编解码及无损 ID。
- engine/voice-management-service.ts：计划、逐步回执、缓存与恢复。
- desktop main/provider-capability.ts 与 engine-host.ts：凭据与 HTTP 能力；renderer 不接触 Key。
- domain/dialogue-audio-assembly.ts：逐句完整性与时长计划；engine 复用本地派生作业。
- renderer：沿用角色/资产/对白/试听界面，新增声音列表与克隆面板。
- canvas/graph-plan：扩展 voice_reference 与稳定角色映射。

## Task 1：契约、声音修订和角色默认绑定
Files: contracts/character-voice.ts；domain/character-voice.ts；engine/character-voice-service.ts；storage/database.ts 与新 migration；tests/integration/voice-identity.test.ts。
Interfaces: 继续 voice.save；新增 voice.bindDefault、voice.history；list 返回默认绑定。旧 reference 可读，纯 ttsBinding 无需样本。
- [x] 写失败测试：无样本保存、两个候选、跨项目、CAS、旧档案与唯一默认迁移。
- [x] 运行目标测试观察缺少能力造成的失败。
- [x] 扩展数据/解析器/迁移/服务，保留固定 id/revision，不制造 verified/passed。
- [x] 目标测试及已有 character-voice/voice-migration 回归通过；类型检查通过，记录结果。

## Task 2：统一解析和生成
Files: domain/voice-identity.ts；engine/voice-input-resolver.ts；dialogue-production-service.ts；audio-service.ts；voiceover-authority.ts；providers/audio-protocol.ts；tests/integration/voice-resolution.test.ts；tests/integration/minimax-speech.test.ts。
Interfaces: resolveVoiceInputs 固定 voiceRef、角色索引、样本、providerVoiceId、实际参数、指令和未映射字段；预设不被修改。
- [x] 写失败测试：特殊 ID 无损、角色 voice 优先、口音/表演说明实际注入、多角色映射、旧版本、voiceover/dubbed 配音共用。
- [x] 实现解析并接入 prepare/approve 请求快照，按语义区分身份与外观资格。
- [x] 增加纯音频试听审核，口型为不适用；保留三情绪资格。
- [x] 相关核心回归与类型检查通过。

## Task 3：声音目录、克隆、恢复
Files: contracts/voice-management.ts；providers/voice-management.ts；engine/voice-management-service.ts；desktop main/provider-capability.ts 与 engine-host.ts；commands/queries/router/bootstrap/preload；tests/integration/voice-management-protocol.test.ts；tests/integration/voice-management.test.ts。
Interfaces: voice.catalog；voice.clone.prepare/approve/get/reconcile；VoiceCloneJob 持久化逐步原 ID/hash；验证复用 Task 2 音频生成。
- [x] 本地 HTTP 失败测试：目录缓存/不支持、手填、10–300 秒/20 MB、int64、unknown/重复点击/重开。
- [x] 实现具体协议与现有主进程网络/凭据路由。
- [x] 持久化上传/克隆/验证；未知不自动重发、不换 ID、不转官方 URL。
- [x] 确认同一候选 ID 用于一次 TTS 验证；输出正常收存，仍需人工审听。

## Task 4：逐句本地合成与确认
Files: contracts/dialogue-production.ts；domain/dialogue-audio-assembly.ts；engine/dialogue-production-service.ts 与媒体派生实现；tests/integration/dialogue-audio-assembly.test.ts；tests/integration/dialogue-assembly-workflow.test.ts。
Interfaces: DialogueAudioAssembly 完整 turn 清单；ConfirmedDialogueAudio.source.kind=audio-assembly，完整镜头 WAV，下游 startTicks=0。
- [x] 失败测试：缺句/重复/错声音/超时/重叠，短句补静音与精确时长。
- [x] 实现纯计划验证与现有本地 FFmpeg 作业，不发模型请求。
- [x] 确认时校验来源和完整性；单句直接确认仅一 turn；整段导入保存人工覆盖确认。
- [x] 解码检查合成时序/时长；旧结果保留。

## Task 5：界面与用户流程
Files: CharacterVoicePanel、AssetLibrary、VoiceAuditionPanel、ShotDialoguePanel、audio workspace，新增 VoiceLibrary/VoiceClonePanel；tests/renderer/voice-identity.test.ts、voice-management.test.ts。
Interfaces: 仅公开命令/查询；material/provider/review 分开；草稿不执行远端操作。
- [x] mounted 失败测试：服务声音、目录失败手填、默认确切版本、草稿与迟到回执。
- [x] 声音列表/来源切换/克隆计划与恢复/版本与用途状态。
- [x] 纯音频资格、逐句结果选择、完整合成确认。
- [x] renderer 测试、类型及构建通过。

## Task 6：画布与 Agent
Files: contracts/canvas.ts；domain/graph-plan.ts；canvas-service、generation-service；Agent 工具入口；CanvasWorkspace/Card；tests/integration/canvas-voice.test.ts。
Interfaces: voice_reference 边包含 characterId/voiceRef；已绑定对白拒绝冲突；统一使用 Task 2。
- [x] 失败测试：普通音频冒充、同角色双声音、跨项目、未使用提示、对白冲突。
- [x] 扩展 schema/端口和稳定映射；不支持能力时阻止准备。
- [x] 接入卡片选择与 Agent 查询/提案；最终确认可见。
- [x] 画布/Agent 回归通过。

## Task 7：历史、导出、备份与交付
Files: maintenance、project-backup/transfer、voice-export、timeline/render；tests/integration/voice-export.test.ts、voice-migration.test.ts；本目录 verification/。
Interfaces: 新增引用由现有对象存储导出/恢复；历史使用固定快照，恢复不带 Key。
- [x] 失败测试：全媒体引用、离线恢复、无凭据、远端未核验、历史时间线。
- [x] 完成遍历与导出 manifest，复用历史策略。
- [x] 核心全套、相关 renderer/media、类型、构建通过；新包资源/ABI/媒体完整性与单次 Electron IPC 场景通过。真实声音与桌面人工功能验收不冒充已完成，见 acceptance.md。
- [x] 独立增量代码审阅，重要问题用回归测试修正。
- [x] 回填 AC-01–23 证据与真实服务未验项。

## 执行方式
用户已授权开发；本会话按依赖连续实施，不逐任务重复问许可。进展和偏差写 progress.md；当前工作树很脏，提交留到能准确隔离本次增量时再处理，不把原有用户改动混入提交。

## 收尾证据

2026-10-30：七个工程任务完成。核心 103 文件/807 用例、相关界面 10 文件/43 用例（两套最新补测覆盖旧结果）、媒体 5 文件/8 用例，以及新包单个 Electron IPC 场景通过；类型、构建、打包验证通过。完整 AC 映射、重跑原因、真实服务未验项和启动入口见 [acceptance.md](acceptance.md)。不提交/合并已有脏工作树。
