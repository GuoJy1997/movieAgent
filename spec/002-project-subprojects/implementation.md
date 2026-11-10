# SPEC-002 实施与验收记录

状态：工程实现、本机回归和包体验证完成；真实视频短路径、Kimi长请求、自动摘要与第二集Agent接续部分验收通过。旧未知任务并发占用已修复并真实验证，见[恢复验收](unknown-slot-verification.md)；历史栏目、声音/对口型等仍未验，见 [真实补验](real-text-acceptance.md)。下表记录冻结版本结果，中间失败和修复过程另行保留。

## 已实现的使用流程

1. 打开一部短剧/一个栏目对应的父项目，进入“分集与分期”创建集或期。旧项目内容保留在“默认子项目”。
2. 顶部选择当前子项目、当前画布。各集拥有独立剧本、镜头、Agent 会话、任务和剪辑；一集可以有多画布、多时间线及多份制品。剧本、镜头、实体、配音和时间线草稿沿用统一导航保护。
3. 角色、声音版本和素材在同一父项目内复用。“当前 / 公共 / 全部成果”负责筛选；兄弟集素材不要求先加入公共分类。历史多项目资料库另有“历史未分类 → 归入当前父项目”，不会把已知属于其他项目的生成素材当成无主导入。
4. 在“剪辑成片”导出面板登记已完成的正式 MP4 制品，保存时间线修订、任务、固定媒体和 hash。分集管理可预览多份制品。
5. 在项目记忆中选择应用文本模型、维护项目设定。标记一集完成时自动整理摘要，无逐条审批；没有模型则显示待更新。
6. 完成快照采用主剪辑的固定剧本与镜头版本，排除其他候选版本。无主剪辑且有多份剧本时须明确选择采用剧本。
7. 大作品超出本次整理预算时，明确显示 MEMORY_CONTEXT_LIMIT；可填写完成说明并选择“仅本次完成说明”重新完成。完整剧本、剪辑及来源快照仍保留，模型只读取用户明确选择的材料。
8. 前期来源独立于显示顺序，可跟随当前摘要或锁定修订。撤回记忆会阻止新计划继续采用，包括此前锁定的旧摘要；已经批准的计划保留自己的固定上下文。
9. 任务页可以切换到全部子项目任务，并打开来源集。切集不会改变后台结果归属。结果未知时核对原任务，不能一键新建重复提交。

## 数据和兼容

- schema 26 增加子项目、归属、资产登记、完成快照及其当前指针、记忆修订/生效指针、前期来源和制品表。
- 解除一项目一画布约束，保留旧画布/节点 ID、历史 JSON 和外键。使用既有分阶段迁移、迁移前备份及失败恢复流程。
- 目录为 shared/ 与 subprojects/<稳定ID>/；旧 scripts、shots、audio、exports 及用户文件不移动。数据库是业务身份与版本的事实源。
- 模型配置继续属于应用，不向各集复制 API Key。项目备份沿用整库与整个用户文件树的方式，恢复副本暂停任务执行。
- 资产原件沿用同项目对象存储；公共分类、来源归属、采用版本相互分开，复用不复制大文件。

## 独立审阅及修复

一次独立只读源码审阅，未发现 Critical，提出 8 项 Important，已纳入同一修复轮：

| 发现 | 修复与验证 |
| --- | --- |
| 台词、镜头、对白引用数组及 AudioTake 守卫遗漏 | 按真实引用类型检查；subproject-review 拒绝跨集台词/音频审阅 |
| 转写结果回到默认集 | 沿转写 task_id 继承归属 |
| 草稿确认后受控下拉读回旧值 | 在事件发生时固定目标值；Electron 覆盖取消/放弃/保存后切集 |
| 完成摘要混用未采用的新剧本/候选 | 从所选时间线修订解析固定剧本与镜头；排除其他候选 |
| 再采用旧完成快照仍以较新修订为准 | 独立当前完成指针；恢复对应摘要，不重复请求 |
| 旧多项目普通导入不可见 | 历史未分类视图与明确归属；已知外项目生成版本排除 |
| 粗剪直接创建时间线漏登记 | applyAssembly 的创建结果也登记子项目归属 |
| 缺少项目任务总览与跳转 | 全项目任务查询、筛选及来源跳转，核心和挂载 UI 用例覆盖 |

审阅者未运行动态复现：只读任务的临时脚本写入被自动审批拒绝；其报告保存也未成功。实施者在授权工作区自行保存结论并补充隔离动态测试，不把静态审阅说成动态验收。另补充了记忆撤回、已知生成素材来源、长作品明确选择整理输入和原有编辑器草稿保护。

## 冻结验证

本次源码冻结后完成以下检查。真实服务语义质量和用户实际创作验收另列。

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| TypeScript 类型检查 | 通过 | verification/types-release-final2.log |
| 构建 | 通过 | verification/build-frozen.log |
| 全部引擎/集成测试 | 825/825；113 个文件通过 | verification/frozen-engine-final.json、frozen-engine-final.log |
| 全部挂载界面测试 | 91/91；19 个文件通过 | verification/frozen-renderer-final.log |
| Windows 安装包 | 构建成功 | verification/package-frozen.log；apps/desktop/release-spec002/ |
| 包内容、原生模块、媒体运行时 | verified: true | verification/package-verify.json |
| 包与当前构建一致性 | 全部 21 个 out 文件 SHA-256 一致 | verification/frozen-package-hashes.json |
| 实际包体 Electron | 3/3；分集/草稿/多画布、utility engine 重开和性能边界 | verification/frozen-electron.log、electron-packaged.png |

最终引擎命令：npm test -- --maxWorkers=4 --testTimeout=30000 --reporter=default --reporter=json --outputFile.json=<verification>/frozen-engine-final.json。最终界面命令：npx vitest run --config vitest.renderer.config.ts --testTimeout=30000 --hookTimeout=60000，使用本机 Chrome。包体运行 subprojects.test.ts 和 packaged-startup.test.ts，指向 release-spec002/win-unpacked。

保留中间失败日志：首次冻结回归有 5 项在默认 10 秒上限超时；界面运行期间打包文件变动触发 Vite 热重载，并有启动/交互超时。停止打包后重新运行，采用 30 秒测试上限，全部通过；没有为消除超时修改业务断言。ASAR 初次比对脚本用了 Unix 分隔符导致查找失败，改为 Windows 规范路径后全部匹配，包体内容无需改动。

已备份并更新工作区启动脚本，指向验证后的 release-spec002 包；继续使用原应用模型配置路径。测试使用隔离工程，未打开或迁移用户正在创作的工程。

## 验收条件与用例对应

以下列出工程证据；真实模型语义质量仍属未验项。

| 条件 | 实际用例或验证 |
| --- | --- |
| AC-01 / AC-03 | subprojects、subproject-directory、subproject-deliverables；实际包体 Electron 创建两集、多画布并重开 |
| AC-02 / AC-12 / AC-16 | subproject-assets、subproject-routing、subproject-hardening、subproject-review，及原有声音版本测试；固定版本可跨兄弟集引用，外父项目拒绝 |
| AC-04 | subproject-deliverables：本机 FFmpeg 真正输出两份 MP4，登记对应时间线修订、媒体与 hash |
| AC-05 / AC-06 / AC-07 | subproject-memory：本地 HTTP 服务自动整理、下一集 Agent 固定清单、无模型、迟到/未知、重开与旧完成快照再采用 |
| AC-08 / AC-09 | subproject-memory 与 subproject-review：规则优先、前期关系/修订锁定、撤回、采用旧时间线而非新候选 |
| AC-10 / AC-11 | subproject-hardening、subproject-review、draft-navigation；包体 Electron 实测取消/放弃/保存后切集 |
| AC-13 / AC-14 / AC-15 | subprojects 填充旧 schema25、原有迁移/维护测试、subproject-backup、subproject-directory；旧 JSON/ID/用户文件和固定引用保留 |
| AC-17 / AC-18 | renderer 交互、包体完成操作与 memory HTTP fixture；空配置不请求真实服务，摘要任务和输入来源可见 |

目录是可读资料与交付的工作区域；原件存储与已完成导出沿用原有对象存储和导出路径。本次没有把所有旧文件重新按集搬迁，也没有把手动放进目录的文件自动当成已登记资产。

## 执行裁定

- 沿用当前 feature 工作树并逐文件备份。HEAD 不含历史完整产品，另起空基线会丢失 P2–P5/SPEC001 现状；代价是本次未与历史未提交修改拆成独立提交。
- 测试使用隔离临时目录、本地 HTTP fixture 和空软件模型配置；不提交用户真实付费接口。代价是模型语义、真实费用和质量仍须另验。
- 工作目录只在已绑定的目录项目下创建；数据库保存身份和版本，旧用户目录保留。代价是手动放入文件夹的文件仍须显式导入。
- 未提交的完成说明属于按应用/父项目/子项目保存的本机 UI 草稿，提交后正文进入完成快照。该草稿不算已共享记忆，也不当作项目工程包的一部分。
- 整理输入超过 14k 字符不静默截断；提供明确“仅完成说明”路径。代价是长作品可能需要用户写下采用的剧情、角色状态及结论。
- 保留当前分支和工作树交付本机包，不擅自重置、移动历史文件、合并或整体提交已有修改。

## 真实短路径补验

2026-10-31 已执行真实服务补验：视频到成片和跨集复用通过，文本请求出现结果未知/STALE_LEASE。详见 [真实验收报告](real-acceptance.md)。下节原冻结验证边界对应之前未调用真实服务的一轮，不能覆盖本次补验。

## 验证边界

本次未调用用户真实服务，不能据此保证真实模型的摘要正确性、跨集语义一致性、音色/方言质量或账单。自动摘要标明模型推断、未核实与冲突来源，显式项目规则优先。第一期仍是 Windows Electron 和本机引擎。

后续修复：[文本长请求等待与租约](long-requests.md)，5分钟请求、10分钟租约及30秒续期；最新引擎830/830、Electron3/3通过。


## 未知任务恢复补丁（schema27）

新增明确确认风险后的task.releaseUnknownSlot与任务详情入口。原unknown、费用和请求保留，迟到事实正常处理；默认并发1未改。最终835/835引擎、94/94界面、3/3包体Electron和21文件ASAR核对通过；真实新Kimi请求6秒成功并重开保持。详见[完整恢复验收](unknown-slot-verification.md)。前文schema26及冻结数据为原实施时点。
