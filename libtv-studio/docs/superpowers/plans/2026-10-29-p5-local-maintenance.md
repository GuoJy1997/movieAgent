# P5 Local Maintenance Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for continuous inline execution; one fresh independent final review. Steps use checkbox syntax.

**Goal:** 交付可操作的本机短剧项目备份/恢复、迁移和手动升级维护。
**Architecture:** 共享目录备份格式与冷项目排他锁，主进程原生选择目录，恢复调度门禁接入引擎，启动器统一入口。恢复新 workspaceId、固定领域身份，迁移保留原目录但停用原运行身份。
**Tech Stack:** 现有TypeScript/React/Electron45、Node24 SQLite、fs流式复制、Vitest。
**Spec:** docs/superpowers/specs/2026-10-29-p5-local-maintenance-design.md

## Global Constraints

- Windows本机版；无Linux/远程引擎/自动更新/付费API。
- 保留当前P4程序、用户配置/项目；仅自有测试目录。Git HEAD不代表现有脏源码，不做Git变更；明确源码快照/哈希供最终审阅，保留ledger。
- 备份schema1，100000文件/深度32/8GiB每文件/256GiB总量/16MiB清单/64KiB项目清单。独占目标、逐组件拒绝链接、流式hash。
- 冷项目操作须取得engine-guard排他锁；DB一致快照包含WAL；固定领域引用和原件完整。
- 恢复副本默认生成暂停且全新workspaceId；retired来源不得启动；同launcherData的libraryId锁覆盖副本互斥。
- 应用升级仍手动；稳定appId，版本0.2.0，release-p5；原项目不删除。

## Review Focus

1. 包路径篡改、大小写冲突、junction及目标包含源：失败且原文件不改。Task1。
2. 快照漏掉WAL、孤立/缺失原件与发布前中断：不产生可恢复的假成功。Task1。
3. 带排队/unknown任务的恢复副本在启动及重连时自动提交：门禁覆盖所有编排入口。Task2。
4. 迁移中断/再次点击或两个副本同时打开：保留原件、幂等或明确拒绝、最多一个执行所有者。Task2。
5. 原生操作取消/迟到响应/iframe调用，以及新版schema被旧版打开：UI不假成功、不执行任意路径，原库保护。Task3/4。

### Task 1: 目录备份与恢复核心

**Files:** Create packages/contracts/src/project-maintenance.ts; packages/storage/src/project-backup.ts; packages/storage/src/project-transfer-files.ts; packages/storage/src/project-maintenance-lock.ts; tests/integration/project-backup.test.ts.
**Interfaces:** createProjectBackup({projectRoot,destination,appVersion}):Promise<Result<BackupReceipt>>; inspectProjectBackup(backupRoot):Promise<Result<BackupManifest>>; restoreProjectBackup({backupRoot,destination,name?}):Promise<Result<TransferReceipt>>. Expose shared lock/copy helpers for Task2 without imports from main. Receipts contain IDs/counts/bytes/hash/selected output path; no credentials.
- [x] RED: real directory project+SQLite+object, backup then restore into中文新目录, assert unchanged source, matching domain IDs/object bytes, new workspaceId/paused policy, complete manifest; import missing APIs must first be represented by failing API expectation.
- [x] RED→GREEN validation matrix: corrupt hash/truncatedfile/missingobject/newerschema/pathtraversal/caseduplicate/link/nestedtarget/existingtarget/lockedlibrary, abort before manifest publication, completedretry.
- [x] Implement strict contracts and focused filesystem units; stream copy/hash and SQLiteVACUUM snapshot with integrity/reference checks.
- [x] Run node node_modules/vitest/vitest.mjs run tests/integration/project-backup.test.ts --maxWorkers=1; expect allpass. Run affected directory/storage regressions. Record exact command/stdout/stderr/exit.

### Task 2: 恢复门禁、迁移及所有权

**Files:** Create packages/storage/src/library-maintenance-state.ts; apps/desktop/src/main/project-maintenance.ts; tests/integration/project-maintenance-recovery.test.ts. Modify packages/storage/src/database.ts, packages/engine/src/bootstrap.ts, apps/desktop/src/main/{engine-host,engine-process,workbench,project-directories,command-rejection}.ts.
**Interfaces:** readLibraryMaintenance(root):Result/state; activateRestoredProject({projectRoot,identityRoot}):Promise<Result<TransferReceipt>>; migrateDirectoryProject({projectRoot,destination,appVersion,name?}):Promise<Result<TransferReceipt>>; openLibrary/startEngine accept optional identityGuardRoot, EngineHandle expose schedulingAllowed status through trusted metadata.
- [x] RED: restored real engine preserves queued/unknown tasks, schedulerstart/recover/publicexecute emitszeroPOST and returns RESTORED_PROJECT_PAUSED; pending rejection does not block outbox reopen.
- [x] RED: migration rejects active source, complete migration retires source and permits target, repeated attempt no overwrite; two same-library copies with sharedidentityGuardRoot cannot both own execution. Failure before retirement preserves active source.
- [x] Implement policy gate before all background start/recovery and execution commands; do not mutate copied historical states or resubmit unknown. Nativeactivation under lock and explicit user confirmation.
- [x] Run focused recovery tests plus storage-lock, command-delivery, workspace-bootstrap/directoryproject dependents; typecheck.

### Task 3: 启动器维护与手动升级体验

**Files:** Modify packages/contracts/src/launcher.ts; apps/desktop/src/main/{launcher-ipc,project-launcher}.ts; apps/desktop/src/preload/launcher.ts; apps/desktop/src/launcher/Launcher.tsx. Create apps/desktop/src/launcher/ProjectMaintenancePanel.tsx and tests/renderer/project-maintenance.test.ts; add tests/integration/project-maintenance-ipc.test.ts. Modify scripts/verify-package.mjs preloadallowlist and apps/desktop/package.json version0.2.0; electron-builder.yml explicit preserve appdata on uninstall if supported.
**Interfaces:** ProjectLauncherBridge maintenanceInfo/backupProject/restoreProject(name)/migrateProject(name)/activateRestoredProject/revealUpgradeInstaller; renderer supplies only safe name or noargs. Main owns every path/dialog/confirmation, returns cancel as ok(null). maintenanceInfo returns actual appVersion/schema/backupformat.
- [x] RED mounted UI: nativeactioncancel/success/failure/busy, version info, restoredpaused instructions, no optimistic completion, preserved existingproject create/open.
- [x] RED IPC: wrongsender/frame/url, extra/rawpath arguments rejected; canceled native select never mutates or launches. Upgrade chooser only locates selected local installer, never autoexecutes.
- [x] Implement native actions using Task1/2 services and recentprojects; retain current theme controls. Explain closed-project requirement and restored activation. Replace stale launcher footer with currentfeatures.
- [x] Run renderer+IPC+launcher-security regressions and typecheck.

### Task 4: 本机完整验收、发行与交付

**Files:** Create tests/electron/p5-maintenance.test.ts; docs/delivery/2026-10-29-p5-local-desktop.md; docs/verification/p5-maintenance.md. Update roadmap/development version details.
- [x] Create bounded packaged test using own Chinese project/dummyconfig: originalproject data→close→native-backed backup→verified restore→paused zeroPOST→explicitactivation or migration→reopen/source rejection; keep old/newprogram/source/package identity. Validate old/future schema rejection and failure-preserved backup via isolated realSQLite tests.
- [x] Run core suite once maxWorkers2, affectedrenderer suite, typecheck/build. Fix actual failures and rerun affected scope only. No repeated P4audition/600sencode/paidcalls.
- [x] Package release-p5/NSIS, verify exact package/native/runtime; one owned acceptance session, screenshots, normal drain. State actual installed/portable verification limits.
- [x] Freeze P5source overlay on explicit P4baseline, hash manifests/logs; dispatch ONE fresh final reviewer on mostcapable model with fullP5diff, spec/plan/evidence; fixes covered by focusedRED→GREEN and appropriate affectedsuite.
- [x] After acceptance preserve all records, switch outer启动MovieAgent.cmd torelease-p5 preservingmodelconfig/projectlauncher arguments, no userapp restart. Open deliverydoc and report feature/verification/limits.

## Preflight/self-review

Tasks share one format and lifecycle; implement sequentially in this session, one final independent review. T2 consumes T1receipts/lock helpers; T3 consumes Task1/2 main actions; T4 consumes allpublicbridges. No interface conflicts found. User's explicit“开始执行”authorizes this narrowed scope; implementation choices above are controller decisions and tracked in ledger. If a signature needs adjustment, record it before downstream use.
