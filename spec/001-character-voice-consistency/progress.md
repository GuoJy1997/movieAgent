# SDD ledger — plan: D:/movieAgent/spec/001-character-voice-consistency/plan.md

- 2026-10-30：用户批准并开始开发。
- Ruling: 原位保留 codex/desktop-foundation 的 P4/P5 未提交实现并备份本次改前文件，避免 worktree 丢失依赖；不 reset/clean。
- Pre-flight: T1→T2 声音契约；T2→T3 固定 TTS；T1–4→T5 公开命令；T2→T6 解析器；T1–6→T7 媒体引用。统一遵从 spec。
- 基线：类型检查通过；默认高并发核心测试未在120秒内完成，限定2 worker重新运行，之前输出保存 baseline-0.log。
- Ruling: 全套基线运行较慢，开发前先使用声音/对白/音频针对性基线；最终仍运行核心全套。baseline-core 为中止记录，不能写成全通过。
- Task 1: complete — 新增3项声音身份测试先 INVALID_INPUT 失败后通过；连同旧角色声音与迁移，3文件/7测试通过；task1-types-ok 类型检查通过。新增 schema24 与默认绑定/历史查询。

### 后续实施检查点（2026-10-30）
- T2：固定 TTS voice 请求、旧显式 voiceRef、H3 口音/表演指令已接通；纯音频三情绪资格测试通过（task2-qualification-fixed），单批原因例外已接入，完整回归进行中。
- T3：目录/上传/克隆/短句验证 9 项及后续 10 项相关回归通过；增加克隆预算预留、并发范围比较、同步写事务、逐步未知状态恢复和任务列表。真实供应商未调用。
- T4：实际 FFmpeg 拼接 3 项通过；完整两句 TTS→审核→合成→确认→重开工作流 1 项通过（task4-workflow-verified）；多句禁止单 take 直接确认，整段导入需覆盖确认，assembly 对齐起点强制 0。
- T5：声音来源/手填/目录、克隆恢复、纯音频试听、角色默认、历史、项目声音库、逐句拼接界面已接入。现有 Chromium 1243 mounted 测试 6 项通过（task5-ui-browser），无 Electron 启动。
- T6：voice_reference 专用端口 + 显式媒体声音绑定；普通音频不可冒充；同角色冲突阻止；画布工作流与 direct generation 共用 resolver。canvas-voice 集成通过。Agent 固定角色默认声音上下文通过；后期 Agent 受限别名与来源保护已补。task6-types-3 类型通过。
- T7：新增多用途媒体快照与 provider-only voice.json，保留旧 WAV 导出格式；schema25 扩展引用索引。类型通过（task7-types）；交付测试遭全套并行资源争用超时，需单独复验；旧 TTS 绑定迁移测试先发现配置 parser 的旧 ID 限制，已统一放宽合法 ID，迁移逻辑待补。
- 核心全套 regression-core-incremental 正在后台；其中旧“所有旧声音失效”断言与新 spec 冲突需更新，媒体测试存在 10 秒超时需低并发定位。尚未宣称全套通过。
- 按 requesting-code-review 技能派出只读独立 reviewer /root/spec001_code_review，审阅以 verification/before 和 changed-files.json 为准，不把预存 P4/P5 差异混入。

### 最终工程收尾（2026-10-30）

- T2–T7 均完成；固定历史声音、角色当前外观、批量换版、三情绪音频资格、克隆未知状态恢复、逐句本地合成、画布与 Agent、完整声音导出与备份均有用例覆盖。
- 新增两角色三镜头、六次生产适配器 TTS 请求测试；仅连接本地 fixture HTTP，断言实际 voice ID 与台词映射，公共预设不改写，未验证真实音色。新增目录项目备份/恢复测试覆盖 source/video/baseline 三类真实 WAV 字节、默认 v1 与历史 v2、暂停执行恢复。
- 修复独立审阅问题后，最终 core-complete：103 文件/807 用例通过。早前 core-final 有两项失败，针对性修复与重跑结果保留；不能把旧失败日志当成最终通过证据。
- 最终 renderer 使用 renderer-final 中未被替换的 8 套结果与 renderer-complete 最新 2 套结果：共 10 文件/43 用例通过；旧 voiceover fixture 缺 voice.history 已修正。media-complete：5 文件/8 用例通过。
- types-delivery 无诊断且退出 0；build-delivery 成功。新包 release-spec001 的 Electron/SQLite/sharp、preload、CSP、媒体运行时资源校验通过。
- 最终单个 Electron IPC 场景在隔离临时库运行。第一次发现旧测试未列出已有 exportVoice；修正公开 API 清单并补充非法参数/未授权窗口声音导出断言后通过（electron-verified），同文件另一个未选场景未执行。不操作用户原有 Electron 进程，不把该边界测试称为声音人工验收。
- 独立最终复核无 Critical/Important/Minor 未决项。详细 AC-01–23、运行命令、包与入口、未验项见 acceptance.md。
- 保存旧启动脚本后，根目录启动入口切到新 release-spec001；旧 P5 包、模型配置与创作目录不变。既有未提交修改保留，不合并或批量提交。
- 真实模型请求数 0；本轮真实生成费用 0。声音相似度、方言、真实账号目录/克隆权限、跨路线听感均未验。

- 收尾环境记录：向先前文件写入辅助终端 session 66998 发送清理输入被自动审批拒绝，理由是遗留缓冲可能被提交；停止该可选清理，不再向该会话输入。没有阻断开发、测试、打包或启动入口更新。

### 主流程补查（用户后续要求，2026-10-30）

发现并修复两项界面衔接：重复的合成入口未交给对齐控件；确认弹层嵌在镜头 form 中导致批准/导航异常。先以 mounted 测试复现失败，再改组件；Dialog portal 和 submit 隔离后完整界面回归 18 文件/89 用例通过。真实桌面成片场景补充 UI TTS→审核→整段合成→确认→对齐并通过。模拟预算 100 小于已预留 110 的一次失败为预期业务阻止，调整 fixture 预算后继续，不改实际用户预算。

报告与最终证据：../../verification/2026-10-30-main-flow/report.md。当前包 release-flow-verified。核心本轮 103 文件/807 用例通过，engine 源码校验未变；新包与媒体输出验证通过。容量验证复现第 65 个视频片段被拒绝，保留当前限制并明确报告。无真实模型调用。
