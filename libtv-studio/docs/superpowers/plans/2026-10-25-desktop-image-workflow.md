# Electron 桌面图像工作流 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 Windows x64 桌面程序，跑通“建项目 → 配置模型 → 明确批准一次真实图像生成 → 收存原件 → 加入资产 → 放入画布 → 退出并恢复”。

**Architecture:** Electron main + 受限 preload + React renderer；utility process 内运行共享业务引擎，SQLite 单引擎写入，媒体按内容 hash 收存。UI、未来 Agent 和远端适配器共用命令、查询与事件契约。

**Tech Stack:** TypeScript、React、Electron、electron-vite、electron-builder、SQLite、React Flow、Zustand、TanStack Query、Vitest；Electron 集成测试采用与锁定版本兼容的驱动。版本在 Task 1 根据官方兼容文档和实际打包结果锁定，不把旧原型版本直接当作兼容结论。

**Spec:** [完整设计](../specs/2026-10-24-electron-studio-design.md)，重点 §7–11、§15–21；[产品交付路线图](2026-10-25-product-delivery-roadmap.md)；[UI 规范](../../design/libtv-ui-system-study-2026-10-24/design-system.md)。

日期：2026-10-25。状态：Task 1–10 本地实现和任务审查已完成，整批审查发现的六项问题已修复并复审通过；交付本地测试 beta，真实 API 与干净 Windows 安装未验收，完整 P1 尚未完成。下列 `apps/`、`packages/`、`tests/` 路径已按任务落地，根目录是 `D:/movieAgent/libtv-studio`。

## Global Constraints

- 独立产品仓库；不修改 `D:/rea`，不搬入 REA 运行时代码。保留现有 `docs/design/` 与 `prototypes/`；不以整仓 `git add .` 纳入研究文件和图片。
- P1 支持一个经验证的图像 API 协议族、文本提示词、单次生成一张图；模型 ID 与 Base URL 可配置。参考图/遮罩/批量/视频等能力只有实现并验证后才开放。
- P1 有基础文本、图片、图像生成节点、布局/选择和保存；完整依赖图执行、Agent、时间线、远程部署归后续批次。共享连接协议现在建立。
- SQLite 外键、迁移、WAL 和唯一约束由存储层拥有；引擎是资料库唯一写入者，网络与文件复制不占长事务。原件不存入数据库。
- 重复命令返回原 receipt；同 ID 异参拒绝。未知提交不盲目重试，已完成的供应商作业不因收存失败而重发。普通生成历史与“加入资产库”分开。
- 生成前冻结输入、配置和计价版本，手动批准绑定该快照。估价未知明确显示，不能作零费用；需有限风险额度，且说明其不能限制供应商实际账单。
- 主界面、通用命令、日志和业务库不携带可读 Key。专用凭据窗口只允许短时输入和一次性写入；返回引用与状态，不能读回。安全存储不可用时允许显式选择仅会话保存，禁止明文降级。
- 上一条是完整设计 §18.1 的实现澄清：键盘输入必然短暂存在于专用输入窗口内存；“不通过 renderer 流转”指主工作台 renderer 与业务数据通道，不承诺输入过程中不存在内存副本。
- 只运行本批相关测试；接口测试通过不能标记真实供应商已验证。不得在自动测试中读取环境中的真实 API Key 或调用付费接口。
- 每个 Task 的检查结果记录在 `docs/verification/p1-image-workflow.md`，区分已运行、未运行、fixture、真实接口和安装包证据。

## Review Focus

1. **重复费用：** 本地命令去重不等于供应商幂等；发送意图持久化、隐式重试关闭、未知状态对账属于 Task 5/6/9。
2. **假保存与原件丢失：** 文件系统与 SQLite 不共用事务；收存记录、hash、发布顺序和恢复属于 Task 4/9。
3. **迟到输出覆盖编辑：** 节点 incarnation、语义版本、运行绑定和手选输出版本共同校验，属于 Task 7/8。
4. **跨资料库或权限串用：** libraryId、connectionEpoch、文件 grant、凭据引用与事件游标分区，属于 Task 2/3/9。
5. **开发环境掩盖发行问题：** 原生 SQLite ABI、utility process 路径、私有媒体协议、干净安装和退出行为，属于 Task 1/8/10。

## 文件与职责地图

| 路径 | 唯一职责 |
| --- | --- |
| `apps/desktop/src/main/` | 窗口、资料库进程生命周期、凭据代理、文件授权、客户端 outbox |
| `apps/desktop/src/preload/` | 主界面和凭据窗口各自的固定白名单桥接 |
| `apps/desktop/src/renderer/` | 页面、连接客户端和视图状态，不执行 SQL 或供应商请求 |
| `packages/contracts/src/` | 可序列化 DTO、命令/查询映射、运行时解析器、事件/错误/连接契约 |
| `packages/domain/src/` | 任务、版本、审批、画布前置条件等纯领域规则 |
| `packages/storage/src/` | SQLite、迁移、仓储、对象收存与恢复记录 |
| `packages/providers/src/` | 协议解析、能力与图像适配；不能自行发布资产或改画布 |
| `packages/engine/src/` | 注册命令、跨领域事务、任务调度与应用生命周期 |
| `packages/ui/src/` | 设计 token 与无业务副作用的组件 |
| `tests/integration/`、`tests/electron/` | 生产边界和打包桌面验证 |

## 跨任务接口约定

所有对外值先从 `unknown` 解析。`Result<T>` 是 `ok/value` 或 `ok:false/error` 的判别联合；错误包含稳定 code、可操作 message、可选字段错误与 diagnosticId。ID 为不透明字符串，外部 URL/绝对路径不作为素材 ID。

```ts
interface WorkspaceConnection {
  describe(): Promise<Result<InstanceDescriptor>>;
  query<K extends keyof QueryMap>(request: QueryEnvelope<K>):
    Promise<Result<QueryMap[K]['output']>>;
  execute<K extends keyof CommandMap>(command: CommandEnvelope<K>):
    Promise<Result<CommandReceipt<CommandMap[K]['output']>>>;
  subscribe(request: EventSubscription, onEvent: (event: DomainEvent) => void):
    Promise<() => void>;
}
// Envelope: schemaVersion, libraryId, commandId/queryId, kind, payload.
// 修改命令另带目标的明确前置条件；身份来自已认证通道。
// Receipt: libraryId, commandId, requestHash, committedSeq, result.

interface ImageProviderAdapter {
  readonly adapterId: string;
  validate(input: FrozenImageRequest): Result<ValidatedImageRequest>;
  probe(input: ProbeRequest, context: ProviderContext): Promise<ProbeResult>;
  submit(input: ValidatedImageRequest, context: DispatchContext):
    Promise<SubmissionOutcome>;
  reconcile(input: ReconcileRequest, context: ProviderContext):
    Promise<ReconcileOutcome>;
}
// ProviderContext 只含引擎授予的 transport/凭据使用能力，不对 UI 暴露秘密。
// SubmissionOutcome: completed | accepted | rejected | unknown。
// reconcile 不受支持时返回 unsupported，不伪造未接单。

interface ObjectStore {
  collect(input: CollectionRequest): Promise<Result<DurableObjectReceipt>>;
  read(input: AuthorizedObjectRead): Promise<Result<ObjectReadStream>>;
}
// CollectionRequest 使用持久 collectionId、受限 sourceRef、大小/类型约束；
// receipt 带 hash/长度/最终 storageKey，发布资产引用由引擎事务完成。
```

固定命令名与输出：`project.create → ProjectRef`、`provider.saveConnection → ConnectionRevisionRef`、`model.saveDefinition → ModelRevisionRef`、`profile.save → ProfileRevisionRef`、`asset.importGrantedFiles → ImportRef`、`asset.saveArtifact → AssetVersionRef`、`canvas.applyCommand → CanvasCommit`、`generation.prepare → PreparedGeneration`、`generation.approveAndEnqueue → TaskRef`、`task.requestCancel → TaskView`、`task.reconcile → TaskView`、`task.retryCollection → TaskView`。

固定查询：`project.list`、`canvas.read`、`provider.list`、`model.list`、`profile.list`、`asset.search`、`task.list`、`task.read`、`command.receipt`。`describe()` 返回实例/资料库、协议、schema 和能力范围。命令登记表显式绑定对应 parser 与 handler，不通过数组顺序推断操作。

`generation.prepare` 持久保存有期限的准备记录、planHash、配置/输入/报价版本及接收方；`approveAndEnqueue` 接收 preparedId、approvedPlanHash、有限预算/未知费用确认，在事务中复核并消费授权。不得由 renderer 任意提供已验证快照。

调度、收存、画布关联分别拥有状态。媒体引用是 `ArtifactRef | AssetVersionRef`，均指固定内容。事件包含 libraryId、streamId、seq；快照带 snapshotSeq，游标过期明确要求重新同步。

## Task 1：正式工程、桌面引擎与可恢复项目

**Files — Create:** `package.json`、`package-lock.json`、`.nvmrc`、`.gitignore`、`tsconfig.base.json`、`vitest.config.ts`、`apps/desktop/package.json`、`apps/desktop/electron.vite.config.ts`、`apps/desktop/electron-builder.yml`；`packages/{contracts,domain,storage,providers,engine,ui}/package.json`（六个独立文件）；`apps/desktop/src/main/index.ts`、`apps/desktop/src/main/engine-host.ts`、`apps/desktop/src/preload/index.ts`、`apps/desktop/src/renderer/index.html`、`apps/desktop/src/renderer/main.tsx`；`packages/contracts/src/result.ts`、`packages/storage/src/database.ts`、`packages/storage/src/migrations/0001-projects.ts`、`packages/engine/src/bootstrap.ts`、`packages/engine/src/projects.ts`；`tests/integration/project-reopen.test.ts`、`tests/electron/packaged-startup.test.ts`。

**Interfaces:** `openLibrary(options): Promise<Result<LibraryHandle>>`，`startEngine(options): Promise<Result<EngineHandle>>`；handle 含本次启动身份与有界 `close()`，拒绝同库第二个写入引擎。

- [x] 建最小 npm workspace 与测试入口；核验锁定工具链/依赖许可和兼容关系。定义 `dev`、`build`、`typecheck`、`test`、`test:electron`、`package:win`，提交锁文件。渲染进程不能依赖 storage/providers 包。
- [x] 先写真实临时目录/SQLite 测试：创建项目，关闭引擎，重开后 ID/名称保留；第二个引擎抢占同库明确失败。写打包启动测试，确认 utility process 握手和写入资料库。
- [x] 运行 `npm test -- tests/integration/project-reopen.test.ts`，确认缺实现或行为断言失败；记录失败原因。
- [x] 实现单实例 ownership、迁移和项目仓储，main 等引擎握手后开放写命令；退出释放自己拥有的资源。仅启动的进程才能被终止，PID 单独不证明所有权。
- [x] 运行上述测试、`npm run typecheck`、`npm run build`、`npm run package:win -- --dir`，再跑打包启动测试；区分开发机通过和干净环境尚未验证。
- [x] 精确暂存本 Task 源文件与必要清单；提交 `feat(desktop): bootstrap local engine and persistent projects`。

## Task 2：统一命令、事件、IPC 和未确认操作

**Files — Create:** `packages/contracts/src/commands.ts`、`packages/contracts/src/queries.ts`、`packages/contracts/src/events.ts`、`packages/contracts/src/workspace-connection.ts`、`packages/engine/src/command-router.ts`、`packages/engine/src/event-stream.ts`、`packages/storage/src/migrations/0002-command-events.ts`、`apps/desktop/src/main/local-connection.ts`、`apps/desktop/src/main/command-outbox.ts`、`apps/desktop/src/main/ipc-policy.ts`、`apps/desktop/src/renderer/services/workspace.ts`、`tests/integration/command-delivery.test.ts`、`tests/electron/ipc-policy.test.ts`。**Modify:** Task 1 main/preload/bootstrap。

**Interfaces:** `LocalConnection implements WorkspaceConnection`；`CommandOutbox.enqueue(envelope)` 在发送前落盘，`settle(receipt)` 只确认同库/同 ID/同 hash 的记录；内部持久 receipt 与领域变更同事务提交。

客户端 outbox 是 main 拥有的独立持久日志，不能直接写资料库 SQLite；资料库中的 receipt 与领域状态仍只有引擎写入。

- [x] 先写断言：重复 create 返回同一项目，数据库只有一条；同 ID 异参拒绝；ACK 丢失重发不重复；切到 B 后 A 的迟到 ACK 仅清理 A 的 outbox。
- [x] 运行 `npm test -- tests/integration/command-delivery.test.ts`，确认红灯。另用真实 Electron frame 测试非授权 sender、未知频道和非法 payload 被拒绝。
- [x] 实现命令注册表、schema 校验、receipt、分区 outbox 和事件游标；快照订阅无间隙；非法/过期游标返回可重同步错误。主界面只收到窄 API，无 fs、process、完整 ipcRenderer。
- [x] 跑本 Task 两组测试和 typecheck。旧 ACK 可归档但不写当前 B 视图；程序退出前未确认命令能从主进程恢复队列恢复。
- [x] 提交 `feat(core): persist commands and scope workspace events`。

## Task 3：真实模型配置与凭据入口

**Files — Create:** `packages/contracts/src/models.ts`、`packages/domain/src/model-config.ts`、`packages/storage/src/migrations/0003-model-config.ts`、`packages/engine/src/model-config-service.ts`、`apps/desktop/src/main/credential-vault.ts`、`apps/desktop/src/main/credential-window.ts`、`apps/desktop/src/preload/credentials.ts`、`apps/desktop/src/credentials/index.html`、`apps/desktop/src/credentials/form.ts`、`tests/integration/model-config.test.ts`、`tests/electron/credential-entry.test.ts`。**Modify:** 命令/查询注册表、Electron 构建入口。

**Interfaces:** `CredentialVault.put(secret): Promise<CredentialRef>`、`status(ref)`、`withSecret(ref, operation)`；仅 main/获准引擎可使用 `withSecret`。主界面 `openCredentialEditor(connectionRef)` 仅返回引用/保存状态。

- [x] 先写断言：连接、模型、Profile 重开保留；Profile 修改生成新 revision；非法 URL/Header/不支持能力被拒绝；业务快照和 receipt 不包含测试 Key。
- [x] 跑对应测试确认失败，再实现四层配置对象，凭据通过系统保护的加密封套保存；旧凭据版本在仍有任务引用时保留，紧急撤销状态显式传播。
- [x] 专用凭据窗口独立 preload、严格 CSP、禁止网络/导航与持久浏览器存储；测试主工作台不能读取 Key，安全存储不可用不落明文。
- [x] 私网/本机模型地址需明确的精确主机/端口授权；普通素材 URL 的访问权限不能继承该授权。参数校验用受限字段描述，不执行用户提供 schema 代码。
- [x] 跑两组测试和 typecheck；提交 `feat(models): persist versioned profiles and protected credentials`。

## Task 4：真实文件导入、原件收存与资产版本

**Files — Create:** `packages/contracts/src/assets.ts`、`packages/domain/src/media-reference.ts`、`packages/storage/src/migrations/0004-assets-collection.ts`、`packages/storage/src/object-store.ts`、`packages/storage/src/collection-journal.ts`、`packages/engine/src/asset-service.ts`、`apps/desktop/src/main/file-grants.ts`、`apps/desktop/src/main/media-protocol.ts`、`tests/integration/asset-collection.test.ts`、`tests/electron/media-access.test.ts`。**Modify:** bootstrap、main、命令注册表。

**Interfaces:** 上述 `ObjectStore`；`FileGrant` 绑定 grantId、importId、libraryId、期限和获准真实文件；通用命令只接收 grantId。`asset.saveArtifact` 发布资产版本，重复命令返回原版本。

- [x] 先写实际文件测试：导入 PNG/JPEG/WebP，删除外部源文件后原件仍可读；重复投递不重复建版本；同字节可复用 Blob，独立逻辑资产不因 hash 相同被合并。
- [x] 增加在 staging 写入、最终 rename、数据库发布前各处中断的恢复断言，以及磁盘写入失败/大小超限/解码像素超限。运行本 Task 测试确认失败。
- [x] 实现 collection journal → staging → 有界校验/hash → 不可变对象 → 发布引用；只有最终发布成功才 ready。清理仅处理本次作业拥有的临时对象；P1 不做自动物理 GC。
- [x] 实现带权限校验和 Range 的私有媒体协议、缩略图与容量预检；非法路径/链接越界、跨库 grant、伪造对象 ID 不可读。预览可重建，原件完整性单独验证。
- [x] 跑两组测试；提交 `feat(assets): import durable originals and immutable versions`。

## Task 5：审批、持久任务与不重复提交的调度

**Files — Create:** `packages/contracts/src/generation.ts`、`packages/domain/src/task-state.ts`、`packages/domain/src/approval.ts`、`packages/storage/src/migrations/0005-generation.ts`、`packages/engine/src/generation-service.ts`、`packages/engine/src/scheduler.ts`、`packages/engine/src/task-recovery.ts`、`packages/providers/src/image-provider.ts`、`tests/fixtures/image-provider-server.ts`、`tests/integration/generation-recovery.test.ts`。**Modify:** 注册表、bootstrap。

**Interfaces:** `prepareGeneration(input): Promise<Result<PreparedGeneration>>`；`approveAndEnqueue(input): Promise<Result<TaskRef>>`；`acquireDispatch(attemptId, leaseToken): Promise<Result<DispatchPermit>>`。Task/Attempt、供应商状态/收存状态分别存储；提交意图与稳定 clientRequestId 在网络调用前持久化。

- [x] 先用可控本地 HTTP 服务写行为测试：重复批准只创建一项任务；同一批准异参拒绝；两任务并发预留不超额；输入/配置/报价变化或批准过期阻止提交。
- [x] 加入服务端接收后断连、提交前后崩溃、租约失效、取消与完成交错；断言供应商收到的 POST 数量，未知状态重启后仍为一，不因轮询/租约过期增加。
- [x] 运行 `npm test -- tests/integration/generation-recovery.test.ts` 确认红灯，按状态机实现准备、审批、预算预留、队列、dispatch permit、租约与 fencing。固定精度金额与币种明确，未知计价单独保存。
- [x] 关闭 submit 的隐式 HTTP/SDK 重试；持有原 task ID 的作业只 query/reconcile；不支持对账时停在待处理。旧 worker 可提交带来源的外部事实，但不能凭旧 token 更新当前状态。
- [x] 覆盖排队取消、运行取消不受支持、取消不等于退款、失败收存只重试 collect；已付费结果优先收存，磁盘不足暂停新 dispatch。
- [x] 测试通过后提交 `feat(tasks): add approved persistent image generation lifecycle`。

## Task 6：第一个真实图像协议适配器

**Files — Create:** `packages/providers/src/openai-images.ts`、`packages/providers/src/http-transport.ts`、`packages/providers/src/artifact-source.ts`、`packages/providers/src/probe.ts`、`tests/integration/image-provider-contract.test.ts`、`docs/providers/openai-images.md`。**Modify:** engine 适配器注册、Task 5 fixture。

**Interfaces:** `OpenAIImagesAdapter implements ImageProviderAdapter`；能力和验证状态按 connection revision/model ID 记录。输出为受限下载 sourceRef 或已收存 staging receipt，临时 URL 不能直接作为永久素材。

- [x] 实施时阅读所选服务的官方接口文档并记录版本/日期；先支持明确的图像生成协议子集。文档不匹配的服务另建适配器，不用任意路径/脚本模板假装通用兼容。
- [x] 编写 HTTP 契约测试：实际请求字段、参数拒绝、401/429/明确拒绝、断连未知、超大响应、URL/base64 输出、跨域重定向不携带认证。先运行确认失败。
- [x] 实现有界请求/响应解析与输出收存。URL 经过受限下载器；inline 输出在内存丢弃前取得持久 staging 身份。敏感访问 locator 只由内部收存模块使用，UI/日志不暴露。
- [x] 连接测试拆成“配置有效”“端点/认证探测”“真实生成已验证”。没有免费的权威探测就标记未知，真实出图测试单独明确费用，不把 `/models` 成功当作图像生成成功。
- [x] 用本地协议服务跑 `npm test -- tests/integration/image-provider-contract.test.ts`；记录为 fixture 验证。真实 API 留给 Task 10，当前不得填写已实测。
- [x] 提交 `feat(providers): implement configurable image generation adapter`。

## Task 7：持久画布与正确的结果归属

**Files — Create:** `packages/contracts/src/canvas.ts`、`packages/domain/src/canvas-command.ts`、`packages/domain/src/run-binding.ts`、`packages/storage/src/migrations/0007-canvas.ts`、`packages/engine/src/canvas-service.ts`、`packages/engine/src/result-attachment.ts`、`tests/integration/canvas-result-binding.test.ts`。**Modify:** prepare/enqueue 与 collection 完成事务、命令/查询映射。

**Interfaces:** `applyCanvasCommand(command): Promise<Result<CanvasCommit>>`；`trySelectRunOutput(binding, output): Result<SelectionDecision>`。布局、内容和输出选择各有前置条件；enqueue 原子建立 RunBinding；不匹配的结果只进历史。

- [x] 先写重开还原节点/布局/选中输出；无关拖动不阻断内容命令，同字段冲突返回差异；同命令重放不重复增版本。
- [x] 重点断言：A→B→A、同参数连续两次生成、手选旧结果、删除后撤销为新 incarnation，旧任务均不能抢占当前输出。运行测试确认失败。
- [x] 实现基础节点 manifest、canvas command、事件/逆命令和输出引用；撤销只处理本命令仍拥有且未被后来更改的字段，不反转已产生的供应商费用。
- [x] P1 生成节点固定自身提示词/模型与明确选定输入；没有执行图能力的关系不显示为可运行依赖。加入资产、从资产放回画布均引用固定内容。
- [x] 跑测试/typecheck；提交 `feat(canvas): persist edits and guard late generation outputs`。

## Task 8：把 UI 样板接成真实工作台

**Files — Create:** `packages/ui/src/tokens.css`、`packages/ui/src/controls.tsx`、`packages/ui/src/overlays.tsx`、`apps/desktop/src/renderer/App.tsx`、`apps/desktop/src/renderer/features/projects/ProjectHome.tsx`、`apps/desktop/src/renderer/features/models/ModelSettings.tsx`、`apps/desktop/src/renderer/features/assets/AssetLibrary.tsx`、`apps/desktop/src/renderer/features/canvas/CanvasWorkspace.tsx`、`apps/desktop/src/renderer/features/tasks/TaskPanel.tsx`、`apps/desktop/src/renderer/services/query-cache.ts`、`apps/desktop/src/renderer/state/canvas-draft.ts`、`tests/electron/image-workflow.test.ts`。**Modify:** renderer/main.tsx、主 preload、构建配置。

**Interfaces:** 页面只依赖 `WorkspaceConnection` 和无密钥的桌面能力；服务端视图按 libraryId 分区，Zustand 仅保存短期编辑/选择状态，持久事实通过命令与查询获得。

- [x] 先写桌面端到端测试：使用 fixture 图像服务完成配置→批准→生成→保存资产→放入画布→退出重开，检查数据库/原件和可见状态，不只检查 toast 文案。先确认链路失败。
- [x] 从 UI 规范迁移 token/组件，完成首页、模型设置、资产、画布、任务面板；删除业务路径中的随机进度、定时成功、假连接测试。尚未实现入口明确标注。
- [x] 展示已接单/待核实/正在收存/已保存/已加入资产的真实状态；输出选择和当前查看库独立。离线/断引擎时停止新提交，未确认编辑可恢复。
- [x] 完成弹层焦点、Escape、键盘导航、加载/空/错/长内容。用纯色/随机替换/无媒体验收界面；动效读 prefers-reduced-motion，不能依赖固定封面图。
- [x] 跑端到端、typecheck/build；人工记录 1440×900 和 1100×720、系统缩放与关键弹层表现。实际未测的平台/DPI 如实留空。
- [x] 提交 `feat(workspace): connect desktop UI to real engine workflows`。

## Task 9：退出、崩溃、睡眠与收存故障恢复

**Files — Create:** `apps/desktop/src/main/lifecycle.ts`、`packages/engine/src/shutdown.ts`、`packages/engine/src/maintenance.ts`、`tests/integration/engine-lifecycle.test.ts`、`tests/integration/collection-crash.test.ts`、`tests/electron/workspace-reconnect.test.ts`。**Modify:** engine-host、task-recovery、collection-journal、outbox、TaskPanel。

**Interfaces:** `quiesceEngine(reason, deadline): Promise<ShutdownReport>`；report 区分已停止领取、已持久化、已退出资源、清理待重试。恢复先对账，不能将所有“未完成”作业重新 enqueue submit。

- [x] 先在真实子进程中设置可重复故障点：发送前/响应后、收存完成但 DB 未发布、退出最终清理阶段；重新启动原库，断言原件/状态可恢复、POST 计数不增加。
- [x] 加入晚握手、重复启动、清理失败保留所有权、睡眠后唤醒、renderer 重载/outbox 重发、切库后的旧事件。运行测试确认失败。
- [x] 实现关闭窗口的托盘/完全退出选择，完全退出停止本机编排并有界清理；云端任务不假装取消。睡眠恢复重新握手/对账；显式取消独立于关闭窗口。
- [x] 维护模式保护迁移与一致快照；新 schema 失败保留备份与诊断，不覆盖原库。旧版本恢复需要匹配数据库备份，禁止宣称任意 schema 可降级。
- [x] 跑三组测试与已受影响的 Task 5/7 回归；提交 `fix(engine): reconcile interrupted jobs and preserve recovery state`。

## Task 10：安装包、真实 API 和交付证据

**Files — Create:** `scripts/verify-package.mjs`、`scripts/run-live-image-check.mjs`、`docs/verification/p1-image-workflow.md`、`docs/development.md`。**Modify:** package 脚本、electron-builder.yml、打包桌面测试。

**Interfaces:** 活体验证脚本默认拒绝执行，必须传入已配置的 connection/profile 引用、明确 opt-in、有限图片数量和测试额度；不接受明文 Key 命令行参数，不进入默认测试集。

- [x] 检查最终包资源、SQLite ABI150/Sharp、utility process、两个 HTML/preload 与中文/空格资料库/程序路径；缺资源和开发 Node 拒绝断言见 release-tools 测试。
- [x] 最终 `typecheck`、`build`、`package:win` exit0；`npm test` 178/178；`test:electron` 36/36；详细命令与产物 hash 见 [验证记录](../../verification/p1-image-workflow.md)。
- [ ] 干净 Windows 安装未验证：没有无开发工具的环境，未用开发机解包运行替代；个人测试包未签名。
- [ ] 真实 API 验收未完成：用户明确留到以后。本轮不发现实际 Key、不产生真实费用，仅验证脚本拒绝/配置 fixture 与本机启动门禁。
- [x] 复看 Task8 实际无图/纯色/随机导入截图；记录本机单次启动1255.16ms及两次进程 CPU/工作集/生涯峰值快照，持续峰值未测，不声称500节点达标。
- [x] 交付未签名本地测试 NSIS、运行说明与已知限制；保留真实 API/干净系统待验，未将完整 P1 标为完成。发布提交 `chore(release): package and verify desktop image workflow`。

## 自审与后续衔接

- 已将代码、凭据、媒体、任务状态和画布输出的所有者分开；接口按命令名定义，任务消费前面已建立的契约。
- P1 覆盖完整设计 §7–10、§11 基础编辑与结果归属、§15–18 本机路径、§19 本地资料库及 §21 的相关验收。完整多媒体/工作流/Agent/迁移能力未偷偷计入 P1。
- 本计划没有预先确定用户的服务商、模型 ID、收费额度或最终 UI 材质。以上均不阻碍本地契约开发；真实 API 通过状态必须等实际证据。
- P2 补文本/异步视频与完整执行图；P3 补 Agent/实体/分镜；P4 补时间线与成片；P5 完成远端部署、完整备份/迁移/升级矩阵，详见路线图。
- 原始计划编写时只做文档自审。当前本地实现/fixture/最终安装包证据已记入验证记录；真实 API 与干净安装仍待验，文档自审本身不计作功能验证。






