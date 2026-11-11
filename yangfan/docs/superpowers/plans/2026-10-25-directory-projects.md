# Directory Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在本机运行目录式短剧工作台，内置项目模板与用户可填写的全局模型配置。
**Architecture:** 新的无引擎启动器负责目录选择/最近项目；每个项目以独立 profile 打开现有工作台进程。main 导入配置至现有 vault 与版本化模型命令。
**Tech Stack:** 现有锁定 TypeScript/Electron45/React/SQLite/Vitest/Playwright，无新框架。
**Spec:** ../specs/2026-10-25-directory-projects-design.md

## Global Constraints

- 在 D:/movieAgent/libtv-studio 现有独立 codex 分支继续；不修改 D:/rea，不改变旧库，不触碰前批被拒绝清理的目录，保留未跟踪研究/原型。
- 用户明确授权本机配置文件和目录式项目；不读取/输出实际 Key、不发真实 API、不自动付费测试。实际配置在 D:/movieAgent/config/models.json，example 为空值。
- 一短剧一目录与库；manifest/version/初始化绑定按 spec。已有文件不覆盖、不自动搬移；目录选择限 native dialog 或注册的最近项目，不开放任意 filesystem IPC。
- main-only Key 导入；工作台无 Key；API 原有精确网络策略、不可变修订、审批、原件/receipt恢复不放宽。
- 新版默认启动器不打开引擎；显式 --library-root/--legacy-workspace 保留既有路径。项目工作台进程独立，可并存；单项目 profile 锁保持。
- 每任务使用真实临时文件/库和 dummy Key，先定向RED/GREEN，再收口；最后一个冻结源码版本做全套和实际包检查。不要重复宽泛测试。

## Review Focus

1. 已有文件/保留子目录冲突或junction：拒绝越界写入，原文件逐字节保留（Task1）。
2. 初始manifest与DB绑定间断进程：重开不能创建第二个project，也不能把缺失旧库当空项目（Task1/3）。
3. 多窗口、重复项目ID、目录移动：独立outbox/vault/engine归属；重复打开聚焦，复制项目拒绝自动双调度（Task1/3）。
4. 配置有秘密或非法JSON/URL：错误和IPC不回显Key，空白可用、相同不增版本、改动保留旧引用且零HTTP（Task2/3）。
5. 默认启动和旧版显式模式：无自动打开旧库/任务，旧资料可显式访问，真实打包路径/新preload资源齐全（Task3）。

## Task 1: Directory project template and registry

**Files:** Create packages/contracts/src/directory-projects.ts; apps/desktop/src/main/project-directories.ts; apps/desktop/src/main/recent-projects.ts; templates/drama-project/ (spec default documents); tests/integration/directory-projects.test.ts. Modify packaging resource declaration only if templates require copying.

**Interfaces:** `ProjectManifest` spec shape; `DirectoryProject` {root,manifest,libraryRoot}; `createDirectoryProject({mode:'new'|'existing',directory,name}):Promise<Result<DirectoryProject>>`; `inspectDirectoryProject(root):Promise<Result<DirectoryProject>>` read-only; `bindDirectoryProject(root,{workspaceId,libraryId,projectId}):Promise<Result<DirectoryProject>>`; `RecentProjects.open(path)`, `.list()`, `.remember(project)` with atomic writes. Registry contains only display/path/identity; pathCanonical comparison case-insensitive on Windows. Library path fixed `.movieagent/library`.

- [x] RED tests for new Chinese/spaced path, existing files unchanged, manifest unknown version/unsafe name, reserved path junction/file conflict, missing bound DB, repeated init, sameID different-existing-root refusal, moved missing-old-root rebind.
- [x] Implement non-overwriting template, bounded schema validation, immutable ready binding and recent index. Core never opens a business DB or knows secrets; Task3 engine owns project bootstrap.
- [x] GREEN targeted tests/typecheck, record exact evidence in docs/verification/directory-projects.md, self-review/commit. Task1 commit6029fd6, independent review approved.

## Task 2: Local model configuration import

**Files:** Create apps/desktop/src/main/model-config-file.ts; apps/desktop/src/main/model-config-import.ts; configs/models.example.json; tests/integration/model-config-file.test.ts; tests/electron/model-config-import.test.ts. Modify credential-vault only if required narrow idempotence API; contracts desktop to add secret-free config status type.

**Interfaces:** `loadModelConfig(path):Promise<Result<LocalModelConfig>>` main-private type contains secrets; exact spec schema. `importModelConfig({host,vault,config}):Promise<Result<ModelConfigStatus>>`, using existing EngineHost query/execute/updateCredentialStatus, status contains source/provider IDs/state/errorCode, never Key. Fixed file-owned IDs prefix `file-<id>-connection/model/profile`, compare normalized current revisions and vault-owned secret before adding revision. No direct main SQL writes or HTTP probes.

- [x] RED validation (BOM/64KiB/8providers/duplicate/unknown fields/empty/partial/private URL), integration import twice/changed key+URL/retained oldref/manual config preserved, malformed errors and DB/IPC contain no dummy secret, unavailable protection, zero HTTP.
- [x] Implement upfront full validation, controlled vault write/status sync then normal versioned config commands; use stable command identity/retry state where outcome uncertain. Same config reused, removed/empty entries do not revoke old running credentials or delete user config.
- [x] GREEN targeted tests, actual Electron safeStorage/import path fixture, typecheck, evidence/commit. No actual D:/movieAgent config creation until Task3 deliverable to avoid overwriting user edits. Task2 commits19c4126/450fdf6, independent review and scoped fix review approved.

## Task 3: Launcher, workspace integration and runnable local delivery

**Files:** Create apps/desktop/src/main/project-launcher.ts; launcher-ipc.ts; workspace-bootstrap.ts; apps/desktop/src/preload/launcher.ts; apps/desktop/src/launcher/index.html,main.tsx,Launcher.tsx; tests/electron/directory-workspace.test.ts; tests/electron/launcher-security.test.ts; scripts/start-local.cjs (if needed). Modify main/index.ts (bounded route extraction allowed to main/workbench.ts), existing preload/contracts/ipc-policy, renderer/App.tsx/ProjectHome.tsx/ModelSettings.tsx, electron-vite config, verifier and affected existing test helpers. Update docs/development.md and docs/verification/directory-projects.md.

**Interfaces:** `window.projectLauncher` dedicated fixed bridge with listRecent/createNew/fromFolder/openExisting/openRecent/configInfo/openConfig/openLegacy, native picker returns no arbitrary file/network capability; strict same-window/frame/trusted URL checks. Workbench bridge adds directory workspace info/openFolder/openLauncher/reloadModelConfig (all source paths main-owned). `--project-root` validated manifest→global profile directory/workspaceId→fixed library root; `--project-launcher`, `--model-config`, `--legacy-workspace` explicit modes. Default no workspace args enters launcher. Existing --library-root path remains explicit legacy. Project mode bootstraps one DB project under owned engine using manifest workspaceId-based persistent commandId, validates/binds library/project identity before exposing UI. `model-config` import before provider activation, normal bootstrap respects existing live-check fence; no implicit network validation.

- [x] RED actual launcher noengine, native create/open/fromfolder with preserved files, workbench correct project/root, repeat focus, two roots isolated, reopen same project/canvas, init crash replay and missingboundDB refusal. Blank configuration works; imported dummy config shows status without Key; reload idempotent. Explicit legacy fixtures retain behavior. Dedicated launcher forgedframe/unknownchannel rejected.
- [x] Implement graphite launcher/recent cards/new directory flow/config path and status; workbench identifies current short drama and opens known folders. Project-mode home does not create unrelated DB projects; selected root auto-selects bound project. No pretend P2 functions. Shared registry conflict checks apply before spawning; pass args via spawn array, no shell interpolation or Key argv/environment. Handle child startup failure visibly and avoid duplicate windows. Closing launcher leaves workbench alive; final test teardown terminates only owned children.
- [x] Add all new runtime/template/HTML/preload outputs to package verification, update affected legacy tests with explicit mode where intent requires. Freeze code then typecheck, npmtest, build, package:win -- --dir, verify-package and final Electron suite; targeted repairs only for failures. Preserve prior P1 historical evidence, new evidence separate.
- [x] Create config/example and visible D:/movieAgent/启动MovieAgent.cmd only when absent (otherwise preserve); default projects parent D:/movieAgent/projects. Launch the actual final package into a visible project launcher using the explicit config path and fresh launcher state if needed to avoid existing tasks. Verify window visible, zero provider calls, report exact configuration/launch path. No installer/real model completion claim beyond actual checks.
- [x] Commit exact source/test/docs files; final review approved at6bf6ce8; local launcher/config delivered. One nonblocking P3 action-error feedback item is recorded in the final review.
