# 羊番TV UI重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 在保留现有创作、审批、版本与恢复能力的前提下，将十入口迁移为羊番TV五主工作区和统一组件系统。

**Architecture:** 复用React工作区、contracts、本机runtime与已有任务服务，增加薄导航适配层和同renderer会话的展示状态。先迁移基础组件及壳，再按业务页面拆分控制器和展示；不重写引擎、不建第二套数据库。

**Tech Stack:** 当前锁定的React19、TypeScript5.9、Electron45、ReactFlow12、Zustand5、Vite、Vitest及Playwright renderer harness；本计划不要求新增第三方组件库。

**Spec:** [SPEC-005](spec.md)，Approved。2026-11-08 已完成 Task1–9 工程实现与 Task10 的本机验证范围；完整验收未结束，详见[实施记录](implementation.md)。

**执行状态说明：** 下方复选项保留原计划，包含组合步骤、原建议文件名与尚未完成的人工矩阵，不批量勾选为已全部完成。实际交付、实现差异和测试结果以实施记录逐任务表及 AC 覆盖表为准。

## Global Constraints

- 个人使用的Windows Electron桌面端，内置本机引擎；不加入Linux或远程部署。
- 展示品牌羊番TV；内部包名、appId、profile目录、持久化ID、回执与旧引用保持兼容。
- 五主入口：项目／创作／制作／资产／成片；任务和设置全局可达。
- 模型配置属于应用；每部短剧独立工作目录；API Key仍在隔离窗口。
- prepare、approve、accept与保存／审核分离；不能因“发送”图标跳过付费批准。
- 普通Agent需求4000字符、参考8项、输出token手动覆盖1–8192；成片助手使用独立finish.*合同，粗剪32镜头／32素材、文案16镜头／16文案、字幕100条，不套普通8项限制。
- SPEC-001声音、SPEC-002跨集、SPEC-003容量恢复、SPEC-004外部图复用和MCP合同保持。
- 工作台画廊仅当前引擎可见项目；独立目录仍从启动器打开，不增加跨目录聚合。
- 不覆盖工作树既有改动；不执行git add .、reset或批量改名。spec位于源码Git仓库外，不能声称随源码提交。
- 所有测试默认隔离fixture，不使用真实Key或付费服务；真实服务另获明确授权并单独记录。

## Review Focus

以下五类风险分配到具体任务测试，不另起一轮无限审计：

1. 轮播／跨集／任务跳转时带着未保存内容：必须保留上下文、走草稿保护，不能串集（Task2、3、5）。
2. 中文输入法、无文本模型、未知回执：不能误发或绕过批准，技能只显示真实模板（Task4）。
3. 预览旧版本、缺失文件、外部图片但无图像模型：不自动采用、不补图付费、正确拦截不可用输入（Task6、7）。
4. 数百片段、超长名称、Windows缩放、小窗口：主要操作可达，容量和媒体释放不回退（Task8、10）。
5. 旧profile、恢复副本、迟到结果、导出复制失败：身份和暂停机制不变，核原回执而非新请求（Task2、9、10）。

## 文件与接口边界

下述代码路径均相对D:/movieAgent/libtv-studio；renderer/缩写为apps/desktop/src/renderer/，features/、state/为其下目录；launcher/、main/为apps/desktop/src/下目录。新文件名是计划时的建议路径；实际新增/复用组件见实施记录，部分建议拆分合并到既有组件。业务路径以spec第2节来源为准。

- packages/ui/src：tokens.css、controls.tsx、icons.tsx、overlays.tsx，保持现有调用兼容；新增Brand.tsx和品牌静态资源。
- renderer/features/shell：新增WorkspaceShell.tsx、workspace-navigation.ts，集中导航映射和全局目的地。
- renderer/state：新增workspace-view.ts、agent-composer-draft.ts，仅存UI状态；复用DraftNavigationGuard和draft-registry。
- renderer/features/projects：拆分ProjectHome及ProjectGallery.tsx、home-model.ts；分集仍由subprojects业务组件承担。
- renderer/features/agent：拆分AgentWorkspace为会话控制器、AgentComposer、ComposerReferences、ComposerOptions和结果展示；复用ProposalDiff、GenerationApproval、FinishProposal。
- renderer/features/creation：新增CreativeWorkspace.tsx承载Agent／Canvas布局；现有CreationWorkspace仍负责制作，避免同名混淆。
- assets／entities／audio／timeline／tasks／models：迁移外观与入口，保留现有服务和修订逻辑。
- tests/renderer：在既有p4-harness基础上补壳和新视图fixture，不另建一套测试框架。

统一UI接口先在Task2／4定义，后续任务复用：

| 接口 | 定义与用途 |
| --- | --- |
| WorkspaceView | project-home / episodes / memory / agent / canvas / script / shots / dialogue / media / entities / voices / asset-detail / timeline / deliverables / finish-assistant / tasks / settings |
| WorkspaceTarget | {view: WorkspaceView; scope: WorkScope \| null; canvasId?: string; sessionId?: string; shotId?: string; timelineId?: string}；WorkScope使用现有contracts/subprojects.ts |
| LegacyPage | App.tsx当前十个Page字面值；仅用于迁移适配 |
| mapLegacyPage(page: LegacyPage): WorkspaceView | 旧入口到新视图映射，保留其目标参数 |
| requestNavigation(target: WorkspaceTarget): void | 在scope校验和草稿保护通过后提交切换；不能直接在各组件setPage绕开 |
| ComposerDraft | {message: string; templateId: string; profileRef: RevisionRef \| null; targets: AgentTargets; selectedAssetRefs: MediaReference[]; outputTokensText: string}，类型复用现有契约 |
| ComposerDraftKey | {libraryId: string; projectId: string; subprojectId: string; sessionId: string \| 'home'}；仅renderer内存，epoch用于请求隔离而非清空草稿 |
| getComposerDraft(key: ComposerDraftKey): ComposerDraft / setComposerDraft(key: ComposerDraftKey, draft: ComposerDraft): void | 同作用域共享草稿；模型／目标变更继续校验，不能把无效选择悄悄提交 |
| prepareComposerTurn(sessionId: string, draft: ComposerDraft): AgentPrepareTurnInput | 纯适配，空预算省略outputTokens；无模型／超限等返回前由校验器明确阻止；不执行命令 |

## Task 1：基础组件与品牌样例

**Files:** 修改packages/ui/src/{tokens.css,controls.tsx,icons.tsx,overlays.tsx,index.ts}及apps/desktop/src/renderer/style.css；新增packages/ui/src/Brand.tsx及packages/ui/src/assets/yangfan-mark.svg；在tests/renderer/p4-harness.ts增加仅测试用组件样例入口。

**Interfaces:** 保持Button、Field、Icon、浮层现有接口；新增Brand({compact?: boolean})，展示“羊番TV”。IconName只增补或兼容旧名称，不让旧页在分阶段迁移时编译失败。

- [ ] 按spec第5节实现token、实心导航图标、按钮、表面、焦点、字级和减少动效；一次只改公共层及直接依赖。
- [ ] 品牌资源从已有原创羊羊方向制作可缩放标记；32px可识别。记录使用资源与字体许可，不从整张UI图截图当产品Logo。
- [ ] 用真实组件展示导航、按钮、分集、输入、菜单、版本与错误状态；截图检查统一视口、实际对比度和焦点。视觉微调不编写镜像CSS断言。
- [ ] 若改变浮层键盘行为，先加tests/renderer/yangfan-components.test.ts的Esc回焦点和键盘展开测试，先失败后通过。
- [ ] 运行npm run typecheck；行为有改动时运行npx vitest run --config vitest.renderer.config.ts tests/renderer/yangfan-components.test.ts。通过标准：类型无错、行为断言通过、截图无旧金属／浅色选中。

**交付检查点：** 可审阅的组件样例与资源；不宣称全站换肤完成。

## Task 2：五入口壳、导航与草稿保护

**Files:** 新增renderer/features/shell/{WorkspaceShell.tsx,workspace-navigation.ts}、state/workspace-view.ts；修改renderer/App.tsx、state/DraftNavigationGuard.tsx与必要的draft-registry.ts；新增tests/renderer/yangfan-navigation.test.ts。

**Interfaces:** 定义上表WorkspaceView、WorkspaceTarget、LegacyPage、mapLegacyPage、requestNavigation。runtime继续管理libraryId／epoch，ScopedRuntimeProvider仍按父／子项目隔离；导航不复制runtime事实。

- [ ] 先写行为测试：十旧入口全部有去向；角色声音／记忆／MCP可达；任务目标A不落到当前B；未保存时取消导航不变；全局设置关闭回原视图。
- [ ] 运行npx vitest run --config vitest.renderer.config.ts tests/renderer/yangfan-navigation.test.ts，确认新行为未实现时失败。
- [ ] 实现壳、作用域条、全局任务／设置、展开／紧凑偏好和旧路由映射；所有按钮／深链回调统一走requestNavigation。
- [ ] 保留无项目、真实canvasId、连接异常、恢复暂停、ACK_UNKNOWN提示和原回执核对；未迁移页先用适配器挂载，保持可操作。
- [ ] 运行新测试及tests/renderer/draft-navigation.test.ts、tests/renderer/subprojects.test.ts；用对应renderer配置。通过标准：保留原保护且所有目的地可达。

**交付检查点：** 五入口已能访问全部现有能力；尚未迁移页面不被隐藏或删除。

## Task 3：首页、画廊与分集

**Files:** 修改features/projects/ProjectHome.tsx、features/subprojects/SubprojectWorkspace.tsx；新增projects/{ProjectGallery.tsx,home-model.ts}；新增tests/renderer/yangfan-home.test.ts。

**Interfaces:** ProjectGallery({items: GalleryItem[]; previewId: string; onPreview(id: string): void; onOpen(id: string): void})；GalleryItem={id: string; title: string; cover: MediaReference | null}。onPreview只改预览，onOpen经Task2导航；模型派生真实摘要，空数据无示例填充。

- [ ] 测试自动跨两个项目后scope／草稿不变；明确打开才导航；6秒、暂停／焦点／隐藏／减少动效、单卡；无项目、无分集、无封面。
- [ ] 先运行npx vitest run --config vitest.renderer.config.ts tests/renderer/yangfan-home.test.ts确认失败。
- [ ] 用CSS空间变换实现可手动／自动切换画廊；受控引用预览和默认封面，不读其他目录。
- [ ] 将真实分集与继续入口、待办／任务摘要接入首页；目录模式新建走启动器。保留分集创建、归档、完成摘要、前期来源、多画布和主时间线管理。
- [ ] 运行新测试及subprojects.test.ts；检查800×560／1180×780窗口。缺少全局封面数据不能通过假海报补齐。

**交付检查点：** 首页有数据／无数据都成立；多目录入口与图稿区别在验收记录说明。

## Task 4：Agent连续输入与批准流程

**Files:** 修改agent/AgentWorkspace.tsx；新增agent/{AgentComposer.tsx,ComposerReferences.tsx,ComposerOptions.tsx,composer-model.ts,useAgentController.ts}、state/agent-composer-draft.ts；新增tests/renderer/yangfan-composer.test.ts。

**Interfaces:** 实现表中ComposerDraft／Key、get/setComposerDraft；composer-model导出validateComposerDraft(draft): string[]与prepareComposerTurn。AgentComposer受控读取draft，通过onChange更新，通过onPrepare请求现有agent.prepareTurn；控件不直接approve或accept。

- [ ] 测试4000／4001字符、8／9素材、无模型、空预算省略、手动预算边界、跨剧本镜头；中文composition的Ctrl+Enter不提交，Enter换行。
- [ ] 测试“准备”只有prepare命令；批准后approve；已有会话换模式要求新会话；技能只展示实际模板；UNKNOWN门禁不能靠重新挂载绕过。
- [ ] 运行npx vitest run --config vitest.renderer.config.ts tests/renderer/yangfan-composer.test.ts确认新断言失败。
- [ ] 拆出共享控制器、引用选择与偏好，保留现有模板／预设／预算来源、GenerationApproval、提案差异、上下文遗漏和停止语义。
- [ ] 输入草稿在同renderer按作用域／会话保存；首页转入选定会话时显式交接。无保存API的输入不得显示虚假“已保存”。
- [ ] 运行新测试、agent-budget.test.ts和p3-acknowledgement.test.ts；检查技能／偏好／引用展开和长文本的真实截图。

**交付检查点：** 连续Composer真实可交互；准备、付费批准、采用仍是三个不同动作。

## Task 5：对话与画布共同工作区

**Files:** 新增features/creation/CreativeWorkspace.tsx；修改agent/AgentWorkspace.tsx、canvas/CanvasWorkspace.tsx和App.tsx；新增tests/renderer/yangfan-creative-workspace.test.ts。

**Interfaces:** CreativeWorkspace({target: WorkspaceTarget; onNavigate: (target: WorkspaceTarget) => void})；使用Task4同一会话控制器／草稿；沿用CanvasWorkspace真实project与canvasId，不创建另一个模拟画布。

- [ ] 测试对话↔画布保留输入／引用／会话；右侧Agent不是第二次会话；切换子项目的迟到结果不污染；候选预览不发canvas写入。
- [ ] 先运行对应新测试，确认失败；再实现全屏对话、画布＋右侧Agent、窄窗口单面板布局。
- [ ] 保留节点检查器、参数、连线、工作流、固定引用、镜头／对白定位；明确采用后只更新实际批准目标。
- [ ] 运行新测试及draft-navigation.test.ts、dialogue-canvas.test.ts；检查隐藏页媒体停止和canvas草稿生命周期。

**交付检查点：** 真正的Agent与画布同屏；不拿静态效果图代替该项。

## Task 6：资产、版本、实体与声音

**Files:** 修改assets/{AssetLibrary.tsx,AssetHistory.tsx,MediaPreview.tsx,VoiceLibrary.tsx}、subprojects/ProjectAssetsPanel.tsx、entities/EntityWorkspace.tsx；新增assets/{AssetsWorkspace.tsx,AssetVersionDetail.tsx}、tests/renderer/yangfan-assets.test.ts。

**Interfaces:** AssetVersionDetail({previewRef: MediaReference; targetRef?: MediaReference; onPreview(ref: MediaReference): void; onUse(ref: MediaReference): void})；onPreview纯UI，onUse由业务适配器验证目标后走既有命令。实体／声音继续用原修订类型，不强转MediaReference。

- [ ] 测试浏览三版本不改变目标引用；明确使用才提交；跨集固定引用；current／common／all／unclassified与媒体类型独立；角色筛选不得混场景。
- [ ] 测试缺失媒体、空引用、部分导入失败和回收恢复；先运行新测试失败，再实现列表、详情和版本布局。
- [ ] 保留角色声音、试镜、声音档案、使用关系、原件收入素材库、公共分类、未分类归属等完整入口。
- [ ] 运行新测试、character-voice.test.ts、voice-identity.test.ts、voice-audition.test.ts和main-flow-voice-handoff.test.ts；只重跑受改动影响的相关项。

**交付检查点：** 媒体、语义实体和声音有统一外观但不混淆业务身份。

## Task 7：剧本、镜头制作与对白

**Files:** 修改creation/{CreationWorkspace.tsx,CreationFields.tsx,ShotProductionPanel.tsx,ShotDialoguePanel.tsx,DialogueReviewPanel.tsx,DialogueRepairPanel.tsx,DialogueAssemblyPanel.tsx}及需要的子组件；新增tests/renderer/yangfan-production.test.ts。

**Interfaces:** 接收Task2的shotId和view=script／shots／dialogue，复用现有focusShotId和openDialogue入口；修订及生产请求类型保持不变，禁止把“已批准”压成单一业务枚举。

- [ ] 测试字段未保存／保存／冲突、角色筛选、镜头切换保护；准备／批准／完成／采用标签与命令对应。
- [ ] 测试无图像模型但有合法外部图仍可prepare视频、缺图阻止、16／17镜头批次、部分成功与未知项核对。
- [ ] 运行新测试失败，再实现编辑、资产列、预览、版本条、底部镜头条及窄窗口切换。
- [ ] 迁移对白、声音修订、审核、修复、组装，保留实际失败原因与恢复动作。
- [ ] 运行新测试、shot-image-reuse.test.ts、shot-dialogue.test.ts、dialogue-review-context.test.ts、dialogue-repair.test.ts。

**交付检查点：** 图稿中“角色混场景”和纯文字无编辑入口问题已在真实组件解决。

## Task 8：成片、四轨与交付视图

**Files:** 修改features/timeline/{TimelineWorkspace.tsx,TimelineTracks.tsx,TimelinePreview.tsx,ClipInspector.tsx,SubtitleEditor.tsx,ExportDialog.tsx}、features/agent/FinishProposal.tsx；新增tests/renderer/yangfan-finish.test.ts。

**Interfaces:** 使用Task2的timelineId／scope；沿用useTimelineEditor、expectedRevision、固定渲染／导出契约；不更改容量常量或复制恢复请求。成片助手沿用FinishPanel({projectId: string; sessionId: string; profile: RevisionRef | null})及finish.*合同，view=finish-assistant归属成片；创作入口携带同一sessionId跳转，profile从应用文本预设读取；无会话时选择或显式创建本集会话，不经prepareComposerTurn适配。

- [ ] 测试时间线切换保留保护、已保存修订导出、失败不能登记制品、恢复原导出和只重试复制；先运行新测试确认失败。
- [ ] 补测试：voice-lines／subtitle-edits／rough-cut均走finish.prepareTurn→approveTurn→acceptProposal；32项素材可粗剪、33项明确拒绝；采用只改本地内容，不产生配音／识别／渲染命令。先失败再实现成片助手入口和同一sessionId关联。
- [ ] 实现命名时间线、四轨、预览、属性、本地作业、制品和修订入口的新布局；窄窗口使用明确面板切换，工具不隐藏到无法发现。
- [ ] 保留粗剪、代理分批、字幕、音频、2／4／8GiB预算和30分钟导出总预算；可视区外释放媒体。
- [ ] 运行新测试及finish-proposal.test.ts、timeline-editor.test.ts、timeline-capacity.test.ts、timeline-preview.test.ts、timeline-subtitles.test.ts、timeline-export-recovery.test.ts；必要时用vitest.media.config.ts覆盖受影响媒体路径。

**交付检查点：** 成片页补齐实际UI，不延续旧探索稿的未验证细节。

## Task 9：任务、设置、启动器与展示改名

**Files:** 修改tasks/{TaskPanel.tsx,TaskDetail.tsx}、subprojects/ProjectTaskCenter.tsx、models/{ModelSettings.tsx,McpSettings.tsx}、launcher/Launcher.tsx、main/{workbench.ts,project-launcher.ts}及对应HTML标题；新增tests/renderer/yangfan-global-pages.test.ts。

**Interfaces:** Task2全局目的地和返回目标；已有window.studio.openProjectLauncher等桥接保持。ModelSettings保留独立配置窗口，不将Key带入renderer。

- [ ] 测试本集／本项目任务过滤、跳回保存的来源、未知回执核对、设置返回原工作区；无项目仍可配置／启动器。
- [ ] 先运行新测试失败；再迁移视觉与展示品牌。保留音频接入、MCP、维护、恢复暂停和关闭／托盘提示。
- [ ] 搜索限定的应用展示文本，逐项改名；不得全库替换MovieAgent、@libtv、appId、路径或schema字段。
- [ ] 运行新测试、unknown-task-release.test.ts、voice-model-settings.test.ts、audio-onboarding.test.ts；标题／窗口变化进入Task10包验。

**交付检查点：** 全局功能完整；改名不造成新profile或丢失旧项目入口。

## Task 10：集成、视觉与交付验收

**Files:** 本目录新增implementation.md记录实际执行；产品测试按前序任务补齐；证据存D:/movieAgent/verification/2026-11-07-spec005-ui/或实际执行日期目录，不修改历史验证结论。

- [ ] 对spec AC-01～13逐条映射已有测试与人工步骤；所有未测真实服务明确“未验”。未完成的页面不能写“全套完成”。
- [ ] 固定相同fixture与视口，检查首页、对话／画布、资产列表／详情、剧本／镜头／对白、成片、任务、设置、启动器及空／错误／未知态。
- [ ] 在800×560、1180×780窗口及spec列出的内容视口、Windows缩放下验证键盘／焦点／溢出／主要动作；检查实际对比度与减少动效。
- [ ] 同机固定数据场景记录新版与旧版的画廊、画布、密集时间线响应和媒体内存；失败定位后只重跑受影响证据，不反复全量。
- [ ] 跨模块最终检查：npm run typecheck；npx vitest run --config vitest.renderer.config.ts；npm test；npm run build。预期退出0，所有适用断言通过；既有无关失败如实区分。
- [ ] 需要交付Windows包时，按docs/development.md执行npm run package:win、npm run verify:package、npm run test:electron；fixture不等于真实服务。使用最终代码产物，旧包不能冒充新验收。
- [ ] 用独立fixture目录验证旧项目、appId／profile、固定引用、恢复副本暂停和原回执；不拿用户创作目录做破坏性迁移测试。
- [ ] 完成用户视觉复核后更新spec各状态；交付变化、测试、限制与未验项。任何提交仅纳入本任务明确文件；不自动提交既有改动或执行部署。

## 本次计划自检

- 覆盖：spec1～5对应Task1～3；6.1→3；6.2→4／5；6.3→7；6.4→6；6.5→8；6.6→9；7→2／4／5／9；8→10。
- 接口：导航统一WorkspaceTarget；草稿与Agent现有契约适配；固定媒体引用与实体修订分开。
- 依赖：1→2→3；4依赖2；5依赖4；6依赖2；7依赖4／6；8依赖2及制作跳转；9依赖2；10汇总。共享文件不得多代理同时编辑。
- 实施方式建议：按上述边界逐任务实施与评审；不同时重写全部页面。本轮已按该顺序实施，未完成的人工验收另列。
- 文档完成不等于规格批准。用户评审后若要求调整，更新本目录，不再建立另一份同义规格。



