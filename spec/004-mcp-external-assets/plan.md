# SPEC-004 M1：MCP 与外部图片生产闭环实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline, task by task. Steps use checkbox syntax. User approved SPEC-004 and said 开始开发 on 2026-11-02; continue through all M1 tasks without another approval round.

**Goal:** 用本机真实 MCP 客户端导入外部图片，复用为角色/分镜/画布资产，并在未配置图像模型时准备与执行已有视频工作流。

**Architecture:** stdio SDK server 是轻客户端，通过认证本机 named pipe 访问已启用 MCP 的桌面工作区。桌面主进程持有导入来源授权、复合操作回执和既有 LocalConnection；唯一 utility engine 继续负责原件收存、业务命令、版本、任务与事件。图片复用加入共享分镜生产服务和 UI。

**Tech Stack:** 既有 TypeScript/React/Electron45/Node24；官方 @modelcontextprotocol/sdk 1.32.2（npm 查询确认）；schema 使用 SDK 所需的 Zod，固定版本；Vitest、Playwright Electron。stdout 仅 MCP 协议。

**Spec:** D:/movieAgent/spec/004-mcp-external-assets/spec.md（用户已批准；本计划仅 M1，M2/M3 未执行）。

## Global Constraints

- Windows 本机 Electron；不加入远程服务、第二个引擎或第二个 SQLite 写入者。
- 应用模型配置不修改；保留所有既有代码/创作数据。本轮无付费模型调用。
- 文件导入仅授权目录相对路径或有界 base64；图片32 MiB/4000万像素，bytes解码8 MiB。
- 所有写操作有稳定 requestId/commandId 和明确工作范围；已有对象修改带版本；未知提交先核对。
- 外部图进入正式对象库，有固定版本与来源；导入、归属、绑定结果分别可见。
- MCP 费用批准复用现有工作流计划/预算，不能让外部 approved=true 自行授权。
- 在当前 codex/desktop-foundation 工作树原位实施，先保存受影响文件快照；不重置、不合并、不自动提交混合历史变更。

## Review Focus

1. 导入成功但客户端断线/绑定冲突：回放同一资产，不重复入库或覆盖并发编辑（T2/T3）。
2. 恶意路径、链接、文件中途替换、畸形/超大 base64：收存前拒绝，不取得其他文件权限（T2）。
3. 多项目、旧连接、退出重开：显式实例/范围，不能跨项目或重新收费（T3/T4）。
4. 已选图缺失、模型不支持首帧、混合生成与复用：预检失败或冻结正确图，零多余图像任务（T1/T4）。
5. 工具端等待超时/禁用连接：持久任务继续可查，授权撤销不伪报物理工作结束（T2/T3/T5）。

## Task 1：共享分镜外部图复用

**Files:** packages/contracts/src/shot-production.ts；packages/engine/src/shot-production-service.ts；apps/desktop/src/renderer/features/creation/ShotProductionPanel.tsx；tests/integration/shot-image-reuse.test.ts。
**Interfaces:** 新增可选 reusedImages: {shotId, ref:MediaReference, role:'first_frame'|'reference'}[]；每镜头最多一项。原无此字段输入/历史计划保持兼容；有复用项的镜头跳过 imageProfileRef 步骤。视频节点 referenceImages 冻结同一引用。

- [x] 写测试：仅视频profile+导入图能 prepare/apply/workflow；steps只有video；固定图进入首帧；无图像请求。拒绝错项目、非图片、重复shot、不兼容model；选择版本变化冲突；旧两步计划不变。
- [x] 运行 `npx vitest run tests/integration/shot-image-reuse.test.ts`，确认新增输入被拒绝的 RED。
- [x] 扩展输入校验、计划冻结/引用校验和角色循环；UI增加“复用已选分镜图”与用途选项，缺图明确报错。
- [x] 同时运行新增测试及 shot-production/reference/workflow 相关现有测试，typecheck；记录结果与快照，不自动提交历史工作树。

## Task 2：可信图片接收、持久复合导入

**Files:** 新建 apps/desktop/src/main/mcp/import-files.ts、operation-store.ts、asset-import.ts；新建 packages/contracts/src/mcp.ts；tests/integration/mcp-import.test.ts。
**Interfaces:** `receiveImage(source, sources, stagingRoot, operationId): Promise<Result<ReceivedImage>>`；`McpOperationStore` 使用独立 main-owned SQLite 文件（同一主进程唯一持有、只保存MCP回执，不写业务库），`start(input)`/`get(id)`/`resume(id)`；`McpAssetImporter` 消费 main-only execute/query/registerFileGrant 接口，产生固定资产ref和分步回执。

- [x] 测试真实png导入、范围、哈希、删除临时源仍可读、同ID重放、同ID不同参数冲突、metadata/shared/entity/shot/canvas绑定。
- [x] 测试路径越界/链接/超限、非法base64、重开每个步骤、部分成功和修改后的版本不覆盖；恢复先查 command.receipt。
- [x] 观察 RED，再实现接收/状态机。配置默认私有 inbox；额外目录由OS picker授权。来源记录关联assetRef，不伪造生成artifact。
- [x] 跑 mcp-import 与 asset-collection/subproject-assets 集成测试，完成后记录。

## Task 3：有类型的工具与本机桥

**Files:** 新建 apps/desktop/src/main/mcp/{tools,transport,service,stdio}.ts；scripts/movieagent-mcp.cmd（交付模板）；tests/integration/mcp-protocol.test.ts；apps/desktop/package.json及锁文件。
**Interfaces:** `createMcpServer(call)` 使用官方Server和stdio；明确JSON schemas，调用前严格验证。`createMcpService(options)` → start/status/configure/close；`callTool(name,args,client)` 为唯一工具白名单。

- [x] 实际SDK client握手/list/call测试先RED；未知tool、未知字段、版本冲突、错误scope、畸形/超大frame返回结构化错误。
- [x] 实现doctor/capabilities、项目/子项目查询和创建、资产列表/读取/预览/导入/版本/标签/共用、实体/分镜绑定、最小画布create/connect、视频生产prepare/status/cancel/reconcile。每次写入必须requestId，固定作用域。
- [x] 支持operation_get/resume、tasks_get/wait（有界）；不直接开放 generic execute/query、密钥、任意path和费用approve。
- [x] 本机认证描述文件保存在当前用户应用数据目录；随机管道/秘密，每次启用刷新；最多8客户端、每frame12MiB、读写超时/断线清理、禁用撤销。描述文件不能出现在工具结果。
- [x] 基于真实引擎跑SDK集成用例，覆盖并发与重开；记录官方SDK版本/协议协商结果。

## Task 4：桌面集成、配置与费用执行

**Files:** apps/desktop/src/main/{workbench,ipc-policy}.ts；apps/desktop/src/preload/index.ts；packages/contracts/src/desktop.ts；新建 renderer/features/models/McpSettings.tsx；models/ModelSettings.tsx；production tests。
**Interfaces:** DesktopBridge新增mcpStatus/mcpConfigure/mcpSelectImportDirectory；main-frame + exact URL守卫继续有效。MCP每工作区默认关闭，设置可启用、复制不含秘密的客户端配置、显示实例/连接、允许导入目录、禁用撤销。

- [x] UI与IPC测试先RED：未启用拒绝、只由主窗口启用/选择目录、配置不含秘密；MCP变更经原事件在UI显示。
- [x] workbench关联当前LocalConnection/EngineHost，退出先停MCP接收；reconnect不保留旧epoch授权。查询recent registry并只允许打开已登记工作目录。
- [x] 费用动作：MCP创建workflow准备计划；执行请求在应用原生确认框展示冻结计划hash/步数/模型/费用与上限，用户确认后主进程提交现有approve命令。同requestId只确认/执行一次；MCP回包提供plan/task ID，不能用布尔参数绕过。
- [x] 集成UI复用输入与资产预览，renderer/IPC定向测试通过。

## Task 5：打包与真实桌面 MCP 冒烟

**Files:** apps/desktop/electron.vite.config.ts；scripts/verify-package.mjs；新建 tests/electron/spec004-mcp.test.ts；docs/MCP-使用说明.md；根目录MovieAgent-MCP.cmd（稳定入口）。
**Interfaces:** 打包新增mcp-stdio.js入口，使用当前应用自带Electron的ELECTRON_RUN_AS_NODE运行，不要求全局Node。配置用应用路径和当前用户discovery路径，不包含token。

- [x] 本机真实SDK/桌面测试：隔离工作目录、空模型文件、真实png素材；启用MCP、连接、导入/重放/读取/绑定/画布、UI可见、断开/重开后原件可读。
- [x] fixture视频profile，复用导入图得到冻结视频计划、image步骤0；不发送真实云请求。费用取消/拒绝流程不入队。
- [x] 打包到全新 release-spec004-m1，校验包含真实SDK入口、所有renderer/preload边界；原启动脚本在门槛前保持不变。
- [x] typecheck、全核心/renderer/media回归、build、package、verify-package和上述实际桌面冒烟；记录所有结果、未知项。

## Task 6：独立审查与交付

- [x] 依执行技能，单次最强可用模型新上下文审阅修改范围、spec/plan/ledger和证据；按实际用户影响处理Important/Critical，回归证明。
- [x] 包与最终源码核对，模型配置内容哈希与开工前一致、当前mtime已记录；通过后切换启动MovieAgent.cmd，生成稳定MCP启动入口和可复制配置。
- [x] 更新spec/index状态：M1工程实际结果单列；M2/M3未实施；宿主生图传入/真实付费视频/人工效果分别标未验。
- [x] 不自动修改Codex全局配置、重启用户应用或制造付费调用；交付说明启用步骤及测试范围。

## 预检与裁定

- 采用上一轮Native inline执行；用户“可以，开始开发吧”已授权本方案第一批及必要实施选择，不追加计划批准轮。
- 计划位于源码Git外，使用 verification/2026-11-02-spec004-m1/progress.md 与 before快照代替依赖提交范围的skill脚本。
- M1复合日志采用main-owned独立SQLite，与既有command outbox模式一致；不是第二个业务资料库写入者。源码/数据库表迁移不必为桥日志改动业务schema。
- 全部本地验收无真实模型调用；真实外部宿主生图+付费视频留待另行实际验收，不冒称已通过。
## 最终状态

M1本机实施与验收完成。工具名、SDK与约束已固定；完整测试与所有裁定见[报告](../../verification/2026-11-02-spec004-m1/report.md)。无真实模型调用。2Minor明确延期，非全SPEC无条件Verified。测试按实际覆盖验证，不宣称穷举每条OS指令的崩溃点。
