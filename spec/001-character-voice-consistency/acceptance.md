# SPEC-001 角色声音一致性：工程验收记录

- 日期：2026-10-30
- 权威需求：[spec.md](spec.md) v0.3；实施清单：[plan.md](plan.md)；独立审阅：[review.md](review.md)。
- **规格：已批准。实现：工程完成。真实服务声音质量：未验。**
- 范围：Windows Electron 与内置本机引擎；保留既有 P4/P5 实现、模型配置和创作数据。
- 本轮真实供应商请求 0 次，真实生成费用 0。HTTP 测试调用的是本地 fixture 服务；测试中的“实际请求”指生产适配器序列化后发送到这个本地服务的请求，不是云端验收。

## 1. 已交付行为与源码入口

| 能力 | 实现位置（相对 libtv-studio/） | 行为 |
| --- | --- | --- |
| 声音身份与版本 | packages/contracts/src/character-voice.ts；packages/engine/src/character-voice-service.ts；storage migrations 0024/0025 | 本地样本、服务音色、克隆音色；源样本/视频短参考/基准音频分离；默认绑定固定版本；历史可查；归档不删旧媒体 |
| 固定声音生成 | packages/engine/src/voice-input-resolver.ts；audio-service.ts；dialogue-production-service.ts；domain/voice-identity.ts | 角色 voice ID 覆盖复制后的公共预设；保留连接/模型/声音版本；原生视频实际注入语言、口音、声线和表演说明；TTS 未映射字段明示 |
| 试听与资格 | CharacterVoicePanel.tsx；VoiceIdentityAuditions.tsx；voiceover-authority.ts | 仅音频三情绪试听、音色/口音/台词分别审核；资格基于明确语义指纹；批次例外须填原因，不假称已通过 |
| 目录与克隆 | providers/voice-management.ts；engine/voice-management-service.ts；VoiceClonePanel.tsx | MiniMax 专用目录/上传/克隆适配；保留原始 int64 文件 ID；步骤持久化；未知不自动重发；恢复需明确核对原操作；短句技术验证与人工听感分开 |
| 界面与换版 | VoiceLibrary.tsx；VoiceUsagePanel.tsx；ShotDialoguePanel.tsx；VoiceoverPanel.tsx | 资产页“角色声音库”；来源/角色/状态筛选；声音历史；按明确勾选对白批量创建新版本；CAS 冲突不部分覆盖 |
| 逐句合成 | contracts/dialogue-assembly.ts；domain/dialogue-audio-assembly.ts；engine/media/dialogue-audio-assembly.ts；DialogueAssemblyPanel.tsx | 每个 turn 恰好一次、角色/声音/审核匹配；48kHz 单声道本地 WAV；短句补静音，缺句/超时/重叠阻止；确认及后续对齐重新检查来源；起点为 0 |
| 画布与 Agent | graph-plan.ts；canvas/generation/workflow service；agent/finish-agent service | 显式 voice_reference 与角色绑定；普通音频不能冒充；对白权威冲突阻止；最终计划显示实际映射；角色外观当前快照与历史声音分开固定 |
| 历史与交付 | main/voice-export.ts；project-backup/transfer；维护引用遍历 | 多用途音频完整导出；纯服务音色导出离线身份 JSON；不带 Key；恢复保持暂停；旧对白和时间线不被新默认声音重写 |

MiniMax 是本期目录与克隆适配器。OpenAI Speech 兼容服务保留手填 voice ID 的路径，不承诺所有兼容网关都有音色列表或克隆接口。实际账户权限、远端音色是否存在仍须真实接入确认。

## 2. 最终验证

| 检查 | 最终结果 | 原始证据 |
| --- | --- | --- |
| 核心全量 | **103 文件 / 807 用例通过**，失败 0，跳过 0 | [core-complete.log](verification/core-complete.log)、[JSON](verification/core-complete.json) |
| 相关界面 mounted | **10 文件 / 43 用例通过**；使用每套测试最新结果合并 | [renderer-final.log](verification/renderer-final.log) 的其余 8 套，加 [renderer-complete.log](verification/renderer-complete.log) 最新 voiceover/voice-identity 两套 |
| 相关真实媒体解码 | **5 文件 / 8 用例通过** | [media-complete.log](verification/media-complete.log)、[JSON](verification/media-complete.json) |
| 类型检查 | 退出 0，无诊断 | [types-delivery.log](verification/types-delivery.log)；最终测试清单修订后的类型复查见 [types-acceptance.log](verification/types-acceptance.log) |
| Electron 生产构建 | 主进程、engine、4 个 preload、renderer 构建成功 | [build-delivery.log](verification/build-delivery.log) |
| Windows 本地目录包 | electron-builder --dir 成功；没有覆盖旧 P5 包 | [package-complete.log](verification/package-complete.log) |
| 包运行时与完整性 | Electron 45.0.0、x64、ABI 150；SQLite/sharp 可运行；preload/CSP、媒体资源通过；6 个打包主进程/preload 入口与最新构建字节相同 | [package-verification.json](verification/package-verification.json)、[final-evidence.json](verification/final-evidence.json) |
| 单次最终 Electron 边界场景 | **1 个选定场景通过**；同文件另 1 场景未选执行 | [electron-verified.log](verification/electron-verified.log)、[JSON](verification/electron-verified.json) |
| 本次增量差异格式检查 | 通过；整个旧工作树另有历史文档末尾空格，未为本需求改写 | [scoped-diff-check.log](verification/scoped-diff-check.log) |
| 独立最终代码复核 | Critical 0、Important 0、Minor 0 | [review.md](review.md) |

界面测试使用已安装 Chromium 1243，未下载新浏览器。最终 Electron 场景在临时库和隔离配置运行，验证公开 API、非法参数、未授权窗口及声音导出边界；它不是角色声音完整人工验收，不影响用户原有桌面进程。

测试过程中旧失败与中止记录保留在 verification/，不作为通过证据。已修正并重跑的问题包括：声音历史查询的旧界面 fixture、旧 schema 固定值、单句确认来源规则、旧 IPC 公开方法清单，以及独立审阅指出的来源/恢复/身份问题。以表中最终报告及每套界面最新结果为准。

### 可复现命令

从 D:/movieAgent/libtv-studio 执行，日志目录用绝对路径；以下省略输出重定向：

~~~powershell
node node_modules/vitest/vitest.mjs run --maxWorkers=2 --testTimeout=60000 --hookTimeout=60000
$env:MOVIEAGENT_TEST_CHROMIUM = 'C:/Users/1266/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'
node node_modules/vitest/vitest.mjs run --config vitest.renderer.config.ts tests/renderer/character-voice.test.ts tests/renderer/shot-dialogue.test.ts tests/renderer/dialogue-repair.test.ts tests/renderer/dialogue-review-context.test.ts tests/renderer/voice-audition.test.ts tests/renderer/voice-model-settings.test.ts tests/renderer/voice-identity.test.ts tests/renderer/voiceover.test.ts tests/renderer/finish-proposal.test.ts tests/renderer/dialogue-canvas.test.ts --maxWorkers=1 --testTimeout=60000 --hookTimeout=120000
node node_modules/vitest/vitest.mjs run --config vitest.media.config.ts tests/media/voice-input.test.ts tests/media/dialogue-align.test.ts tests/media/dialogue-repair.test.ts tests/media/dialogue-mix.test.ts tests/media/render-audio.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.base.json
npm run build
npm run package:win -- --dir --config.directories.output=release-spec001
node scripts/verify-package.mjs --dir apps/desktop/release-spec001/win-unpacked
$env:MOVIEAGENT_TEST_PACKAGE = 'D:/movieAgent/libtv-studio/apps/desktop/release-spec001/win-unpacked'
node node_modules/vitest/vitest.mjs run --config vitest.electron.config.ts tests/electron/ipc-policy.test.ts -t 'rejects unauthorized windows'
~~~

重新打包前应退出使用该包的进程；本轮通过新目录打包，未覆盖用户正在运行的旧包。

## 3. AC-01–23 工程证据

下列测试路径均相对 libtv-studio/tests/；integration 全部已纳入 core-complete，renderer 使用上一节最新报告。媒体 fixture 使用合成音/色板，不证明真人质量。

| AC | 工程结论与用例依据 |
| --- | --- |
| 01 | 通过：integration/voice-identity、voice-resolution；renderer/voice-identity。无本地音频也可保存服务音色；实际 TTS 采用固定绑定，原生参考不会被虚构 |
| 02 | 通过：integration/character-voice；renderer/character-voice。样本建档/试听不触发克隆或模型生成 |
| 03 | 通过：integration/voice-delivery、voice-backup；renderer/voice-identity。长样本、短参考、基准独立收存；换源清旧派生、采用试听输出更新实际参考 |
| 04 | 通过：integration/voice-management、voice-management-protocol；renderer/voice-identity。连接作用域缓存、目录失败和手填路径；不使用模型列表充当音色目录 |
| 05 | 通过：integration/voice-resolution、voice-management-protocol、voice-legacy-binding；renderer/voice-identity。特殊 ID 无损并经过实际请求序列化 |
| 06 | 通过：integration/voice-management。一次上传/克隆及同一候选 ID 的短句验证；技术完成不生成质量通过 |
| 07 | 通过：integration/voice-management；renderer/voice-identity。未知状态重开不重复 POST；显式核对后刷新批准，沿用原 ID/已上传样本 |
| 08 | 通过：integration/voice-management-protocol、voice-management。int64 文件 ID 无 Number 舍入，发送值精确 |
| 09 | 通过：integration/voice-multirole。两角色 × 三镜头，6 次本地 HTTP TTS 请求逐一验证声音/台词，未改写预设 |
| 10 | 通过：integration/voice-resolution、canvas-voice、agent-voice-context。原生请求实际包含声音指令；TTS 未支持字段单独列出，不混入台词 |
| 11 | 通过：integration/voice-resolution、voice-multirole。最终角色绑定优先，公共预设保留原值 |
| 12 | 通过：integration/voice-qualification、voice-spec-regressions、finish-agent。外观当前版本与声音历史可组合；语义改动和人工 needs-fix 影响资格 |
| 13 | 通过：integration/voice-identity、dialogue-production-history、dialogue-timeline、timeline-assembly、voice-delivery。保留历史引用，新默认不重写旧对白；新对白版本不误认旧当前结果 |
| 14 | 通过：integration/voice-qualification；renderer/voice-identity。三情绪纯 TTS、分项人工审核，声音试听不要求先生成视频或口型 |
| 15 | 通过：integration/canvas-voice、agent-voice-context、finish-agent、voice-spec-regressions；renderer/dialogue-canvas。统一解析、固定角色映射、冲突与能力阻止 |
| 16 | 通过：integration/voice-resolution、voice-management、audio-recovery、minimax-speech。明确失效/未知原因，不替换账号、URL、模型或音色 |
| 17 | 通过：integration/voice-resolution、voiceover-route、dialogue-lipsync、dialogue-assembly-workflow；renderer/voiceover、dialogue-repair。同一音频来源规则用于配音与配音后口型 |
| 18 | 通过：integration/voice-legacy-binding、voice-migration、p4-populated-migration、voice-backup、project-backup、project-maintenance-policy、voice-delivery。旧身份不变、不补造通过，源/短参考/基准字节完整，无凭据转移 |
| 19 | 通过：integration/voice-identity、shot-dialogue；renderer/voice-identity、character-voice、voiceover。默认 CAS、勾选范围整体 CAS、关闭/切换后的迟到回执不覆盖新草稿 |
| 20 | 通过：integration/voice-identity、voice-management、voice-qualification、voice-backup；renderer/voice-identity。技术可用、人工审核和采用分别表达，fixture 不标真人效果通过 |
| 21 | 通过：integration/dialogue-audio-assembly、dialogue-assembly-workflow。每句恰好覆盖、声音/审核匹配，实际解码 WAV 的起点、静音与时长符合计划 |
| 22 | 通过：integration/dialogue-audio-assembly、dialogue-assembly-workflow；media/dialogue-align。缺句/重复/错角色/重叠/超时阻止，不裁剪或变速，不用单句顶替多句 |
| 23 | 通过：integration/dialogue-assembly-workflow、dialogue-lipsync；media/dialogue-align、dialogue-mix。固定 manifest/hash，对齐起点 0；审核异步变化和后续变化使当前确认失效，重新确认后可继续 |

## 4. 使用入口与交付位置

- 双击工作区根目录的 **启动MovieAgent.cmd**；首次交付指向 apps/desktop/release-spec001/win-unpacked/MovieAgent.exe，后续补查更新见第 7 节，模型配置仍使用原 config/models.json。
- 旧启动脚本保存在 verification/launcher-before.cmd；旧 release-p5 目录未覆盖。
- 进入短剧项目后，从 **角色场景 → 角色 → 声音档案** 管理来源、样本、服务身份、版本与默认绑定。
- **资产 → 角色声音库** 可查声音、试听、历史和使用位置；批量换版先勾选对白范围。
- 在对白中固定每句角色/声音版本。三情绪试听与人工审核后用于批次；生成后的逐句配音经审核、本地合成、确认，再进入已有对齐/口型/时间线流程。
- 画布声音卡必须有角色/声音绑定并连接 voice_reference；原生视频需要合格短参考，纯服务 voice ID 不自动变成音频。

这是本机测试目录包，没有制作新的安装器或公开发布。媒体运行时的 publicDistributionReady 仍为 false；沿用既有本机资源与发布状态，本轮未改变其对外分发结论。

## 5. 未验与实际限制

以下明确未验，不计入工程通过：

- 用户真实服务的目录/克隆权限、余额、网关协议及实际可用音色。
- 真人样本克隆相似度、跨句和跨镜头听感、方言自然度、不同情绪的稳定性。
- 原生参考视频与 TTS 两条路线的声音是否听感一致。
- 用户创作项目中的全套桌面人工操作和最终成片听审。现有单次 Electron 自动化是边界回归。

技术输入固定能够防止应用混用声音身份，不能保证任意模型永远不漂移；仍通过试听和逐条审核处理。后期对口型沿用已有适配器/人工修正流程，本期没有新增万能对口型模型。

## 6. 工作树与证据边界

- 原有工作树已有大量 P4/P5 未提交修改，本轮原位增量实现，没有 reset/clean、覆盖创作目录、读取真实 Key 或批量提交。
- 本次文件清单及当前 SHA-256 见 verification/changed-files.json 和 final-evidence.json；主要既有文件的改前内容保存在 verification/before/。目录包哈希同时记录，避免把旧包验证当成新包验证。
- spec 位于产品 Git 仓库外的工作区根目录，不宣称已随源码提交。

## 7. 同日主流程补查与缺陷修复

用户随后要求检查整套业务的主流程。补查发现 F-01 重复合成面板未向对齐区域交接、F-02 嵌套表单中的生成批准异常，两项均修复。全套界面 18 文件/89 用例、两条桌面业务场景的最新结果通过，并导出 30 秒真实本地 MP4/WAV/字幕/来源包；不把 fixture 当真实模型听感。

当前启动包更新为 release-flow-verified；首次工程报告及旧日志保留为历史。完整复现、修复、容量上限、模型依赖和最终证据以 [主流程报告](../../verification/2026-10-30-main-flow/report.md) 为准。单时间线 64 个视频片段的容量约束仍在，没有借缺陷修复扩展需求。
