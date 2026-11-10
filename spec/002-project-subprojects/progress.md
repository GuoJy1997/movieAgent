# Execution ledger — plan: D:/movieAgent/spec/002-project-subprojects/plan.md

- 2026-10-31: 用户批准最新规格并授权实施；当前执行 Task 1。
- Ruling: 在 codex/desktop-foundation 当前树工作；原树包含未提交的完整 P2–P5/SPEC001，孤立 HEAD 会丢失产品基线。每个被修改文件先备份到 verification/before，不重置、不整体提交。
- Pre-flight: Task 1 的 owner registry 由 Task 2/3/4/5 共用；Task 2 scope 信封保持旧业务 JSON 不变；Task 4 完成快照固定实际输入与任务；Task 6 检查全部新增表维护范围。

- Task 1: 基础存储与迁移已实现；subprojects.test.ts 2/2 通过（缺模块 RED → GREEN）。填充迁移夹具验证旧节点 JSON、原画布 ID 与第二画布；维护回归仍待 Task 6。
- Task 2: 信封作用域、路由校验/登记与基本列表过滤已实现；routing 1/1 通过（未知命令 RED → GREEN）；后续补查自动后台对象与音频列表。
- Task 3: 同项目资产目录/分类与制品服务已实现；assets 1/1 通过（未知查询 RED → GREEN）；真实本机 MP4 登记待补验。
- Task 4: 完成快照/自动记忆及 Agent 来源集成已实现；memory 1/1 本地 HTTP fixture 通过（未知命令 RED → GREEN），未调用真实服务；补查迟到与故障路径。
- Task 5: Electron 分集管理、共享素材视图与 scoped runtime 已接；新增 renderer 1/1、typecheck 通过。首次 renderer 失败是缺少默认浏览器，不计功能 RED；改用本机 Chrome。目录、制品/连续性界面待完成。
- Baseline: broad run 807 total /804 pass /3 failed；运行与早期编辑重叠，不能视为冻结的原始基线。失败 bounded-media-io、engine-lifecycle UNSUPPORTED_SCHEMA、voice-export 待查。后续全套限制 worker 数，避免并发资源干扰。
- Ruling: 所有测试只使用隔离临时资料库和本地 fixture；不读取或调用用户付费配置，模型语义质量另验。

- Task 1/2: 迁移及路由基础完成；后台 workflow preparation 错入默认集已 RED→GREEN 修复（hardening-red2/green）。修正非默认集转写沿 task_id 继承、对白/台词数组和 AudioTake.id 的守卫；review-red 3 项失败，review-green2 6/6通过。
- Task 3: 两条命名时间线分别渲染真实本机 MP4 并登记两份不可变制品；兄弟集能直接查到且保留来源（deliver-green2 1/1）。修复自动收存先被标为公共历史资产的登记顺序；补历史未分类视图与明确父项目归属命令。
- Task 4: memory-authority 3/3通过：Agent 新轮清单采用固定记忆修订；旧结果 superseded；未知任务重开无新增请求。review-memory-final 7/7通过：旧时间线采用旧剧本且排除候选；重新采用旧完成快照恢复对应摘要并不重发请求。完成生效指针独立于内容去重；待提交旧快照在失去当前身份后不新付费提交。
- Task 5: 目录 RED→GREEN 2/2；新增 renderer 子项目/任务来源 2/2通过；此前全 renderer 90/90通过。单集主时间线、分集/多画布/来源导航、记忆编辑/历史/锁定、制品登记/预览已接。原有剧本/镜头/实体编辑未登记全局草稿保护，已由 Electron 真界面用例复现并修复，复验进行中。
- Task 6: 迁移旧夹具移除 schema26 后真实迁移26/26通过；备份恢复子项目/画布/归属/记忆/完成快照及可读文件 1/1通过（backup-green）。首次失败仅预期错误码写错，不计功能RED。全套第二轮816/817，唯一成片来源失败已修复；最终冻结回归正在运行。
- Final review: 独立只读审阅给出8项 Important，无Critical：引用守卫/转写归属、草稿选择、完成采用版本、旧快照再采用、旧多项目素材分类、直接粗剪归属、项目任务总览。全部进入同一修复与验证轮。审阅者静态报告的临时复现被只读权限拒绝，根实施者已自行写入隔离动态测试；不宣称审阅者做过动态复现。
- Ruling: 可读工作目录只在已绑定的目录项目内创建；数据库仍是归属与版本事实源，旧 scripts/shots 等不移动。完成说明的未提交草稿按应用/项目/子项目保存于本机 UI 存储，提交后正文进入不可变完成快照；该草稿不冒充项目记忆。
- Ruling: 暂不运行真实模型；自动摘要明确标注未核实、冲突与来源，规则优先；超过当前14k输入整理预算时显示 MEMORY_CONTEXT_LIMIT，要求缩减采用内容，不能声称已同步。

- Final frozen: typecheck/build 通过；引擎 825/825（113 files），renderer 91/91（19 files），实际包体 Electron 3/3。package-verify 为 true，ASAR 与当前 out 的21个文件全部一致。最终日志见 implementation.md。
- Timeout audit: 初次冻结5项达到10秒测试超时；打包曾触发 renderer Vite 热重载。冻结源码不变，停止打包后以30秒上限复验全部通过，保留中间日志。
- Recovery completion: 新增当前摘要撤回阻止旧 pin 再用、已知外父项目生成素材不归为无主、长作品显式“仅完成说明”路径；模型输入不静默截断，完整采用内容保留快照。
- Delivery: 工作区启动脚本备份后指向 release-spec002；没有提交用户真实模型请求，没有打开/迁移真实创作工程。保留历史工作树和用户文件。工程完成，真实模型语义质量与用户试用未验。

- Real acceptance 2026-10-31: 用户授权最短视频实跑；1次 Kimi 文本结果未知（STALE_LEASE），未重复POST；使用人工验收剧本完成1次MiniMax-H3-Highspeed 4秒请求，实际3.733秒MP4、制品登记和第二集直接复用通过。工程未改动；长请求租约/超时为真实堵点，自动记忆pending无付费任务。详见real-acceptance.md。

- Long-request fix: 用户要求延长时间；文本连接导入默认300000ms，生成租约600000ms，submit/reconcile每30000ms续期并在finally清理，保留token/owner/过期校验。RED4失败1通过 → GREEN57/57；冻结全引擎830/830，类型/构建、3项Electron、包体原生模块与21文件hash通过。源码和测试共5文件，单独保存before备份；真实Kimi未重发，视频未增加调用。工作区与验收项目脚本指向release-spec002-long-requests，当前窗口由用户重开以保留草稿。

- Real text supplement: 新包Kimi请求142秒正常收存但4096输出被截断；应用配置默认从1024升8192后，正常重试129秒完成摘要ready，第二集Agent52秒生成并采用1个4秒分镜；固定摘要引用和关闭重开无新请求已验。3次新文本、无新视频，真实账单未知。该验收库旧未知任务仍占并发；验收临时并发2已恢复1，继续请求仍受保护阻塞，未称全部业务无堵点。详见real-text-acceptance.md。


- Unknown-slot recovery：按用户授权完成schema27独立审计、task.releaseUnknownSlot、任务详情风险确认及状态展示；5项集成RED→GREEN，界面RED→GREEN并修复单次审阅的迟到accepted提示。最终引擎835/835、界面94/94、类型/构建、目录包原生/媒体、21文件hash及Electron3/3通过。真实原unknown解除后仍保留1,000,000微单位预留；同连接并发1下只新增1次Kimi文本请求，6秒SUCCEEDED，最终包重开无重复。启动脚本已更新。账单仍未知，未增加视频。详见unknown-slot-verification.md。

- 2026-11-01主流程复核：59项定向核心、7项界面、从零桌面场景通过；长场景ASR首次等待超时，隔离0.6秒及长场景9.8秒复测通过；30秒1080p的MP4/WAV/SRT/CSV成功，原件ZIP遇ENGINE_REQUEST_TIMEOUT，重开同requestId约0.9秒恢复且无新任务/渲染。确认64片段容量、图像配置、角色声音路线配置、Agent4096覆盖和ZIP稳定性共5项待处理；非全部桌面自动化通过。无产品改动、真实模型调用0，完整记录见../../verification/2026-11-01-main-flow/report.md。
