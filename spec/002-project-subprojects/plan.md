# 项目、子项目与连续创作 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 在同一项目内完成多集/多期独立制作、统一资产访问、自动记忆与可恢复交付。
**Architecture:** 保留不可变业务 JSON 与既有资源 ID，通过增量归属登记表关联子项目。命令与查询信封携带可选作用域，路由统一验证/登记，既有无作用域调用进入默认子项目；固定计划与后台任务保持来源。新模块负责子项目、资产登记、完成快照、记忆与制品。
**Tech Stack:** TypeScript、React 19、Electron 45、Node 24、SQLite、Vitest、Playwright。
**Spec:** [SPEC-002](spec.md)

## Global Constraints
- Windows 本机 Electron；应用模型配置；每项目独立目录。
- 同项目资产直接跨子项目引用，固定媒体版本、保留来源、原件不复制。
- 完成后自动更新记忆，不逐条审批；未知供应商提交不自动重复。
- 保留旧 ID、历史不可变 JSON、用户文件、在途任务。
- 现有 64 片段/600 秒/每批 16 镜头容量维持；不设项目累计上限。

## Review Focus
- 旧数据库画布唯一索引/外键及多条时间线：Task 1 填充迁移夹具验证。
- 子项目切换期间异步预检、审批与迟到结果：Task 2/5 检查信封与固定登记。
- 同资料库不同父项目素材与共享声音：Task 3 验证允许/拒绝引用边界。
- 自动记忆重复完成、旧响应、失败及重开：Task 4 验证快照幂等与生效指针。
- 备份表白名单、旧 schema 夹具与恢复：Task 6 验证完整迁移和恢复。

### Task 1: 子项目、画布与归属存储
Files: contracts/src/subprojects.ts；storage/src/migrations/0026-subprojects.ts；database.ts；schema.ts；engine/src/subproject-service.ts；tests/integration/subprojects.test.ts。
Interfaces: subprojectsFor(library).create/list/read/update/createCanvas/listCanvases；content owner 使用 kind/id/projectId/subprojectId。
- [x] 写填充旧数据迁移、默认子项目、多个画布与 CAS 修改测试，运行见红。
- [x] 实现 schema26，事务重建 canvas 唯一约束；保留历史 ID；默认归属兼容；新项目初始化。
- [x] 运行新测试、既有迁移测试并记录结果。

### Task 2: 命令、查询与任务作用域
Files: contracts commands/queries；engine command-router；engine content-scope；bootstrap；desktop IPC validation。
Interfaces: optional scope {projectId,subprojectId}；scope validates target owners, registers command results and filters query DTOs.
- [x] 写跨集修改/审批拒绝、新资源归属、同集读取和无 scope 旧调用兼容测试，运行见红。
- [x] 增加严格作用域解析与请求哈希；预检及事务提交双重验证；结果登记与 query 过滤；传递 UI 实际 canvasId。
- [x] 回归 command delivery、Agent、画布、制作和时间线。

### Task 3: 项目资产与制品
Files: engine project-assets；contracts subprojects；asset query UI；subproject deliverables。
Interfaces: catalog(projectId,source/all/common), fixed reference registration, deliverable from owned timeline revision/export.
- [x] 写兄弟资产直接复用、跨父项目拒绝、版本/来源、主时间线归属和制品固定测试，运行见红。
- [x] 登记导入/生成来源、公共分类与固定使用关系；已有收存资产迁移；复用不复制原件。
- [x] 完成多制品登记与可追溯列表，运行用例。

### Task 4: 完成快照与自动记忆
Files: engine project-memory-service / coordinator；agent-context integration；contracts subprojects；tests/integration/subproject-memory.test.ts。
Interfaces: complete fixes source snapshot and text profile；durable memory task follows existing generation jobs；context returns version manifest.
- [x] 写重复完成、无模型、异步旧结果、失败/未知、显式设定优先和前期来源固定测试，运行见红。
- [x] 实现自动整理、原子生效、编辑/撤回、前期来源关系与 Agent 采用清单；恢复跟踪原任务。
- [x] 使用本地文本 fixture 验证实际生成与下一集上下文，不调用真实模型。

### Task 5: Electron 子项目工作台
Files: renderer App/runtime；features/subprojects；canvas/creation/agent/timeline/assets；main project directories。
Interfaces: scoped runtime provider, subproject selector, canvas selector, project overview, memory status.
- [x] 写创建/切换/多画布/资产视图/完成操作与导航草稿测试，运行见红。
- [x] 接通子项目界面、各模块 scoped query/command、主画布/时间线、项目记忆与制品；创建稳定 ID 目录。
- [x] 保留现有视觉组件，验证旧单集路径和切换缓存。

### Task 6: 回归、维护与交付
Files: storage backup/transfer；tests migration fixtures/electron；verification evidence；spec status。
- [x] 增加填充备份恢复、跨两集创作/记忆/引用/交付的集成场景。
- [x] 运行 typecheck、全部 integration、renderer 与相关 Electron 场景；修复实际失败。
- [x] 执行一次独立整体代码审阅，处理重要问题；打包并验证本机程序，记录真实服务未验项。
- [x] 更新 spec 实现/验收状态与使用文档；保持进度 ledger。

## 执行裁定
- 用户“那开始执行吧”授权按最新 SPEC-002 开发，视为设计批准；直接本会话执行，不增加二次启动确认。
- 当前 feature 分支 codex/desktop-foundation 含大量已验收未提交代码；HEAD 不含完整产品。采用当前工作树为基线并备份将修改的源码，避免新 worktree 丢失产品现状；不重置或整体提交既有改动。
- 计划与 ledger 放在用户指定 spec 目录；不提交其他人的既有改动。


完成记录：全部任务的工程实现与本机验收已完成，详见 [实施与验收记录](implementation.md)。真实服务质量不在本次通过结论中。
