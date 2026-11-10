# SPEC-003 Implementation Plan：预算继承、ZIP 稳定性与密集时间线

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Agent 无意覆盖预设和 ZIP 偶发超时；交付可编辑、可渲染、可恢复的 256 画面片段时间线。

**Architecture:** 在现有 React / 本机引擎 / SQLite / FFmpeg 链路内修复；导出使用专用内部等待策略；编辑代理分批；大渲染内部切段。父子项目、固定引用、审批、任务费用和不可变修订语义继续沿用。

**Tech Stack:** Windows Electron 45、React 19、TypeScript、Node 24、SQLite、FFmpeg 9、Vitest / Playwright。

**Spec:** [SPEC-003](spec.md)（Approved，2026-11-01）。

**状态:** Implemented（三项主修复已交付）；本地自动化工程验收通过，保留两项Minor与人工/长期资源观测未验。不是整份SPEC无条件Verified。证据见 ../../verification/2026-11-01-spec003/report.md。

## Global Constraints

- 工作区 D:/movieAgent，源码 libtv-studio/；命令默认在源码根执行，使用当前 Node 24 / npm 环境。
- 先保存只读 git 状态和当前目录包信息，保护既有约 370 项工作树改动。检查实施时真实状态，不使用 reset / clean，不在用户创作库试验迁移。
- 只做 A、B、C 三项；新文档更新本需求目录。图像 / 声音配置、Linux / 远程不加入范围。
- 测试使用隔离应用配置、本地媒体与供应商 fixture，真实模型请求数为 0；不读取 / 输出用户 Key。
- 以下测试文件标“新增”的在实施时创建；既有文件按实际测试风格扩展。不把审计临时脚本直接当长期自动化。
- 每项遵循先能暴露旧行为的测试、再改产品、再定向回归。C 的 64 段旧限制不是回归，更新旧断言须有新容量边界依据。
- A / B 可先发布稳定目录包；C 的容量、预览和分段渲染必须一起发布。构建失败不更新启动入口。
- 不在本轮自动提交、推送、出安装包或变更用户模型配置。

## Review Focus

1. 继承状态与旧派生预设混淆、切模型仍带旧覆盖 → Task A 测试 A1/A2。
2. 写回执超时但内部已完成，重试或迟到失败覆盖成功 → Task B1/B2 测试 B1/B2。
3. 慢 hash / 过期租约 / 迟到 open 泄漏，扩大等待掩盖卡死 → Task B1/B2 的阶段追踪、硬上限与资源断言。
4. 画面扩到 256，仍被音轨 128、代理 64、manifest 320、命令 30000 或字节上限卡住 → Task C1/C2/C3/C4。
5. 分段后丢声音、字幕重复、边界漂移，或旧包误写新库 → Task C3/C4 的真实字节与版本兼容验证。

## 批次与门槛

| 批次 | 任务 | 交付门槛 | 依赖 |
| --- | --- | --- | --- |
| A | 预算默认继承 | A1/A2，无真实请求 | 无 |
| B | B1 定位 / 策略，B2 导出恢复 | B1/B2/B3，正常导出无需重试 | A 可先交付；B2 依赖 B1 |
| C | C1 合同 / 迁移，C2 预览，C3 渲染，C4 全链验收 | C1–C6 全部通过 | 依赖 B 的导出稳定性 |
| R | 统一回归 / 目录包交付 | R1，证据与状态更新 | 待交付批次的所有任务 |

不承诺基于代码行数的固定工时。A 较小；B 工作量取决于实际超时阶段；C 是主体，包含渲染策略和兼容验证，不能按“把 64 改成 256”估算。

## Task A：Agent 默认沿用预设

**Files**
- 修改 apps/desktop/src/renderer/features/agent/AgentWorkspace.tsx。
- 按需扩展 tests/fixtures/p3-renderer/runtime.ts、main.tsx 的现有 Agent 挂载入口。
- 新增 tests/renderer/agent-budget.test.ts。
- 扩展 tests/integration/agent-planning.test.ts、agent-recovery.test.ts；engine/src/agent-service.ts 仅在测试发现继承语义不完整时修改，不改变历史派生行为。

**Interfaces**
- 保留 PreparedAgentTurn / PrepareAgentTurnInput 的既有 outputTokens?: number。
- 空值省略属性；显式值保持 1–8192 校验。界面状态范围键由 sessionId + profileId/revision 组成。
- 有效值展示从当前选中预设及模型参数字段解析；没有显式配置时给出文字状态。

- [x] RED：挂载真实组件，断言默认请求无 outputTokens；预设 8192 和另一个不同值均保留；当前 4096 初值应使测试失败。
- [x] GREEN：改空默认、来源提示和恢复继承操作；只在范围键变化时清空覆盖。
- [x] 覆盖手填、空白、非法数字、切会话 / 模型 / 修订、普通重绘、准备后改值。未准备成功不出现审批或任务。
- [x] 引擎对照原预设内容、派生预设与旧计划 hash 未改；继承 prepare 不发 HTTP。
- [x] 验证：先运行 npx vitest run --config vitest.renderer.config.ts tests/renderer/agent-budget.test.ts；再运行 npx vitest run tests/integration/agent-planning.test.ts tests/integration/agent-recovery.test.ts；通过后记录 A1/A2。

## Task B1：定位导出超时，建立专用等待策略

**Files**
- 修改 apps/desktop/src/main/engine-host.ts、engine-process.ts、timeline-export.ts。
- 新增 apps/desktop/src/main/export-request-policy.ts（内部策略与脱敏 trace）。
- 新增 tests/integration/timeline-export-timeouts.test.ts；扩展 timeline-export-ipc.test.ts。
- 诊断资料保存在 verification/YYYY-MM-DD-spec003/，引用既有 verification/2026-11-01-main-flow/，不改原失败日志。

**Interfaces**
- 内部 ExportTraceContext：requestId、exportId?、stage、fixedRevision；仅传受控元数据。
- 内部 ExportRequestPolicy：固定 RPC kind 的 timeoutMs、trace 和迟到结果清理回调；默认普通请求路径不变。
- 给 timelineExporter 传入导出专用 MediaIO 包装；renderer / preload 不获得可设置超时或任意文件能力。
- 保留对外 Result 与现有导出 requestId；导出器维护整体 30 分钟 deadline，复制空闲 120 秒 deadline，按 spec 5.2 的阶段策略取更早边界。

- [x] RED：可控引擎传输分别延迟 prepare/open/read/outcome 超过旧 5 秒；用可控时钟验证，不让测试真实睡满两分钟。
- [x] 归档原件冷校验、热缓存、排队与回执各阶段时序；写明找到的实际 RPC，或明确自然故障仍未复现。不可只增加测试等待时间。
- [x] GREEN：实现专用策略表、慢阶段 trace 和超时错误上下文；不改变 execute、普通媒体调用、供应商、全局关闭 deadline。
- [x] 对真实卡死验证有限退出；close 的单独失败不能掩盖原错误。验证晚到 open 成功会关租约、引擎退出会解除本进程资源。
- [x] 保持主进程 sender 校验与 preload 白名单；用 IPC 测试证明 renderer 不能注入 timeout / trace / 路径。
- [x] 验证：npx vitest run tests/integration/timeline-export-timeouts.test.ts tests/integration/timeline-export-ipc.test.ts；日志无凭据、签名 URL 或媒体正文。

## Task B2：复制续期、状态核对与同请求恢复

**Files**
- 修改 apps/desktop/src/main/timeline-export.ts、packages/engine/src/export-records.ts。
- 修改 apps/desktop/src/renderer/features/timeline/ExportDialog.tsx（阶段、取消中、结果待核对）。
- 扩展 tests/integration/timeline-export.test.ts；新增 tests/renderer/timeline-export-recovery.test.ts，使用现有 tests/fixtures/p4-renderer/ 挂载方式。
- 必要时扩展 engine-host.ts 的受控同请求状态查询；不暴露 export 内部命令到 preload。

**Interfaces**
- 继续沿用 ExportInput / ExportReceipt / 同 requestId 重试协议；不生成第二份渲染或模型任务。
- 内部 copyFixedSource：固定 ref/hash、offset、expectedLength、signal、deadline；剩余租约不足 45 秒时受控重开并校验身份。
- 超时写入为“未确认结果”，先查询原 operation；只有确认的状态才能更新 UI 或执行后续发布。

- [x] RED：注入租约跨两分钟、超时后迟到 open / outcome、引擎断开、verified 后确认丢失、同 ID 双请求、目标同名异 hash；分别覆盖 verified 后尚未发布的取消 / 重开，以及取消与已开始 link 的竞争。
- [x] GREEN：实现受 deadline 约束的重开续读、唯一复制执行、迟到资源释放和状态核对。临时文件清理必须校验本操作拥有关系。
- [x] completed 不降级；verified 仅可因明确取消转 cancelled，一般确认丢失仍保留待核对。cancelled 禁止同 ID 自动重开复制 / 发布；用户重新导出须明确新操作，复用固定修订与产物。取消与已开始发布竞争时按 spec 5.3 核对，已发布的本操作文件收敛 completed，未发布收敛 cancelled，未知继续核对。迟到回包不能复活取消任务；取消确认前不显示已取消。失败保留原 requestId 与固定媒体来源。
- [x] 扩展挂载界面测试：阶段、可重试错误、取消中、结果待核对、仅重试复制；切换页面后不把旧操作附到新时间线。
- [x] 运行 npx vitest run tests/integration/timeline-export.test.ts tests/integration/timeline-export-timeouts.test.ts；另运行 npx vitest run --config vitest.renderer.config.ts tests/renderer/timeline-export-recovery.test.ts。
- [x] 在 Task R 的目录包中执行 B3 冷 / 热各 5 次五格式导出，保存 ZIP 条目与 hash、无新增 render/task 的断言。若失败则本批不结案。

## Task C1：统一容量合同与版本保护

**Files**
- 修改 packages/contracts/src/timeline.ts、render.ts、schema.ts。
- 新增 packages/contracts/src/timeline-limits.ts（共享上限，不改无关 hash / 生成上限）。
- 修改 packages/domain/src/timeline-edit.ts、render-plan.ts 及 packages/engine/src/timeline-service.ts、render-service.ts 中实际使用边界的位置。
- 新增 packages/storage/src/migrations/0028-timeline-capacity.ts；修改 packages/storage/src/database.ts。
- 扩展 tests/integration/timeline-edit.test.ts、timeline-assembly.test.ts、timeline-migration.test.ts、render-lifecycle.test.ts；新增 tests/integration/timeline-capacity.test.ts。
- 核对 packages/storage/src/project-transfer*.ts、maintenance.ts 与对应备份恢复测试的 schema 判断，只改确有硬编码依赖处。

**Interfaces**
- MAX_TIMELINE_VIDEO_CLIPS=256，MAX_TIMELINE_AUDIO_CLIPS_PER_TRACK=256，MAX_RENDER_MANIFEST_ENTRIES=768。
- 保留 MAX_TIMELINE_TICKS、1 MiB payload、100 op、1000 cue、派生单批 64 和生成单批 16。
- 容量检查区分 limitKind / limit / actual，界面显示可读原因；不放宽其他畸形数据的校验。
- schema 28 是下一迁移号提案；历史 JSON 不重写，旧库通过备份候选迁移升级。

- [x] RED：对 64/65/128/256/257 画面、128/129/256/257 各音轨、600 秒上下边界、1 MiB 上下边界写契约与原子写入断言。
- [x] GREEN：引用共享常量；粗剪和手工编辑都受同一规则约束；拆分在满额时原子拒绝，不部分采用。
- [x] 测 256 个含配音对白组的粗剪；第 257 个不提交修订，原历史 / selection / provenance 不变。保持跨子项目引用授权。
- [x] 用旧 schema 27 副本验证备份迁移、候选失败保护、外键完整、旧修订读取与恢复；模拟旧包拒绝 schema 28。
- [x] 验证正式 manifest 768 通过、769 拒绝，派生 manifest 仍不超过 64；不要修改 SHA-256 的长度规则。
- [x] 运行 npx vitest run tests/integration/timeline-capacity.test.ts tests/integration/timeline-edit.test.ts tests/integration/timeline-assembly.test.ts tests/integration/timeline-migration.test.ts tests/integration/render-lifecycle.test.ts；记录 C1/C6。

## Task C2：编辑代理分批与密集轨道交互

**Files**
- 修改 apps/desktop/src/renderer/features/timeline/TimelineWorkspace.tsx、TimelineTracks.tsx、TimelineWaveform.tsx。
- 按实测修改 TimelinePreview.tsx；保留只挂载活动媒体的机制。
- 新增 apps/desktop/src/renderer/features/timeline/preview-batches.ts（纯分组与结果归并）。
- 扩展 tests/renderer/timeline-editor.test.ts、timeline-preview.test.ts；新增 tests/renderer/timeline-capacity.test.ts，按需扩展 p4-renderer fixture。

**Interfaces**
- batchPreviewReferences(timeline, settings)：按固定引用及 fps/canvas/fit 去重分组，每批最多 64。
- 批次状态：待准备 / 待确认 / 已入队 / 成功 / 失败；已确认的批次沿用现有 media.enqueue 流程。
- 每批绑定子项目、时间线与修订；新修订保留仍兼容的已生成代理，废弃旧的未确认计划。页面离开停止排后续批次；已入队作业显式显示并允许取消。

- [x] RED：65、150、256 不同素材能产生多个合法批次；同 hash 不同 fit 按配方隔离，不把两个子项目的引用混在一起。
- [ ] GREEN：串行准备、逐批确认与入队，汇总状态；成功批次可立即预览，失败只重试该批。不能无审批自动启动所有本地作业。
- [x] 给波形 / 缩略图做可视区域加载、缓存和卸载取消，避免每次播放头更新重拉全部资源；只有性能数据证明需要才加轨道虚拟化。
- [x] 测批次失败 / 取消、切时间线 / 子项目、旧回包、未保存草稿、兼容代理复用，以及满额后删除 / 裁切 / 替换仍可用。
- [ ] 运行 npx vitest run --config vitest.renderer.config.ts tests/renderer/timeline-capacity.test.ts tests/renderer/timeline-editor.test.ts tests/renderer/timeline-preview.test.ts；实测 3 秒打开、p95 100 ms 交互与 100 次 seek 后资源稳定，保存机器参数和样本。

## Task C3：受控分段渲染与单份最终交付

**Files**
- 修改 packages/engine/src/media/compile.ts、render-service.ts、packages/domain/src/render-plan.ts。
- 新增 packages/engine/src/media/render-segments.ts（确定窗口、局部时间映射、串接）。
- 按需修改 media/process.ts、verify.ts、work-queue.ts 的进度与取消接线；不得解除受控执行边界。
- 新增 tests/integration/render-capacity.test.ts；扩展 render-resources.test.ts、render-recovery.test.ts。

**Interfaces**
- segmentRenderPlan(plan)：内部确定窗口；每段不超过 30 秒、32 个独立输入，帧对齐，固定 source offsets。不引入用户可编辑的任意 FFmpeg 参数。
- 所有窗口归属一个固定 RenderPlan / jobId；内部进度换算为全时间线 ticks，不伪造新的生成资产。
- 片段视频为统一 48000 timescale 的仅视频 MP4，一次编码后复制串接；音频为独立 48kHz 双声道 f32le 原始采样，按固定采样数串接，在最终编码前做一次全局 limiter。文件位于本作业暂存目录，最终产物按原验证发布机制处理。
- 选择原路径或分段只属于执行策略，不能重写历史 planHash / compositionHash；旧 INTERRUPTED 作业显式恢复时适用当前受控执行器。

- [x] RED：当前编译器面对大量不同输入触及命令 / 资源边界；新增 32/33 输入、重复固定引用、跨段 trim、音视频流选择的编译测例。
- [x] GREEN：实现确定性窗口与 sourceIn / timelineStart 映射、黑场 / 静音、跨段字幕；输入参数继续短相对路径，命令估算不超过 30000。
- [x] 实现顺序段渲染、可串接视频参数、未限幅浮点音频中间文件、最终统一声音处理；禁止每段 AAC 编码后直接拼接。
- [x] 中间默认 2 GiB、硬上限 8 GiB，计入现有 diskBudgetBytes；预算与空间预检覆盖原件暂存 + 中间额度 + 最终预估 + 1 GiB 余量，不能自动扩大。测试注入低预算、写入超额和正常容量；运行中超限停止、保留原件。单帧窗口仍超 32 输入时明确预检失败，不丢音频。
- [x] 测原视频未静音声、原生对白组、配音、音乐、音量、源头裁切、跨段字幕、黑场尾巴；比较小图 / 短音频参考，帧误差不超过 1、PCM 误差不超过 1 sample。
- [x] 测取消、磁盘不足、子进程失败、引擎重启：仅当前 job 的进程 / 临时文件受影响；未验证中间文件不复用，恢复只重做本机渲染。
- [x] 运行 npx vitest run tests/integration/render-capacity.test.ts tests/integration/render-resources.test.ts tests/integration/render-recovery.test.ts；需要真实 FFmpeg 的长用例单独设置有依据的 testTimeout，保留阶段记录；再执行 C4 的字节验收。

## Task C4：整集与最大容量本地验收

**Files**
- 新增 tests/electron/spec003-production-capacity.test.ts。
- 新增 tests/fixtures/timeline-capacity-media.ts（合成不同 hash 的视频 / 图片 / WAV 与字幕）。
- 结果写入 verification/YYYY-MM-DD-spec003/；不得覆盖既有真实验收工程。

**Interfaces**
- Case dense-episode：300 秒、150 画面片段、配音 / 音乐 / 字幕。
- Case max-clips：256 画面 + 256 独立配音 + 一条背景音乐；缩短各段时长控制本地测试成本，包含视频 / 图片和跨窗口对白。
- Case boundary：768 manifest 及最大音轨计数用于契约 / 准备测试；不把只测保存写成 768 路完整解码通过。

- [x] 使用 24/25/30fps 的边界映射测试，实际主场景用 1080p/30fps；一份长中文工作路径验证 Windows 参数边界。
- [x] 从真实界面建粗剪 / 编辑 / 保存 / 重开 / 恢复旧修订，确认集归属、固定来源与共享资产无变化。
- [x] 分批准备代理；正式 MP4/WAV 渲染、SRT/CSV/ZIP 导出；核对每段 provenance、ZIP 条目 / hash，完整解码 MP4/WAV。
- [ ] 核验总帧数、声画时长、跨段字幕、首尾、黑场 / 静音、听感与接缝。人工播放至少覆盖开头、两个分段接缝和结尾。
- [x] 运行 npx vitest run --config vitest.electron.config.ts tests/electron/spec003-production-capacity.test.ts；本文件单独声明长媒体测试的合理超时，保留分阶段耗时，禁止用整体超时增加掩盖无进度。
- [x] 报告真实请求数 0，区分合成素材工程验收与真人质量未验；逐项填写 C1–C6，不使用一个“通过”覆盖失败阶段。

## Task R：回归、目录包与交付证据

**Files**
- package 配置与脚本沿用 apps/desktop/package.json、electron-builder.yml 和 scripts/verify-package.mjs 的实际入口。
- 更新本需求 spec.md / plan.md 的实现与验收状态及 spec/README.md；不修改历史审计结论。
- 启动入口仅在目录包验收通过后更新 D:/movieAgent/启动MovieAgent.cmd 等实际现有入口。

- [x] 运行 npm run typecheck、npm test（默认仅 integration）、npx vitest run --config vitest.renderer.config.ts、npx vitest run --config vitest.media.config.ts、npm run build；任一失败需归因，既有失败也不能标全绿。
- [x] 先检查实际 electron-builder 配置，将本批产物放入独立 release-spec003-*/win-unpacked。目录包命令：npm run package:win -- --dir -c.directories.output=release-spec003-production-reliability（实施时核对配置和输出位置）。
- [x] 运行 npm run verify:package -- --dir apps/desktop/release-spec003-production-reliability/win-unpacked，验证 SQLite / Sharp / FFmpeg 等运行时；比较 out 与 ASAR 实际文件，保存当前源码和包标识。
- [x] 在隔离配置启动目录包，执行 A 界面检查、B3 冷 / 热各五次链、C4 长媒体链；用例必须指向新包，不借用 dev 页面作为桌面验收。
- [x] 核对用户 models.json 和既有项目未改；目录包通过后更新启动入口，保留原包。C 升级用户库必须沿用产品自动备份机制，不由测试脚本抢占用户库。
- [x] 保存 report.md：每项状态、命令退出码、耗时、包路径、MP4/WAV/ZIP 字节与 hash、原 ZIP 故障根因是否得到证实、剩余未验。
- [ ] 仅全部对应门槛通过后标记该批 Implemented / Verified；真实服务质量仍标未验。回退 A/B 可切回旧包，C 按 spec 6.4 兼容备份恢复，不修改 schema 倒退。

## 自审与执行交接

自审对应：规格 4 → A；5.1/5.2 → B1；5.3 → B2；6.1/6.4 → C1；6.2 → C2；6.3 → C3；验收 7 → C4/R。没有让模型接入、费用清算或远程部署混入本批。独立 builder check 指出的 verified 后取消与恢复歧义已按 spec 5.3 澄清；renderer / media 回归使用各自配置，不能仅运行默认 npm test。

用户已于 2026-11-01 授权执行。A/B/C三项主修复与R本地自动化工程验收通过，启动入口已更新；保留下面未闭合门槛。全部测试使用隔离工程，真实供应商调用0。逐项结果以 ../../verification/2026-11-01-spec003/report.md 和 progress.md 为准；不把目录包合成素材验收写成真人质量验证。

## 最终门槛边界

未勾选项刻意保留：C2批次汇总终态未同步（本机作业面板可看实际状态/取消/恢复/重试）；性能打开/选择/拖动/缩放与100次定位播放器已测，但未对全部读取租约和活动波形做长期连续计数；C4人工播放听感未验；因此R整份SPEC全部对应门槛不标无条件Verified。30分钟执行中止后的有界核对还保留第二项Minor。

最终工程结果：核心120文件863/863，媒体13文件30/30，强化字幕参考1/1，最终renderer23文件104/104，Electron新包UI/复制2/2。最后只改 renderer 的详情懒加载和波形读取队列，main/preload 字节不变；300秒/256段真实媒体证据与最终UI证据分别保存，未用旧UI数据冒充新包实测。新包256段UI打开421ms、缩放/定位p95 57.1ms，原3秒/100ms门槛保留。所有历史失败留档；模型调用0，用户配置hash/mtime不变。

## 2026-11-02 收尾修复计划（待执行）

本节补齐前文未闭合门槛，沿用同一规格。2026-11-01 的通过记录及两项 Minor 保留为历史证据。本节仅完成源码核对与计划，尚未修改产品代码或重新验收。

实施顺序 F1 → F2 → F3 → F4。沿用 Windows 本机、隔离工程、模型调用 0、保护配置及创作目录约束，不提交或发布混有历史改动的工作树。

### Review Focus

- 入队回执早于 render.list 更新：保留已入队，不能显示失败或重复提交（F1）。
- 在批次汇总或下方作业面板重试：两处须指向同一新尝试（F1）。
- 等目录锁、RPC 或无法即时取消的文件操作时截止：调用按时返回，但未结束的操作仍持有锁和同 ID 排他保护（F2）。
- 发布已开始而确认迟到：保留结果待核对，同 requestId 恢复，不误报取消成功或再发布（F2）。
- 导航或连接 epoch 改变后授权迟到：不更新新界面、不续排旧任务，最终资源计数回到基线（F1/F3）。

### Task F1：代理批次与真实作业状态同步

**源码依据：** preview-batches.ts 只有 waiting/prepared/enqueued/failed；TimelineWorkspace 批准后仅写 enqueued，未保存 jobId 或关联 render.list。LocalJobControls 已有取消、恢复和同计划重试。

**Files：** 修改 apps/desktop/src/renderer/features/timeline/preview-batches.ts、TimelineWorkspace.tsx、ExportDialog.tsx；扩展 tests/renderer/timeline-capacity.test.ts 及 tests/fixtures/p4-renderer/；新增 tests/integration/preview-batch-state.test.ts。

**Interfaces / 决策：**

- LocalPlanApproval 的 onEnqueued 回调传实际 LocalJobRef，沿用 commands.ts 合同，不假定它是完整 RenderJobView。
- PreviewBatch 保存 jobId、固定 planId/executionOwner。纯函数 resolvePreviewBatch(batch, jobs) 根据现有 render.list 推导排队、执行、成功、失败、取消、中断；已知 jobId 暂未被 list 读到时保留已入队。不为每行增加完整计划查询。
- 未取得 jobId 的准备失败可重新 prepare；执行失败后的明确重试用 render.retry，中断恢复用 render.resume，同一固定计划不变。汇总与下方面板两处入口都回传新 LocalJobRef，更新对应批次；成功批次不重新排队。
- 继续逐批明确确认；导航、修订、画面适配或连接范围改变时忽略旧准备回包。界面使用中文状态。

- [x] RED：纯函数及组件覆盖 SUCCEEDED/FAILED/CANCELLED/INTERRUPTED、list 延后、两批部分成功、两处入口重试的新 jobId；先记录当前实现的失败。旧 prepare 失败测试不代替执行失败测试。
- [x] 接通回调、状态映射和现有恢复命令，补导航/连接变更/迟到回包断言。
- [x] GREEN：npx vitest run tests/integration/preview-batch-state.test.ts；再运行 npx vitest run --config vitest.renderer.config.ts tests/renderer/timeline-capacity.test.ts tests/renderer/timeline-editor.test.ts tests/renderer/timeline-preview.test.ts。断言成功批次 enqueue 次数不增加，重试只针对选中失败批次。

### Task F2：执行、核对与关闭共享 30 分钟总预算

**源码依据：** timeline-export.ts 的 1800000ms 定时器只停止执行；catch 直接调用 prepare/outcome，finally 另等 close。engine-host.ts 为这些 RPC 各分配固定期限，未扣除整个调用消耗。

**Files：** 修改 apps/desktop/src/main/timeline-export.ts、export-request-policy.ts、engine-host.ts；扩展 tests/integration/timeline-export.test.ts、timeline-export-timeouts.test.ts、timeline-export-ipc.test.ts 和 tests/renderer/timeline-export-recovery.test.ts。

**Interfaces / 决策：**

- 内部新增 createExportDeadline(startedAtMs)，使用 performance.now() 单调时钟；进入导出入口即计时，等待目录锁也计入。总预算 1800000ms，最后预留 120000ms：第 28 分钟最迟停止新执行，核对/关闭共享剩余两分钟。
- ExportTraceContext 增加可选 deadlineMonotonicMs，Records 的 prepare/outcome/cancel 和 MediaIO 的 open/read/close 可传内部上下文。每个 RPC 取 min(现有阶段上限, 剩余预算)，为 0 时本地返回，不再发请求；renderer 不能设置期限，普通 RPC 默认期限不变。
- 总截止仍不确定时返回可恢复的结果待核对，保留 requestId、固定修订、文件身份及回执。后续用户明确核对才开启新调用预算，不自动创建新导出、渲染或模型任务。
- 顶层返回与底层释放分别处理：已经开始的文件操作不能假装撤销；实际结束前继续持有目录锁和同 ID 在途标记。迟到 open 只关租约；迟到发布仅供原操作核对，不得启动新复制/发布，不删身份不明文件或成品。
- 记录剩余预算及最终状态；保留 120 秒无有效字节进度停止、完整 hash 校验及取消/发布竞争语义。

- [x] RED：虚拟时钟覆盖 28 分钟停止执行、30 分钟返回；prepare/outcome/close 悬挂、排队等锁、最终回执丢失和同时取消。最后一个 RPC 不能重新获得完整阶段额度。
- [x] RED：截止前开始但截止后返回的 open/link，验证无重复发布、不会提前释放排他保护、迟到租约最终关闭。
- [x] 实现共享截止及有界收敛，未确认结果不直接标 completed/cancelled。
- [x] GREEN：npx vitest run tests/integration/timeline-export.test.ts tests/integration/timeline-export-timeouts.test.ts tests/integration/timeline-export-ipc.test.ts；再运行 renderer 恢复测试。用虚拟时钟测完整边界，不实际干等 30 分钟。

### Task F3：资源稳定性连续计数

**Files：** 扩展 tests/electron/spec003-final-smoke.test.ts，新增 tests/electron/spec003-resource-soak.test.ts；在 apps/desktop/src/main/media-protocol.ts、packages/storage/src/bounded-object-io.ts、packages/engine/src/media/cache.ts 和 renderer 的 read-queue.ts 按需加可选测试观测回调，由隔离夹具启用，不增加普通 renderer 权限或公开文件访问接口。

**观测与门槛：**

- 记录播放器、原件/派生租约、活动 range 请求、波形活动/等待任务、缓存条目；区分授权 token 与实际读取会话。仅记录计数，不记 token、凭据或素材正文。
- 复用已有 256 画面+256 配音本地工程，至少连续 30 分钟，每轮 100 次定位，覆盖缩放、播放/暂停、至少 20 次页面/时间线/子项目切换及重新连接；模型请求与新增渲染任务均为 0。
- 波形完整读取并发 ≤4、缓存 ≤64、播放器 ≤3；各类读取会话保持原 64 上限。卸载取消排队；无法即时中止的在途 RPC 结束后释放，不等租约自然过期掩盖泄漏。
- 每轮停止且全部在途任务收敛后，活动请求和队列归零、租约回到该场景空闲基线，不逐轮增长。内存曲线仅为辅助证据。

- [x] 验证计数器在完成、取消、异常、迟到回包时无漏记/重复减计；普通启动不启用测试观测。
- [x] 运行组件/协议清理用例及 npx vitest run --config vitest.electron.config.ts tests/electron/spec003-resource-soak.test.ts，保存逐轮峰值/回落值和时间序列到 verification/2026-11-02-spec003-followups/。
- [x] 若增长，沿具体 open/close 或入队/释放链定位后修复并复验；未实测前不把尚未计数定性为已有泄漏。

### Task F4：声画验收、新包复验与结案

- [x] 复用 300 秒与最大容量输出，核对完整解码、帧数、采样长度、跨窗字幕、黑场/静音及首尾。F2 改动后的冷/热各五轮五格式与 ZIP 条目/hash 重新验证，无新增渲染任务。
- [x] 已生成0/30/60/296秒可播放清单，见本次报告。
- [ ] 人工播放检查爆音、断音、重复/吞音、字幕闪断和声画偏移；主观听感未验，不用自动测试代填。
- [x] 人物音色、方言、对口型需要相应真实素材另验，本轮不增加付费模型调用。历史 ZIP 精确故障 RPC 无新证据时继续标未证实。
- [x] typecheck、定向 integration/renderer 后，按实际影响跑完整相关回归；新包导出必须实测。重媒体与桌面验收串行，保留失败，不放宽原 3 秒/100ms 门槛。
- [x] 在独立目录包复验 F1 状态/失败重试、F2 超时/取消恢复及 F3 资源计数；核验 ASAR/构建字节、用户配置 hash/mtime，最后更新启动入口。
- [x] 更新同一规格、索引和新报告，链接 2026-11-01 历史证据。两处差异真实修复并通过后才关闭 Minor；人工听感及真实质量按实际结果分别标记。

### 2026-11-02 实施与验收结果

F1/F2 已修复并通过定向及完整回归；最终目录包已实测两处同计划重试、两种取消重开核对及60次五格式导出。核心908/908、renderer109/109、媒体30/30、typecheck/build/package verifier通过。30分钟资源验证通过；人工听感仍待验，启动入口按最后门槛切换。新证据位于 ../../verification/2026-11-02-spec003-followups/，历史记录保留。

最终长测：28轮/30.01分钟，2次以上界面重载及1次真实引擎重启通过；全部连续采样与进程结束资源归零。两项历史Minor关闭；人工听感仍保留未勾选。详见[本次结案报告](../../verification/2026-11-02-spec003-followups/report.md)。
