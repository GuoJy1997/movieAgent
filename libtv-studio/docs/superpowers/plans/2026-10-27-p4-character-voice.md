# P4 Character Voice and Dialogue Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read the linked spec and base P4 plan before editing shared interfaces.

**Goal:** 在 MovieAgent 建立角色声音档案、固定参考的H3对白生成、试镜与批次审核，以及独立配音/口型修正到成片的闭环。

**Architecture:** 项目声音/对白/审核使用不可变修订和现有共享镜头选择事务。H3、TTS、口型各自冻结输入与费用；FFmpeg只负责媒体准备和合成。镜头采用后向原P4时间线提供显式声音来源和关联编辑组。

**Tech Stack:** 沿用TypeScript5.9、Node24、Electron45、React19、SQLite、Vitest/Playwright及原P4固定媒体运行时；新增受限供应商adapter，不增加前端框架或模型权重。

**Spec:** [角色声音专项设计](../specs/2026-10-27-p4-character-voice-design.md)，同时继承 [P4基础设计](../specs/2026-10-27-p4-audio-timeline-design.md)。[官方协议依据](../../research/2026-10-27-character-voice-providers.md)区分文档核对与真实验收。

**Status:** 2026-10-27用户已授权实施；依赖基础P4任务1–7，统一由基础任务8交付。MiniMax单句TTS/ASR测试已通过，H3音频参考和口型质量仍未实测。

## Global Constraints

- 工作目录 `D:/movieAgent/libtv-studio`，不读改真实config/models.json、用户项目库、现有release和运行中的MovieAgent。测试使用临时库、fixture连接和测试窗口。
- 原P4基础任务1–7先形成schema19与公共媒体/音频/时间线服务；随后执行本专项V1–V6，最后原P4任务8完成统一发行。不要先按旧八项宣布P4全部完成。
- 迁移只追加0020角色声音/对白、0021制作计划/take、0022试镜/审核/采用、0023审核上下文/整批批准；沿用0015–0019，不改写0020–0022或旧任务解释。0023是接续审查修复，范围按声音专项设计的数据章节执行。
- 统一48000 ticks/s，24/25/30fps和原P4时间模型。H3标准输出4–15秒整数、首版768P；声音每段2–15秒、最多3段、总计≤15秒；本产品参考图最多4张、每张≤10MiB，全部参考原始字节≤32MiB，编码后的JSON≤48,000,000字节。
- 声音准备输出48kHz/单声道/PCM s16 WAV，固定hash。口型输入≤15秒、视频≤64MiB、WAV≤4MiB，总上传≤68MiB；产出视频≤64MiB，保留既有网络收存上限。
- 一个镜头最多16句、每句≤4000字符、总≤16000字符；H3最终prompt≤7000字符。一次最多16镜头；正式批次默认要求三种情绪及新角色组合试镜，明确例外仅适用当前批次。
- 声音路线值统一为 `native-reference|dubbed-lipsync|voiceover`。一镜头首版只用一种角色对白路线；最多三位H3说话人且区间不重叠，口型修正只支持单个可见讲话人物。
- 外发媒体仅来自已批准固定引用。H3用data URI；Sync用流式multipart，不公开本机HTTP、不暗中上传图床。Key仅在特权层，模型配置仍归应用，声音内容归短剧项目。
- 生成成功不等于质量通过。H3未知提交不重发；Sync仅在验证幂等契约后允许用户显式同键核对，最多首次提交后7天内，不能换键/换payload绕过未知结果。
- 已获准实施；开发和fixture不替代真实声音/方言/口型验收。执行过程先针对性检查，末尾统一集成，不按每个控件反复开关Electron。

## Review Focus

1. **两个角色引用同名音频或重排输入**：按实体和固定引用绑定，不能依赖文件名/数组偶然顺序；V1/V2/V3验证互不串音的请求结构。
2. **声音/模型/台词变化与迟到结果**：旧证据不能证明新版本，旧结果不覆盖新编辑/选择；V3/V4验证指纹、CAS和历史保留。
3. **原生音轨、补配音轨与关联剪辑**：不能双播、切嘴形后仍播放旧词或波纹删除执行两遍；V5用实际音调媒体与逐帧边界验证。
4. **兼容服务忽略音频、Base64膨胀和首帧冲突**：必须在POST前拒绝，不能偷偷降级；V2验证序列化上限/能力证据与错误请求数为0。
5. **UNKNOWN、取消、收存崩溃与同键重放**：恢复不能重复计费/新建成功产物；V3/V4验证H3零重发、Sync原键原文件及7天边界。

## 文件与衔接

| 责任 | 文件 |
| --- | --- |
| 声音/对白类型 | 新建 `packages/contracts/src/character-voice.ts`、`dialogue-production.ts` |
| 纯验证与编译 | 新建 `packages/domain/src/character-voice.ts`、`dialogue-plan.ts`、`voice-audition.ts`、`dialogue-assembly.ts` |
| 持久服务 | 新建 `packages/engine/src/character-voice-service.ts`、`dialogue-production-service.ts`、`dialogue-coordinator.ts`、`voice-review-service.ts` |
| 供应商与媒体 | 新建 `packages/providers/src/minimax-h3.ts`、`minimax-speech.ts`、`sync-lipsync.ts`；`packages/engine/src/media/voice-input.ts` |
| 模型设置 | 扩展main `audio-onboarding.ts`（原P4任务3）、`model-config-editor.ts`和renderer `features/models/ModelSettings.tsx` |
| 用户界面 | 新建 `features/entities/CharacterVoicePanel.tsx`、`features/creation/{ShotDialoguePanel,VoiceAuditionPanel,DialogueReviewPanel}.tsx`及 `features/audio/DialogueRepairPanel.tsx` |
| 迁移 | `0020-character-voices.ts`、`0021-dialogue-productions.ts`、`0022-voice-reviews.ts`、接续修复追加的 `0023-dialogue-authority.ts` |

公共接线统一修改 `packages/contracts/src/{index,commands,queries,events,schema,models,generation,desktop}.ts`、engine的router/bootstrap、storage database/maintenance、preload和engine-host输出校验。每个任务只增加它负责的契约；保持旧JSON精确键验证兼容，不能放开任意字段。

`CreationRef={id:string,revision:number}`、`MediaReference`、`RevisionRef`、`TaskRef`、`Result<T>`复用既有或原P4定义。新命令返回 `Promise<Result<T>>`，查询返回 `Result<T>`；下文箭头描述其成功值。`CharacterVoiceDraft`和`ShotDialogueDraft`为spec对应revision对象去除libraryId/projectId/id/revision/createdAt后的写入内容；其他新类型由所在任务的contracts文件定义，不创建另一套通用Profile类型。

### V1：项目角色声音档案与结构化对白

**Files:** 新建character-voice contracts/domain/service、migration0020、`tests/integration/{character-voice,shot-dialogue,voice-migration}.test.ts`；修改database/router/queries/maintenance及creation查询；不改变旧dialogue字符串解释。

**Interfaces**
- `voice.save({projectId,id?,expectedRevision,draft:CharacterVoiceDraft}) -> CharacterVoiceRevision`；新建expectedRevision=0；引用的entity必须为当前项目character。
- `voice.list({projectId,entityId?}) -> CharacterVoiceSnapshot`；`voice.read({projectId,voiceRef:CreationRef}) -> CharacterVoiceRevision`。
- `dialogue.save({projectId,id?,expectedRevision,draft:ShotDialogueDraft}) -> ShotDialogueRevision`；`dialogue.read({projectId,shotId,revision?}) -> ShotDialogueSnapshot`，含当前及固定历史。
- `validateDialogue(draft:ShotDialogueDraft,context:DialogueValidationContext):Result<ValidatedDialogue>`；context提供固定shot/character/voice及probe事实，不进行网络访问。
- `characterVoiceFor(deps)`暴露上述本地服务；路由层事务使用内部validated-save以便Agent采用，调用者不可自行伪造成功回执。

- [ ] **写失败测试。** `twoCharactersKeepDistinctVoiceRefs`断言同名文件/顺序变化不影响实体映射；`saveVoiceWithStaleRevision`拒绝且零写入；`changingVoicePreservesOldDialogue`保留旧hash；`rejectCrossProjectVoice`、`protectReferencedVoiceMedia`、`legacyDialogueIsNotAutoAssigned`固定上述语义。
- [ ] **运行RED。** `D:/nodejs/node.exe node_modules/vitest/vitest.mjs run tests/integration/character-voice.test.ts tests/integration/shot-dialogue.test.ts tests/integration/voice-migration.test.ts`；失败必须来自尚未存在的行为。
- [ ] **实现类型与迁移。** 0020保存不可变voice/dialogue及当前指针，注册schema19→20；旧EntityRevision不强行新增必填键。保存校验实际probe范围、三位H3说话人、重叠区间、字符/条数上限；声音未裁切好仍可保存草稿，但标不可生产，不能伪造prepared reference。
- [ ] **实现查询/保护。** 查询暴露声音版本和缺失原因，引用加入维护快照和回收站保护；重复命令返回原修订。旧JSON和历史产物可读，替换媒体必须另存新版本。
- [ ] **GREEN并提交。** 上述测试＋typecheck通过；记录19→20以及14→20旧数据升级；提交V1所属文件，交接类型与内部保存接口。

### V2：H3声音输入、模型配置及本地媒体准备

**Files:** 新建minimax-h3.ts、media/voice-input.ts、`tests/integration/{h3-audio-reference,h3-model-config}.test.ts`、`tests/media/voice-input.test.ts`；修改generation/models/model-config-file、domain/reference-inputs.ts、providers/http-transport.ts、engine/generation-service.ts、bootstrap与onboarding允许列表。

**Interfaces**
- `ReferenceAudioInput={characterRef:CreationRef,voiceRef:CreationRef,ref:MediaReference}`；其ref必须指向已准备的标准WAV。`FrozenReferenceAudio`增加hash/mime/byteLength/durationTicks/probeId；PreparedGeneration可选referenceAudio及严格voiceBindings，不修改旧prepared hash算法。
- `voice.prepareReference({projectId,voiceRef,executionOwner,runId}) -> DerivedMediaPlan`，复用原P4本地媒体队列；产物必须持久收存为可保护的MediaReference，不能把可回收缓存当云端原件。
- `buildH3Request(prepared:PreparedGeneration,media:VerifiedReferenceBytes):Result<H3RequestBody>`；只由特权provider获得字节，renderer不持有Base64。
- `MiniMaxH3Adapter`实现既有provider接口，adapterId=`minimax-h3-v2`；用bootstrap的adapterRegistry注册，不新增不存在的adapterFactory。
- `prepareAudioCapabilityTest/runAudioCapabilityTest/saveVerified`扩展原P4audio-onboarding，回执记录 `h3_reference_audio` 及具体连接/Key版本/model/mode参数指纹，和人工试镜通过分开。

- [ ] **写失败测试。** 两图两声音构造 `content` 的映射固定；WAV Data URI解码hash等于原件；旧minimax-video-v2任务请求字节不变；4/5图片、3/4声音、15秒/超15秒、7000/7001字符、48,000,000/48,000,001编码字节分别验边界，拒绝项生成POST=0。
- [ ] **运行RED。** `D:/nodejs/node.exe node_modules/vitest/vitest.mjs run tests/integration/h3-audio-reference.test.ts tests/integration/h3-model-config.test.ts`；媒体测试用原P4 `vitest.media.config.ts`。
- [ ] **实现本地准备与输入链。** 裁切的sourceIn/duration均在原音频范围，48kHz mono PCM s16，结果完整解码并固定hash。原始总量≤32MiB、JSON≤48,000,000字节；仅此adapter放行相应有界JSON请求，不全局解除transport限制。首帧与声音冲突返回明确错误和转换建议，不自动转图或丢声音。
- [ ] **实现H3任务和配置。** V2 task_id/status/task.content.url映射保持scheduler/collection语义；未识别状态显式失败/待核对。配置文件向后兼容，模型ID手填可用；服务类型匹配显式adapter，不能按ID猜。受保护测试需要有限额度，fixture不伪造真实连接验证。
- [ ] **GREEN并提交。** 全链经本地HTTP真实adapter验证，模拟服务记录请求体和hash；JSON过大、媒体改字节、返回音轨缺失、POST断开都得到准确状态。typecheck及旧视频adapter相关回归通过，交接verified能力与冻结输入。

### V3：对白批次、试镜证据和人工质量审核

**Files:** 新建dialogue-production contracts/domain/service/coordinator、voice-audition.ts、voice-review-service.ts、migrations0021/0022、`tests/integration/{dialogue-production,voice-audition,dialogue-recovery}.test.ts`；修改generation-service内部原子入队接口、scheduler生命周期与选择查询。

**Interfaces**
- `dialogue.prepareProduction({projectId,dialogueRefs:CreationRef[],profileRef:RevisionRef,purpose:'audition'|'production',auditionCase?:'calm'|'excited'|'quiet'|'exchange',exception?:{reason:string},executionOwner,runId}) -> DialogueProductionPlan`；1–16镜头，purpose=audition只允许1镜头。
- `dialogue.approveProduction({planId,approvedHash,executionOwner,runId,approval:DialogueBudgetApproval}) -> {tasks:TaskRef[]}`；DialogueBudgetApproval复用currency/allowanceMicros/budgetLimitMicros/acknowledgeUnknown四字段。
- `dialogue.stopProduction({projectId,planId,executionOwner}) -> void`；`dialogue.production({projectId,planId}) -> DialogueProductionView`；`dialogue.takes({projectId,shotId}) -> DialogueTakeSnapshot`。
- `dialogue.reviewTake({projectId,takeId,expectedReviewRevision,checks,notes}) -> DialogueReview`；checks四维且严格枚举。`voice.auditionStatus({projectId,voiceRef,profileRef,route}) -> VoiceAuditionStatus`。
- `computeAuditionFingerprint(input:AuditionFingerprintInput):string`绑定声音/裁切/口音、所用配置和模板版本；角色显示名不入声学指纹，图片hash进入画面/口型证据。

- [ ] **写失败测试。** `threeEmotionsRequired`、`newPairNeedsExchange`、`modelOrVoiceChangeStalesEvidence`、`batchExceptionIsScoped`断言具体门槛；16镜头批准两次只有16个task/POST；变更对白或审核证据后旧plan批准零写入。
- [ ] **运行RED。** 执行本任务三个integration测试文件；失败来源为缺失接口/门槛，不能用假质量评分代替。
- [ ] **实现冻结与入队。** 先准备已存在的媒体对象，生成10分钟计划；批准在一个事务内复查所有版本/预算并入队。复用generation服务的内部prepare/approve事务辅助函数，禁止for循环调用公共批准模拟原子性。默认只用通过的配置，例外记录reason与本次items，不永久改voice状态。
- [ ] **实现协调与审核。** 持久化每个TaskRef→take关系、收存诊断与人工审核；0021/0022顺序注册。H3 UNKNOWN不重发，停止后await边界不新增任务，独立take收存失败不阻塞其他项，迟到产物只入历史。审核动作不自动采用或重新生成。
- [ ] **GREEN并提交。** 注入计划过期、声源变化、CAS冲突、停止、重开、发布前后崩溃；精确POST计数、一个产物身份、错误可恢复。typecheck通过，交接take/review查询及采用所需证据。

### V4：固定配音与可配置口型修正

**Files:** 复用基础Task3的minimax-speech.ts；新建sync-lipsync.ts、`packages/domain/src/dialogue-repair.ts`、`tests/integration/{minimax-speech,dialogue-lipsync,dialogue-lipsync-recovery}.test.ts`、`tests/media/dialogue-align.test.ts`；修改原P4audio-service、dialogue服务、transport流式multipart和受保护onboarding。数据落在0021/0022定义的route/receipt，不另建隐式迁移。

**Interfaces**
- `MiniMaxSpeechAdapter`、adapterId=`minimax-speech-v1`，复用原P4text_to_speech与AudioTake；已有voice_id放在ModelProfile固定参数中。
- `dialogue.confirmAudio({projectId,dialogueRef,source,expectedRevision}) -> ConfirmedDialogueAudio`；`source` 为 `{kind:'audio-take',takeId:string}` 或 `{kind:'imported-audio',media:MediaReference}` 的严格联合。导入音频也要绑定台词修订、校验固定媒体/hash/probe并人工确认，不伪造生成任务或AudioTake，不能仅凭文件名匹配。
- `dialogue.prepareAlignment({projectId,dialogueRef,sourceVideo:MediaReference,confirmedAudioRef,startTicks,executionOwner,runId}) -> DerivedMediaPlan`；选择的视频只裁切明确source range，本地补静音后产生 `AlignedDialogueInput={videoRef,audioRef,durationTicks,videoHash,audioHash}`。
- `dialogue.prepareRepair({projectId,dialogueRef,alignedInput,profileRef,executionOwner,runId}) -> DialogueProductionPlan`，单镜头，route=dubbed-lipsync；沿用V3approve与take。
- `SyncLipSyncAdapter`、adapterId=`sync-lipsync-v2`，taskTypes新增lip_sync，输入视频＋音频、输出视频。`dialogue.reconcileSubmission({projectId,takeId,executionOwner})`仅针对已验证同键契约及7天内同一输入恢复，既有已知ID始终优先GET。
- `dialogue.importRepair({projectId,dialogueRef,sourceVideo,confirmedAudioRef,repairedVideo:MediaReference}) -> DialogueTake`供外部已导入媒体，不接受文件路径，保留manual来源并进入待审核。

- [ ] **写失败测试。** TTS HTTP200/base_resp非0或null audio不成功，畸形hex拒绝；音频长于视频不截断、不POST；短音频按明确入点补静音且字节固定；多人可见对白修正拒绝。
- [ ] **运行RED。** 执行本任务三个integration文件与media/dialogue-align；检验实际WAV样本/长度，不只测对象字段。
- [ ] **实现独立配音。** `/v1/t2a_v2`、voice_setting.voice_id、mp3/hex响应走既有音频批准/收存；不调用voice_clone，不将ID注入H3；切账户/预设使能力和试听证据待复核。
- [ ] **实现口型请求与恢复。** multipart流上传video/audio、model与JSON options `{sync_mode:'cut_off'}`；首次持久化Idempotency-Key、文件hash及扩展名。处理201/200原ID、PENDING/PROCESSING/COMPLETED/FAILED/REJECTED，409/503保持原键待核对，7天后禁止重放POST。没有已验幂等的兼容端按UNKNOWN规则，不套用官方承诺。取消标记不声称停费。
- [ ] **实现结果组合。** 解析并完整解码≤64MiB结果，长度误差≤1目标帧；最终使用修正画面＋固定批准音频，忽略返回嵌入音轨。新台词/音频使原组合待复核；人工审核不能替代源hash校验。
- [ ] **GREEN并提交。** 同键同文件恢复得到同一task，超过7天/换文件/换来源拒绝；重开不自动POST；下载失败仅重收存。证明补静音无台词切断、无循环/自动变速；typecheck通过。

### V5：采用修正镜头与时间线声音来源

**Files:** 新建dialogue-assembly.ts、`tests/integration/{dialogue-selection,dialogue-timeline,voice-export}.test.ts`、`tests/media/dialogue-mix.test.ts`；修改creation-service、shot-production历史聚合、原P4timeline/音轨编辑/render/export以及protected directory publisher。

**Interfaces**
- `dialogue.selectTake({projectId,shotId,expectedShotRevision,expectedSelectionRevision,dialogueRef,takeId}) -> DialogueSelection`；已通过四维审核方可采用，过期证据需显式复核。
- 使用 `creationFor.selectOutput` 同一外部事务写镜头video选择及DialogueSelection/历史/事件；不伪造ShotProductionOutput的workflowId。后续手工/P3选回普通视频会把当前DialogueSelection解除，旧记录保留。
- `assembleDialogueClips(input:DialogueAssemblyInput):Result<DialogueAssembly>`产出VideoClip、可选AudioClip、dialogueGroupId及声音策略；接原P4粗剪/replaceMedia的统一CAS操作。
- `voice.export({projectId,voiceRef,requestId}) -> ExportReceipt`复用受限main目录发布；只导出固定参考和元数据，原件路径和Key不进入JSON。

- [ ] **写失败测试。** `rejectNeedsFixSelection`和`rejectUnreviewedSelection`要求零选择写入，生成例外不能绕过；`allowVoiceoverWithoutLipCheck`只放行画外音的口型not-applicable。手工改选与迟到take双CAS不覆盖；旧时间线固定；原生视频只开原声，修正版只开独立配音；音频轨已有重叠则整组插入拒绝，零部分写入。
- [ ] **运行RED。** 执行本任务integration与media/dialogue-mix文件；设置可识别的原声440Hz和配音880Hz，输出断言只含所选来源，BGM另测。
- [ ] **实现采用与关联编辑。** 选take时复核shot/dialogue/quality/hashes，写同一selectionRevision。移动、裁切、分割、普通删除关联组同步作用，波纹删除按旧P4全轨区间算法只执行一次。取消关联需明确本地操作并显示风险，不生成新模型任务。
- [ ] **实现导出与可追溯性。** 成片CSV/manifest加入对白、voice/take/审核/来源hash；声音快照按spec目录无覆盖发布；新声音不会替换旧时间线。旧无元数据视频仍默认静音，粗剪确认明确显示原声/配音，补配时提示环境声丢失。
- [ ] **GREEN并提交。** 真实媒体逐帧检查声画边界，三种fps的裁切/分割/波纹/替换无双播和累计漂移；文件断开仅重试复制，typecheck通过。

### V6：页面、Agent衔接与统一验收准备

**Files:** 新建上述五个renderer面板及 `tests/renderer/{character-voice,shot-dialogue,voice-audition,dialogue-repair}.test.ts`；修改EntityWorkspace.tsx、CreationWorkspace.tsx、ShotProductionPanel.tsx、shot-output-presentation.ts、ModelSettings.tsx、原P4AudioWorkspace/TimelineWorkspace与FinishProposal；新增 `tests/electron/p4-dialogue.test.ts`、`docs/verification/p4-character-voice.md`（实施时生成）。

**Interfaces**
- 页面只调用V1–V5公共命令/查询，所有面板保存持有project/object/revision身份；不得直接调用provider。
- 原P4 `FinishProposal` 的voice-lines分支增加明确的role/emotion/route别名，采用调用V1内部validated-save，不能返回quality:pass、voice_id、URL或调用批准。
- `p4-dialogue.test.ts`使用受控fixture、临时user-data和本地自有媒体；最终整包由原P4任务8统一完成，不独立发布另一个版本。

- [ ] **写实际挂载测试。** 文件同名/无图/空档案/三位角色/长台词/配置失效；保存A后继续改B与切项目旧回执均不覆盖；挂载、试听本地文件、查看审核没有生成POST；批量确认展示确切媒体/版本/条数/总额度。
- [ ] **实现五个面板。** 档案裁切试听、逐句角色/情绪/路线、三情绪与组合试镜、逐镜头四维复核、配音确认和口型前后对比完整串接。按钮展示能力不支持/待试听/过期/未知提交/云端不可取消原因；不能把协议通过显示成质量合格。
- [ ] **实现Agent和画布衔接。** 提案仅改变本地内容并标出失效镜头；现有画布产物卡标明声音来源和“打开对白/剪辑”，不会触发整图重跑；模型设置保持业务字段，不暴露任意JSON。
- [ ] **局部GREEN后准备最终验收。** renderer相关测试、typecheck和针对性integration通过；原P4任务8统一跑核心/媒体/桌面并打release-p4。精确发行包用两个角色、三种情绪、轮流对白、一次重配音修口型、一次版本冲突、一次重开完成30秒样片。fixture通过只报告工程完成。
- [ ] **提交并交接真实验收清单。** 真实测试计划按用户后来指定的服务、模型、允许数量和预算创建；初始建议先各路线一个片段再扩到完整矩阵，未经授权不执行。记录接受/失败原因，山东话由能判断口音的人确认；未验项目明确标记，不借历史MiniMax文生视频成功代替音频参考成功。

## 依赖与完整P4完成条件

统一集成时修正画外音入口：固定对白转为含 dialogueSource 的真实 VoiceLine，走既有 TTS 批次与 AudioTake；逐结果审核通过后进入独立配音轨。采用第5节的只读上下文查询和类型事件/已提交回执作为服务器审核依据，最新需修正、来源变化、旧回执及同字节资产别名不能绕过门槛。普通独立音频与历史片段保持可用；视频制作入口先拒绝画外音，不产生 H3 请求。此项归基础任务8的集成修复和实际流程验收。

```mermaid
flowchart LR
  B[P4基础任务1至7] --> V1[V1档案对白]
  V1 --> V2[V2 H3声音参考]
  V2 --> V3[V3试镜与批次]
  V3 --> V4[V4配音口型]
  V4 --> V5[V5采用与时间线]
  V5 --> V6[V6页面与验收准备]
  V6 --> R[P4基础任务8统一发行]
```

顺序执行共享contracts/router/migrations的改动；研究/独立审阅可并行，不同时让多个实现者改同一允许列表。完整P4包括基础八项＋本专项六项；软件fixture验收、真实供应商质量、公开发行/干净机安装分别报告。当前仅计划，不把复选框当成已实现。

## 覆盖与计划自查

| 设计要求 | 实施任务 |
| --- | --- |
| 每角色档案、项目隔离、版本/目录/引用保护 | V1、V5 |
| 分镜自动带声音、H3适配、编码/能力/费用 | V2、V3 |
| 三情绪与组合试镜、批次门槛、人工审核 | V3、V6 |
| 既定音轨、MiniMax Speech、Sync、手工修正版导入 | V4 |
| 新旧结果采用、时间线原声/配音互斥、关联编辑 | V5 |
| Agent限权、真实控件、受控桌面、质量验收 | V6、基础任务8 |

五项Review Focus分别有命名测试；状态、类型名和route枚举在所有任务统一。所有线上接口参数是设计约束，不是已实测承诺。实施前如服务协议发生变化先更新对应adapter证据和计划，不能临时改用户模型、额外建图床或暗中扩大费用。
