# P1 图像工作流验证记录

当前交付状态（2026-10-25）：MovieAgent Windows x64 未签名本地测试 beta。Task1–9 的本地实现与 fixture 证据如下；Task10 发布证据在文末。**真实 API 验收未完成，干净 Windows 安装未验证，完整 P1 尚未完成。** 历史记录中的 LibTV Studio 文件名是当时的真实产物，不代表当前发行名称。

## Task 1 · 桌面引擎与可恢复项目（2026-10-25）

实现范围：独立 npm workspace、受限 Electron/React 工作台、utility process 引擎、SQLite 迁移和项目持久化。未连接供应商、未读取凭据、未运行付费图像生成。

| 检查 | 证据 / 结果 | 验证级别 |
| --- | --- | --- |
| TDD RED | `npm test -- tests/integration/project-reopen.test.ts`：exit 1，缺少 `packages/engine/src/bootstrap`；实现前确认 | 开发机 |
| 打包测试 RED | `npm run test:electron`：exit 1，尚无 `LibTV Studio.exe`；不会静默跳过 | 开发机 |
| SQLite 集成 | `npm test -- tests/integration/project-reopen.test.ts`：8/8；实际临时目录、真实 SQLite、跨进程占用与强制结束恢复、重开后 ID/名称保留、关闭后拒绝写入、所有权丢失拒绝、未来 schema 保留、有界关闭与延迟清理所有权 | 开发机；只在关闭回归测试中控制 manifest unlink 延迟，其余文件/数据库操作真实 |
| 类型 | `npm run typecheck`：exit 0 | 开发机 |
| 构建 | `npm run build`：exit 0，main / preload / renderer / utility entry 全部产出 | 开发机 |
| Windows 包 | `npm run package:win -- --dir`：exit 0；`apps/desktop/release/win-unpacked/LibTV Studio.exe` | Windows x64，未签名解包目录 |
| 包内启动/恢复 | `npm run test:electron`：2/2；真实包内 utility 握手、UI 建项目、桥接输入校验、Node 隔离、退出释放 ownership、重开项目一致；实际可执行文件目录含 `#` / `%` 时授权及写入通过 | 开发机打包运行时 |
| 依赖 | `npm audit --registry=https://registry.npmjs.org`：全部依赖 0 已知漏洞；生产依赖单独检查为 0 | npm 官方 advisory 快照 |
| 真实供应商 | 未运行 | 用户要求后置 |
| 干净机器 / 安装器 / 签名 | 未运行；不能由开发机启动推断已通过 | 尚未验证 |

工具链固定：Node 24.12.0、npm 11.6.2、Electron 45.0.0、electron-vite 5.0.0、Vite 7.3.7、React/React DOM 19.3.1、TypeScript 5.9.3、Vitest 4.1.12、Playwright 1.64.1、electron-builder 26.18.0。`package-lock.json` 固定传递依赖及 integrity。

采用内置 `node:sqlite`，不引入第三方 SQLite 原生 ABI 模块。Electron 45.0.0 官方发布清单列出 Node 24.22.0 / ABI 150；启动测试在包内实际执行 SQLite 建库与写入，避免只凭 ABI 推断兼容性。独立 guard SQLite 的排他事务持有 OS 文件锁，崩溃后由 OS 释放；磁盘 manifest 仅记录随机启动身份与诊断 PID。只有拿到 guard 后才允许接管旧 manifest，业务库每次操作另查 instance token。不能用 PID 杀进程或推断归属。默认资料库位于用户数据目录，`--library-root=<绝对本地路径>` 可指定独立资料库。

引擎握手限时 10 秒；请求限时 5 秒；LibraryHandle.close() 在 1 秒内返回清理结果或 LIBRARY_CLOSE_TIMEOUT。超时时停止写入，但待完成的 manifest 清理仍持有原 guard，直到清理完成才释放，避免迟到 unlink 删除新实例的 manifest。完全退出先给引擎 2 秒清理，再通过本次创建的 UtilityProcess 对象终止并最多等待 1.5 秒。SQLite 锁等待为 0，无无限重试。SQLite 在开发 Node 24.12.0 上仍发出官方 experimental warning，版本升级必须重复包内验证。

直接依赖许可证为 MIT / Apache-2.0（Playwright）；Node 与 SQLite 的许可证随 Electron/Chromium 运行时发布。包内确认包含 React、React DOM、scheduler 的 LICENSE，以及 Electron LICENSE 与 Chromium notices。应用自身许可证尚未授予（UNLICENSED），不代表第三方依赖的许可证。

构建器首次在此开发机 PATH 中找不到 `powershell.exe`，其 node-module collector 自动使用 manual traversal，打包和包内测试仍通过。最终打包已把 `C:/Windows/System32/WindowsPowerShell/v1.0` 加入当前命令 PATH，正常完成 npm dependency collection。此项属于构建环境，不是安装后运行依赖。

官方核验依据：[Electron utility process](https://www.electronjs.org/docs/latest/api/utility-process)、[Electron 发布清单](https://releases.electronjs.org/releases.json)、[Node 24.12 SQLite](https://nodejs.org/download/release/v24.12.0/docs/api/sqlite.html)、[electron-vite](https://electron-vite.org/guide/)、[Playwright Electron](https://playwright.dev/docs/api/class-electron)、npm 官方各固定版本元数据与锁文件。

## Task 2 · 命令投递、事件游标与受限 IPC（2026-10-25）

实现范围：`project.create`、`project.list`、`command.receipt` 的命名契约与运行时校验；同事务 project / receipt / event；main 独立持久 outbox；资料库/客户端连接 epoch 隔离；快照和事件游标；统一的 utility IPC 和窄 preload。其他模型、供应商、资产、画布、生成命令由后续 Task 实现，当前返回 UNKNOWN_COMMAND / UNKNOWN_QUERY，不能视为成功能力。

| 检查 | 证据 / 结果 | 验证级别 |
| --- | --- | --- |
| 投递 TDD RED | `npm test -- tests/integration/command-delivery.test.ts`：exit 1，缺少 `command-outbox`；实现前确认 | 开发机 |
| 游标回归 RED → GREEN | 事件表删除 seq=1 后，初始实现错误接受 seq=0 → 2；断言期望 RESYNC_REQUIRED 失败。增加连续性验证后通过 | 真实 SQLite，受控损坏 fixture |
| 客户端 epoch RED → GREEN | 同一仍运行引擎重连，旧实现两个 descriptor epoch 相同，断言失败；每个 LocalConnection 独立 UUID 后通过 | 真实引擎 / main 连接 |
| 集成与 Task 1 回归 | `npm test -- tests/integration/command-delivery.test.ts tests/integration/project-reopen.test.ts`：19/19，2 files passed，exit 0 | 真实临时目录 / SQLite；ACK 丢失和畸形响应在传输边界注入 |
| 类型 | `npm run typecheck`：exit 0 | 开发机 |
| 构建 | `npm run build`：exit 0，main / preload / renderer / utility 全产出 | 开发机 |
| Windows 包 | `$env:PATH = 'C:/Windows/System32/WindowsPowerShell/v1.0;' + $env:PATH` 后 `npm run package:win -- --dir`：exit 0 | Windows x64 未签名解包目录 |
| IPC TDD RED | `npm run test:electron -- tests/electron/ipc-policy.test.ts`：旧包缺少 `studio.execute`，exit 1 | 真实旧包 / renderer |
| IPC 与打包恢复 | `npm run test:electron -- tests/electron/ipc-policy.test.ts tests/electron/packaged-startup.test.ts`：4/4，2 files passed，exit 0 | 真实打包程序 + 独立 Electron frame fixture |
| 真实供应商 / API Key | 未运行、未读取 | 用户明确后置 |
| 安装器 / 签名 / 干净机器 | 未运行 | 不能由解包目录测试推断 |

投递测试覆盖原回执重复返回、同 ID 异参拒绝、ACK 丢失后的引擎/客户端重启恢复、数据库仅一项目/一 receipt/一事件、失败事件 INSERT 的整体事务回滚、A 的迟到 ACK 只清理 A 的日志且返回 STALE_CONNECTION、同一引擎重新连接时 epoch 更新、错误 hash 不清队列、畸形查询/事件结果拒绝、快照回调内提交的事件不丢失、过期/跨流/未来/不连续游标明确要求重新同步。Task 1 的 guard、manifest、数据库 owner token 和有界退出回归继续通过。

生产 preload 仅暴露 describe / execute / query / readEvents 与兼容的 createProject / listProjects，无 fs、process 或完整 ipcRenderer。生产窗口禁用子 frame Node/preload；为单独验证 mainFrame 身份条件，测试使用独立 Electron fixture，只在该 fixture 开启子 frame preload，父 frame 对同一个生产 `installWorkspaceIpc` 可调用，真实同源子 frame 返回 FORBIDDEN。另在真实包中用测试注册的 preload 验证非授权窗口、未知频道、非法 envelope、隔离的全局变量；测试 probe 不进入生产构建。

数据库 schema 升为 2（从 schema 1 保留项目后迁移），协议/envelope 仍为 1。`EngineIdentity.instanceId` 是 utility 启动身份；`InstanceDescriptor.connectionEpoch` 是每个 main LocalConnection 的独立客户端连接身份。main 校验 epoch；utility 协议仍独立验证 launchId / engine instanceId。重启恢复替换 envelope epoch，但命令 hash 不包含 epoch，因此保持原命令身份。Hash 基于解析后的 schemaVersion / libraryId / kind / payload；project 名称按既有 parser trim 后规范化。

`CommandReceipt` 包含 libraryId / commandId / requestHash / committedSeq / result；outbox 的复合主键为 libraryId + commandId，settle 额外匹配 hash。outbox 路径为 userData/client-state/command-outbox.sqlite，与 engine 资料库分开。`EventCursor` 包含 libraryId / streamId / seq；streamId 随库持久保存；初始订阅返回带 snapshotSeq 的快照，随后以 100ms 轮询重放最多 500 条持久事件，每次连续验证。当前不做自动事件压缩；保留窗口字段为后续压缩提供明确失效边界。

限制：目前没有资料库切换 UI；连接失效/重新选择的契约与测试已建立。订阅在连接失效或后续轮询错误时停止，初始非法游标通过错误拒绝，readEvents 始终返回可操作的 Result 错误。未确认命令保留到匹配 receipt，恢复遇到错误会停止并提示，未添加自动丢弃或手工队列管理 UI。这里验证的是本地幂等，不代表未来供应商请求幂等。

## Task 3 · 不可变模型配置与独立凭据入口（2026-10-25）

真实 provider/model/profile 保存与列表查询，schema3 追加 revision/CAS/FK，配置与事件/receipt 同一引擎事务；独立 main vault 使用系统 safeStorage 封套加密，凭据窗口使用单独 preload/CSP 和不落盘 session，普通工作台仅接收引用/状态。可先保存 credentialRef:null 的连接，再录入凭据并追加绑定版本。旧凭据保留，紧急撤销显式持久化与传播。

| 检查 | 证据 / 结果 | 验证级别 |
| --- | --- | --- |
| 配置 TDD RED | 实现前 model-config 4 tests failed（UNKNOWN_COMMAND）；旧包 credential-entry 入口 undefined；vault module 缺失，均 exit1 | 开发机 / 旧包 |
| SQLite / vault / 前序回归 | `npm test -- tests/integration/model-config.test.ts tests/integration/credential-vault.test.ts tests/integration/command-delivery.test.ts tests/integration/project-reopen.test.ts`：4 files / 27 passed，exit0，3.17s | 真实临时目录/SQLite；假密钥；系统不可用 fixture |
| 类型 / 构建 | `npm run typecheck` exit0；`npm run build` exit0，两个独立 HTML/preload 入口、main/utility 产出 | 开发机 |
| Windows 包 | 当前命令 PATH 补已有 PowerShell 目录后 `npm run package:win -- --dir` exit0 | Windows x64 未签名解包目录 |
| 实际凭据边界 / 既有桌面回归 | `npm run test:electron -- tests/electron/credential-entry.test.ts tests/electron/ipc-policy.test.ts tests/electron/packaged-startup.test.ts`：3 files / 6 passed，exit0，19.13s | 真实包 + 独立 Electron fixtures；真实 safeStorage 仅加密/解密假密钥 |
| 实际隔离目录 | 测试断言 `app.getPath('userData')` 等于新建临时 profile；vault/业务库/outbox 检查均限定该临时根；未读取用户实际密钥 | 真实 Electron main |
| 真实 API / 安装器 / 签名 / 干净机器 | 未运行 | 用户后置；不能由接口测试推断 |

验证覆盖：不可变旧 revision 与重开、重复原 receipt、冲突和原子回滚、URL/Header/能力/参数拒绝、跨资料库/连接凭据引用拒绝、运行快照深冻结、模型精确私网授权边界；真实独立输入窗口/其他窗口拒绝/网络和导航拒绝/不持久 session；无系统保护时默认禁止保存并显式勾选仅会话模式；假密钥系统加密、旧版本保留、撤销后不可使用及重开撤销状态。业务快照/receipt、关闭后的业务库/outbox 和 vault 文件均不含测试密钥明文。配置能力均未做供应商实测。

凭据授权状态只通过受信 main→utility 通道登记，普通命令不能登记/读取/使用秘密。vault 与业务库不共事务，失败显式返回；旧版本本批保守保留，后续任务负责按任务生命周期清理与撤销后的对账。实际 DNS/重定向校验和 provider transport 留给 Task6；完整配置 UI 留给 Task8。详情：`.superpowers/sdd/2026-10-25-desktop-image-workflow/task-3-report.md`。

### Task 3 审查修复第 1 轮（2026-10-25）

FIX_BASE `3a8019a5555ce362fcd6dcf0d5dd269733caea5a`；新实现 HEAD **`6eb2261f6795aee7e65f88f6a2868fe5bd1822da`**。修复缺失 vault 重配时版本与资料库历史元数据冲突，以及关闭凭据窗口把进行中的保存/撤销错误返回为 cancelled。实现提交仅 6 个明确文件，验证记录另行提交以精确记录实现 hash。

| 检查 | 实际证据 | 验证级别 |
| --- | --- | --- |
| 版本恢复 RED→GREEN | credential-vault：1 failed / 2 passed，旧实现分配1而预期8；修复后3/3，新vault+重开资料库首次登记8成功，历史ref不变，本地8+旧元数据分配9 | 真实临时 SQLite/vault，假会话凭据 |
| 关闭竞态 RED→GREEN | 实际 Electron 延迟save/registration/revoke及登记失败共5个场景均错误返回cancelled；修复后6个场景通过（含提交前取消对照），重新打开真实库/vault核验最终状态 | 独立 Electron fixture，真实 safeStorage 保护假密钥 |
| 受影响集成 | `npm test -- tests/integration/credential-vault.test.ts tests/integration/model-config.test.ts`：2 files / 9 passed，exit0，1.33s | 开发机 |
| 类型 / 构建 / 打包 | `npm run typecheck`、`npm run build`、命令PATH补已有PowerShell目录后 `npm run package:win -- --dir` 均exit0 | Windows x64 未签名解包目录 |
| Electron回归及包内新vault恢复 | `npm run test:electron -- tests/electron/credential-entry.test.ts tests/electron/ipc-policy.test.ts tests/electron/packaged-startup.test.ts`：3 files / 12 passed，exit0，32.98s；旧library换全新userData/vault，首次新凭据版本2登记成功，原版本1历史ref/config保留 | 真实打包程序 + 独立fixtures；实际userData均断言为新临时目录 |

接口变更：`CredentialVault.open(directory, protection, retainedReferences)` 第三参数现为必填。main 先从受信、已校验的 `EngineHost.credentialStatuses()` 取全部历史ref（含 revoked/unavailable），新版本取其对应 libraryId/connectionId 上限与本地封套上限的最大值再加1。Task6应复用此main vault；现有library不能直接传空列表重开，资料库切换/恢复必须先重新取得该库完整受信元数据。普通renderer契约/通道不变。窗口已接收操作后即使视觉关闭也等待真实Result；只有消费前关闭可返回cancelled。

仍有原有 node:sqlite experimental warning，未声称输出无警告。未做真实API验收、真实凭据读取或付费请求；vault与业务库非跨存储原子事务、进程终止恢复和后续provider能力边界限制保持原报告说明。

## Task 4 · 原件收存、不可变资产版本与私有媒体（2026-10-25）

schema4 增加独立 Blob / AssetVersion / Artifact 身份、通用 collection journal 与容量预留；导入批次/逻辑资产映射单独保存在 import_collection。OS 文件选择仅返回 grantId 等公开句柄，真实路径/指纹通过受信 main→utility 通道登记。通用 asset.importGrantedFiles 只接受 grantId。收存依次完成 journal、分块 staging、有界三格式实际解码与 hash、最终 rename、完整性复核、事务发布版本/事件/receipt，只有事务成功才 ready。相同字节复用 Blob，独立导入仍创建独立资产。

| 检查 | 实际证据 | 验证级别 |
| --- | --- | --- |
| 初始 TDD RED | asset-collection 9 failed（engine.assets 缺失）；真实旧包 media-access 1 failed（selectImportFiles undefined），均 exit1 | 实际临时文件 / SQLite / 旧包 |
| 恢复 / 通用接口 RED→GREEN | 三处 phase 中断后删除源并重开可恢复；额外2个失败测试促成无 import_batch 的通用 journal 与非阻塞启动恢复；发布前损坏原件原先错误返回ready的失败测试，最终复核后拒绝发布 | 真实文件、SQLite；受控中断/损坏 fixture |
| 资产定向最终 | `npm test -- tests/integration/asset-collection.test.ts`：13/13，exit0，2.68s；PNG/JPEG/WebP 原件、同字节复用/逻辑身份独立、重放、真实artifact收藏、容量/像素/写失败、junction越界、预览重建、原件损坏、独立journal、部分staging/只清自己的临时文件、事件失败事务回滚后无源重试 | 真实临时目录 / SQLite / sharp解码 |
| 全集成回归 | 首次 `npm test`：39 passed / 1 failed，Node strip-only子进程拒绝参数属性语法；修复后project+asset 20/20；最终 `npm test`：5 files / 41 passed，exit0，3.92s | 真实 Node24 / SQLite / 文件 |
| 类型 / 构建 / Windows包 | `npm run typecheck`、`npm run build`、命令PATH补已有PowerShell目录后 `npm run package:win -- --dir` exit0 | Windows x64 未签名解包目录，sharp@0.35.5 + @img原生包 |
| Electron 首次完整回归 | 临时credential SSR夹具顶层require(sharp)无法从Temp解析而挂在原生错误框；终止本次精确PID/自有夹具，改为实际媒体处理时加载，不跳过凭据回归；同步窄桥两个新增方法的精确白名单预期 | 与真实包不同的临时夹具解析边界 |
| 凭据 / IPC 修复回归 | `npm run test:electron -- tests/electron/credential-entry.test.ts tests/electron/ipc-policy.test.ts`：2 files / 10 passed，exit0，26.11s | 真实包 + 独立Electron fixtures；仅假密钥 |
| 最终媒体 / 包内恢复 | 最终lazy-load修改后typecheck/build/package再次exit0；`npm run test:electron -- tests/electron/media-access.test.ts tests/electron/packaged-startup.test.ts`：2 files / 3 passed，exit0，10.11s；与前组累计4 files / 13个Electron测试全部通过，未重复已通过组 | 真实最终包 |
| 真实API / 实际密钥 / 安装器 / 签名 / 干净机器 / 断电 | 未运行 | 用户明确后置或本Task范围外 |

私有协议在每个工作台独立非持久session中登记；两分钟随机URL只绑定当前库固定媒体版本及original/thumbnail。实际包检查涵盖Range 0–7与suffix、416、原件完整字节、源删除后读、重放、跨库/伪造ref/非法variant拒绝、其他窗口IPC和默认session无法访问。缩略图最大320×320，可独立重建；原件读取始终重新校验SHA-256。

共享边界：collectionJournalFor.create/get/update/reserve/release 与 ObjectStore.collect/read/verify 为引擎内部API；collectionId必须先持久登记且sourceRef不可重绑。Task5/6可复用收存原语，在自身最终事务发布真实artifact，不需伪装为文件导入。asset.saveArtifact仅从既有真实artifact创建不可变版本，没有生成占位成功。已接受batch按命令hash恢复，先查receipt/collection再查grant，因此grant消费/到期不破坏原命令幂等。

默认32MiB原件、4000万解码像素、15秒解码上限、64MiB磁盘安全预留。main→utility媒体读取当前有界整块传输，可能存在多个buffer副本；Range在主进程对已校验完整字节裁切，尚非磁盘流式/分块IPC。未做自动物理GC、网络下载或生成任务/UI。既有SQLite experimental warning仍保留。详见 `.superpowers/sdd/2026-10-25-desktop-image-workflow/task-4-report.md`。

### Task 4 审查修复第 1 轮：已接受导入的命令身份

FIX_BASE `1fdc1b36f9072321eddb083522cb960893020640`。修复非导入命令在receipt产生前占用已接受导入commandId的问题。router的统一identity读取同时校验command_receipt与import_batch的hash；所有命令在dispatch前与最终BEGIN IMMEDIATE事务内复核。导入排队到真正持久接受前再执行同一guard，guard与短接受事务之间无await，防止另一同步命令先提交后留下冲突batch。长I/O仍在事务外。

| 检查 | 实际证据 | 验证级别 |
| --- | --- | --- |
| RED | `npm test -- tests/integration/asset-collection.test.ts tests/integration/command-delivery.test.ts`：3 failed / 24 passed，exit1，3.00s。中断与进行中的导入都错误允许project.create复用ID；排队竞争留下1个冲突batch，预期0 | 真实临时文件 / SQLite；受控收存中断/暂停 |
| GREEN | 同命令：2 files / 27 passed，exit0，2.75s。碰撞拒绝后原导入仍可在删除外部源后发布并返回原receipt；进行中导入正常完成；排队失败不留batch | 真实引擎 / SQLite / 图像文件 |
| 类型 / diff | `npm run typecheck` 与 `git diff --check` exit0 | 开发机；既有SQLite实验性警告仍在 |
| Electron / 全套 / 打包 | 本轮未重跑；变更仅router身份边界、导入排队guard和定向回归，无桌面协议变更 | 不将前轮包证据冒充本轮重跑 |

Task5新增长期命令的持久接受记录时，应纳入同一identity读取或合并通用身份表，复用异步接受前与最终事务内两个guard时机。退出期限协调按审查要求留Task9；真实API/密钥/付费调用均未执行。

## Task 5 — approved persistent generation lifecycle (2026-10-25)

- Schema5 preparation/approval/task/attempt/scheduler/lease/fact and accepted async-command records; named generation/task commands and task queries/events; atomic domain/event/receipt and project/currency integer-micro-unit reservations. Unknown estimate/actual remain null and require explicit finite risk approval. Queue cancellation alone releases known unspent reservation; uncertain/rejected/completed without settlement evidence retain pending verification occupancy, not asserted actual charges/refunds.
- Dispatch intent/clientRequestId/outputStagingId and retries=0 persist before one provider submit. Existing intent/job recovers only by reconcile; unsupported reconcile explicitly stops for action. Fenced late facts cannot mutate current state but current worker can consume them; collection failure/restart never causes a new POST. Real durable Task4 objects publish actual artifacts separately from saving assets.
- Trusted injected adapter/context/materialize boundary only; production adapter/credential transport/probe wiring stays Task6. Completed private output descriptor is durable before URL collection. Task6 inline output must spool against the durable outputStagingId or explicitly retain completed/unrecoverable loss. URLs/paths/descriptors stay out of TaskView/events/receipts/logs. Scheduler start/wake/recover/run/close are available; engine.close drains it.
- TDD: initial focused lifecycle RED **11 failed** (generation commands missing), then GREEN11. Follow-up RED/GREEN caught duplicate concurrent replay GETs, missing remote-output persistence, connection oversubscription, missing outcome validation/staging ID, stale completed facts not being collected, and cancellation overwritten during a held HTTP download. Fixture counts actual HTTP POST/GET/download requests; disconnect/restart and collect retries preserve POST=1, pre-send-intent recovery preserves POST=0.
- Final `npm test`: **6 files / 72 passed**, exit0 (generation file28 cases); `npm run typecheck` and `npm run build`: exit0. The first broad run had only old schema4 and formerly-unimplemented generation-command expectations; both updated. SQLite ExperimentalWarning remains in output.
- Windows package/schema5 Electron evidence recorded below after final run. No real API, paid call, readable real credential/key discovery, canvas/UI integration, full billing settlement or power-cut evidence. Tests use only disposable local fixtures/profiles. No REA/research/prototype edits or broad staging.
- Final Windows evidence: `npm run package:win -- --dir` exit0 (final source after cancellation fix). `npm run test:electron -- tests/electron/packaged-startup.test.ts tests/electron/ipc-policy.test.ts`: **2 files / 4 passed**, exit0, 12.93s; real packaged utility schema5/startup/reopen and IPC/preload policy checks. Other Electron files were not rerun because Task5 did not change their media/credential implementations; prior Task4 evidence remains distinct.

### Task 5 review fix round 1 — recovery shutdown and automatic task failures

FIX_BASE `62354d028d591f7859640b169f476c38b926bc1a`. Recovery/start/public recover now use tracked attempt work plus tracked recovery/wake lifecycle promises; close prevents further work and awaits already-started reconciliation/collection before SQLite closes. Real held-reconcile fixtures verify durable completed artifact after close and no later recovery GET/new POST. This is draining correctness, not Task9's deferred timeout policy.

Automatic capacity/concurrency/lease backoff now persists a visible error and keeps pending reservation. Invalid/expired input/config approval or exhausted scheduler deadline **without any dispatch intent** becomes FAILED/actionable, releases known unspent reservation, and requires a new prepare+approval; replay cannot revive it. Submitted/unknown intent deadline becomes RECONCILE_REQUIRED with SCHEDULER_DEADLINE_EXCEEDED and retains pending reservation/null actual cost; it never becomes a new paid submit. Task state/error and task.changed event commit atomically; terminal jobs stop polling and identical repeated failures do not add duplicate state events.

TDD: focused generation RED **9 failed /28 passed** (early close; missing expiry/config/input/deadline/capacity/concurrency state reasons). After lifecycle fix, held start/recover regression **2 passed /35 skipped**. Final `npm test -- tests/integration/generation-recovery.test.ts`: **37/37 passed**, exit0, 7.08s; `npm run typecheck` and `git diff --check`: exit0. Existing SQLite ExperimentalWarning remains. Per fix scope no broader integration/build/package/Electron rerun; prior evidence is historical. No actual API/key/paid call, unrelated change, agent/worktree or Task9 deadline policy.

## Task6 · configurable image protocol · 2026-10-25

Implemented `openai-image-v1` synchronous text-to-image subset, fixed trusted main credential-use RPC, actual DNS/address pinning, separate public output downloader, durable bounded spool, production utility adapter registration and scheduler activation after vault readiness. Official protocol scope and limits: [OpenAI Images](../providers/openai-images.md).

- **Fixture RED:** `npm test -- tests/integration/image-provider-contract.test.ts` initially failed because the required adapter module was absent. Added behavioral RED cases later: durable spool recovery returned unsupported; interruption before rename and redirected spool directory each failed; a real-context authorized private endpoint was incorrectly classified fixture; fixture output recovered after a production-mode restart was incorrectly promoted to real verified. Each was repaired and rerun GREEN. Harness-only missing fixture methods and wrong SQL column were corrected separately and are not counted as product RED.
- **Packaged RED:** `npm run test:electron -- tests/electron/image-provider.test.ts` failed at `generation.prepare` against the prior package without a production adapter. Final packaged generation uses the actual renderer bridge, utility, existing vault with dummy protected key, local HTTP and real decoded artifact collection; one POST and durable intent are asserted.
- **Broad integration:** `npm test -- tests/integration/image-provider-contract.test.ts tests/integration/generation-recovery.test.ts tests/integration/model-config.test.ts tests/integration/credential-vault.test.ts tests/integration/asset-collection.test.ts tests/integration/project-reopen.test.ts tests/integration/command-delivery.test.ts` — exit0, **7 files / 122 passed**, 8.70s. Temporary SQLite/filesystem/HTTP fixtures only.
- **Final affected rerun after durable evidence-source correction:** `npm test -- tests/integration/image-provider-contract.test.ts tests/integration/generation-recovery.test.ts` — exit0, **2 files / 78 passed**, 8.46s (41 protocol + 37 lifecycle). Fixture identity survives restart in a real context; existing intent and paid collection never produce another POST. Private URLs/spool paths are absent from public TaskView/event/receipt data.
- **Final source validation:** `npm run typecheck` and `npm run build` — exit0. Main46 modules, separate preloads and renderer outputs built. `npm run package:win -- --dir` — exit0, Windows x64 unpacked Electron45 rebuilt from final production source. Command-local PATH included `D:/nodejs` and `C:/Windows/System32/WindowsPowerShell/v1.0`.
- **Final packaged boundaries:** `npm run test:electron -- tests/electron/image-provider.test.ts tests/electron/credential-entry.test.ts tests/electron/ipc-policy.test.ts tests/electron/packaged-startup.test.ts` — exit0, **4 files / 13 passed**, 38.64s. Test userData/library roots are newly created temp directories; no real user vault is opened. Packaged provider test uses trusted `--provider-evidence=fixture`, and verifies the fixture did not mark real generation verified.
- **Warnings:** existing experimental `node:sqlite` warning, Git LF→CRLF notices and existing unsigned unpacked-builder notices remain; these are not described as warning-free results.

Schema6 adds the engine-owned provider verification table; Task7 canvas uses 0007. Task8 consumes the new `provider.list.verification` array, keeping configuration, authentication, actual generation and fixture evidence separate. The original evidence source is frozen in dispatch intent before send and reused for collection after restart. Real self-hosted private endpoints are not automatically classified fixtures; source is a trusted execution property. Ordinary output URLs still cannot use a model's private endpoint grant. Such endpoints must return inline data for this protocol subset.

**Not run:** real provider API, real keys, paid calls, live public output CDN download, installer signing or clean-machine acceptance. Test coverage of a temporary real-labeled context checks classification semantics only, not real API acceptance. No remote reconciliation or free authoritative auth probe is claimed; no `/models` request is made. Spools remain conservatively retained and URL refresh is unsupported. Task9 owns the broader shutdown/backup/GC lifecycle; Task10 retains explicit real-API acceptance.

### Task6 review repair round1 · interrupted URL spool · 2026-10-25

FIX_BASE `98fef43dc635258beeafefe83209b74eaaae55a0`. Repaired an interrupted canonical `.partial` that previously made every collection retry fail with EEXIST. Before writing a new candidate, the spool now checks that no final file exists, validates the owned directory and both candidate paths, and removes only that staging ID's incomplete regular partial/invalid manifest. A valid manifest remains in place and requires identical content hash; a final file is never replaced. Per-identity promise chaining serializes concurrent repair attempts.

- **RED:** `npm test -- tests/integration/image-provider-contract.test.ts` — exit1, **3 failed /42 passed**, 5.88s. The completed provider task stayed COLLECTING/retryable_failure after successful second download; partials with truncated or valid manifest could not be repaired. The valid-manifest different-content control and final/link safety controls passed before the fix.
- **Additional RED:** same command with `-t 'serializes concurrent repair'` — exit1, **1 failed /45 skipped**, 1.62s; concurrent retries did not produce successful matching receipts.
- **GREEN:** `npm test -- tests/integration/image-provider-contract.test.ts` — exit0, **46/46 passed**, 5.24s. The lifecycle regression uses real local HTTP and temporary SQLite: first output download fails, an incomplete partial is placed at the persisted staging identity, then `task.retryCollection` succeeds with providerState still completed, collectionState durable, one generation POST total and two downloads. The fixture-only injected downloader permits its local server; production output network policy was unchanged. Existing valid-manifest partial recovery, no-rebinding and owned-directory tests pass, plus new final-without-manifest, redirected partial and concurrent repair controls.
- `npm run typecheck` — exit0. Existing node:sqlite experimental warning remains. No engine/scheduler/schema/transport/IPC implementation changed; no package/Electron or broad generation rerun was necessary for this storage-only correction. No real API/key/paid call, new agents/worktree or unrelated staging.

## Task 7 — persistent canvas and result ownership — 2026-10-25

BASE `4c6e52499752f3ded07224642d0dd9bf94779420`. Schema7 (`0007-canvas.ts`) creates one default canvas per project (`canvasId = projectId`), including an actual schema6 project backfill. Text, fixed-media image and text-to-image generation nodes persist structured content, positions, tombstones, immutable text revisions, command inverse records, run bindings and output history. Canvas commands/events/queries/receipts use the existing shared connection and identity guards.

- Initial RED: `D:/nodejs/node.exe node_modules/vitest/vitest.mjs run tests/integration/canvas-result-binding.test.ts` — exit1, **8 failed**; missing `canvas.read` prevented required operations. First GREEN: same command — exit0, **8 passed**, 3.45s.
- Additional RED/GREEN covered missing attachment reasons/freshness, missing desktop event advertisement, ambiguous repeated writes to the same field, the dedicated canvas entry point accepting an unrelated project command, and revision-only conflicts omitting the current content. Each was observed failing before repair. The final conflict RED reported `expected=1; current=2` without the current prompt; conflicts now include the proposed/current values and revisions in the standard `fieldErrors` string.
- Final broad integration: `D:/nodejs/node.exe D:/nodejs/node_modules/npm/bin/npm-cli.js test` — exit0, **8 files / 143 passed**, 11.63s (canvas16). Covers ABA, two identical generations with distinct approved bindings, manual old-output selection, new incarnation after delete/undo, independent layout/content ownership, partial undo, fixed historical text input, fixed asset-version placement, restart/receipt replay, schema6 migration, queued-input invalidation and atomic artifact/canvas/provider-verification publication rollback.
- Final affected rerun after named-handler cleanup: `D:/nodejs/node.exe node_modules/vitest/vitest.mjs run tests/integration/canvas-result-binding.test.ts tests/integration/command-delivery.test.ts` — exit0, **2 files / 29 passed**, 7.15s. `npm run typecheck` via the same bundled Node/npm — exit0. `git diff --check` — exit0.
- The first broad run had one stale expectation that `canvas.applyCommand` was unknown; the unimplemented sentinel is now `workflow.execute`. Another expanded test incorrectly expected manual `scheduler.run` to persist an automatic failure: it now uses `scheduler.start` for that existing scheduler behavior, preserving Task5 semantics. The initial constant PNG was replaced with a real sharp-generated fixture because full decoding correctly rejected it. These harness corrections are separate from product RED evidence.

All media and provider evidence here use temporary SQLite/filesystem libraries and localhost HTTP through the production image adapter with trusted `fixture` evidence; **no real provider API, real key/environment discovery, or paid call**. The original dispatch evidence and `outputCollected` verification callback remain in the short final publication transaction. A verification-update failure rolls back the artifact, history and automatic selection together; retry performs no additional POST. Adapter configuration/response evidence can exist before publication and is not incorrectly asserted absent.

Task8 uses `canvas.read` nodes' derived `freshness` (`none/current/stale/unknown`, null for text/image), `activeTask {taskId,state}`, `selectedOutput`, `activeRunBindingId` and independent revisions; history includes semantic revision and `selection/reason`. UI must refresh the snapshot on `canvas.changed` and `task.changed`, preserving event cursor/library/connection scoping. No renderer-supplied verified input or graph execution is exposed. Detailed real command payloads and limitations: `.superpowers/sdd/2026-10-25-desktop-image-workflow/task-7-report.md`.

No full UI, Agent, video, executable dependency graph, package/Electron/build, installer or clean-machine verification was performed in this task. Existing SQLite ExperimentalWarning and Git LF→CRLF notices remain. Schema7 identity fixtures were updated for later packaged tests; this is not new packaged evidence. Untracked design research/prototypes were preserved.

## Task 8 — MovieAgent real desktop workbench (2026-10-25)

Implemented the graphite workbench from the existing own design tokens: real project list/create/open, immutable connection/model/generation-preset forms, exact private endpoint grant, independent credential window/status, asset import/search/fixed preview/insertion, React Flow text/image/generation editing with separate content/layout/selection revisions, explicit generation preparation/finite risk approval, task details/cancel/reconcile/collection retry, explicit asset saving and manual output history. Current ordinary UI uses MovieAgent; executable/window/appId naming remains LibTV Studio for Task10. Unsupported Agent/video/timeline/export/remote entries are disabled and marked planned.

Business access remains WorkspaceConnection plus existing selectImportFiles/mediaUrl/openCredentialEditor. TanStack Query is library/epoch partitioned; Zustand stores short-lived drafts by library/epoch/canvas/node incarnation and retained CAS baseline. Unknown ACK keeps its original command identity/payload and blocks replacement operations until original-receipt recovery; null receipt does not unlock. Actual engine query failures disable new submissions. Conflicts show actionable expected/current values and require explicit refresh/reapply. Media capabilities renew before expiry, with a single immediate image-error retry and visible repeated failure.

Necessary integration repairs: added the named isCanvasSnapshot validator to engine-host's whitelist (real packaged canvas.read exposed the Task7 omission). Added same-library nullable AssetView.sourceArtifactRef from existing asset_version.artifact_id so task asset-saved status survives reopen and checks all asset versions; imported images are null. No DB migration/schema change (schema7), no generic boundary widening. Direct dependencies pinned after registry peer checks: @xyflow/react12.12.0, @tanstack/react-query5.104.5, zustand5.0.16 against existing React19.3.1.

Evidence (Node24.12 command PATH, temporary isolated libraries/userData, dummy credentials, local HTTP fixture and trusted --provider-evidence=fixture only):

- RED before UI: image-workflow Electron E2E failed at missing 模型设置; later real packaged canvas failed INVALID_ENGINE_RESPONSE until the named host validator was added. Draft tests failed for absent field-specific ACK and for late ACK erasing later text; provenance test expected imported source null and received undefined. Final targeted fixes pass.
- `npm test`: **10 files /147 passed**, exit0, 11.92s. `npm run typecheck`: exit0. `npm run build` and `npm run package:win -- --dir`: exit0, final Windows x64 unsigned unpacked Electron45 app.
- Real UI E2E verifies configuration -> dedicated dummy-key editor -> saved prompt -> preparation/approval -> exactly one provider POST -> real durable artifact -> explicit asset -> fixed canvas -> quit/reopen, actual SQLite and original PNG bytes. A deliberately dropped ACK after real approval commit blocks reapproval, resolves the original receipt and never adds another POST. Reopened task still shows asset membership.
- Editor E2E proves polling/other-field updates retain input, real CAS conflict retains draft, explicit refresh/reapply, actual drag persistence and undo/redo, unrelated noise image import/filtering/provenance, timed media cap renewal, and simulated transport failure disabling submits while local text remains editable. Held actual query tests loading; native dialogs test Tab containment, Escape/focus return and dirty-form continuation. A fixture downgrade remains explicitly separate from real verification.
- Initial full `npm run test:electron`: **11 passed /5 failed**, 237.23s. Existing credential close-after-reopen, startup close-after-reopen and IPC reload tests acted on preload availability before DOM readiness; DEBUG isolated the credential stall at app.close before domcontentloaded. Their fixture leaks caused special-path rename and following cleanup locks. No timeout was increased or isolation assertion removed. Tests now await actual DOM readiness/reload event for ordinary actions. Precise repaired runs: credential case **1/1**, 9.50s; startup ordinary+IPC **3/3** (special rename still locked by a preceding diagnostic process); after stopping only the exact owned fixture process tree, special-path case **1/1**, 3.11s.
- Final `npm run test:electron -- tests/electron/image-workflow.test.ts tests/electron/ipc-policy.test.ts`: **2 files /4 passed**, exit0, 33.33s; final typecheck exit0. All initially failed cases have focused passing evidence. This is not described as a single all-green full-Electron run. Early-load immediate-close/reload is still a separate unverified Task9 lifecycle boundary.

Actual screenshot evidence under [task-8](task-8/): paired 1440x900/1100x720 for home-empty, models, models-fixture, connection-dialog, model-dialog, preset-dialog, canvas-before-add, canvas-empty-generation, canvas, approval, tasks, task-detail, assets-loading, assets-empty, assets, asset-preview. Additional credential-entry.png, assets-random-1100.png, canvas-conflict-1100.png, canvas-offline-1100.png and canvas-1100-reduced.png. These are actual packaged screens with no fixed poster dependency. Manually opened and inspected home, settings/forms, empty/loading/solid/noise assets, canvas/inspector, approval, task details, conflict/offline and preview. Minimum-size modal action rows were corrected after inspection to remain reachable.

Motion is actual CSS/UI state: navigation indicator180ms, page entry220ms, dialog180ms, node selection140ms, loaded-result220ms and one-shot restrained ambient outline700ms. E2E confirms nav0.18s normally and0s with prefers-reduced-motion; all animation/transition disabled in reduced mode. Static screenshots alone do not prove motion. [display-evidence.json](task-8/display-evidence.json) records Electron screen scaleFactor1.5 and Playwright renderer DPR≈1.0; both capture viewports were tested, other DPI/platform settings remain unverified. No500-node, real-provider, billing, installer-signing or clean-machine claim.

Self-review checked command gate/draft retention, strict DTO/host projection, actual provider evidence separation, bounded media renewal, narrow credential/media access and disabled unsupported actions. Task9 owns reconnect and loading-time shutdown; Task10 owns package identity/signing/installation. Detailed local coordination report: `.superpowers/sdd/2026-10-25-desktop-image-workflow/task-8-report.md`, including Shared interfaces. Research/prototypes and D:/rea remain untouched; no new agent/worktree. Existing SQLite experimental and unsigned-builder notices remain.

### Task 8 review fix round 1 — I1 keyboard canvas selection

Base `766e4184a479c8363d238d99af79ca5c7b9e9503`. CanvasWorkspace now handles React Flow select/deselect NodeChanges through the same scoped Zustand selection used by the controlled nodes and inspector; the pointer-only callback is removed. Deselect clears only the matching current node, so a batch cannot clear a newly selected different node. Draft contents, field ACKs and CAS baselines are unchanged.

- RED: `npm run test:electron -- tests/electron/canvas-keyboard.test.ts` against the original package: **1 failed**, 6.14s test time (7.74s run). After actual quit/reopen, Tab + Enter on an existing node left the text editor count at **0, expected 1**. An earlier test-authoring run stopped at an exact save-status text match; that locator was corrected to account for the existing revision suffix before recording the product RED.
- `npm run typecheck`, `npm run build`, `npm run package:win -- --dir`: completed successfully; rebuilt Windows x64 unpacked Electron app. Existing package-manager fallback, duplicate-dependency and unsigned-resource notices remain.
- GREEN: `npm run test:electron -- tests/electron/canvas-keyboard.test.ts tests/electron/image-workflow.test.ts -t 'keyboard|keeps canvas drafts'`: **2 files / 2 passed / 1 unrelated test skipped**, exit0, 17.91s. New isolated packaged test uses actual Tab navigation and Enter/Space/Escape after reopening, edits and saves through keyboard, retains the dirty draft across deselection and confirms saved text after a second process restart. Existing editor test retains refresh/conflict/layout/undo/import/offline coverage. No provider calls or credentials are needed by these selected tests.
- `npm test -- tests/integration/ui-canvas-draft.test.ts`: **3 passed**, exit0, 874ms. No full suite repeat. SQLite experimental notice remains in the packaged editor run.

Self-review: verified event ordering reads current selection rather than a stale render closure; ignored deselection of another node cannot remove current selection. The only production change is selection routing; drafts and command identity behavior are unchanged. Incidental existing screenshots regenerated by the editor regression were restored, preserving the previously inspected visual evidence. M1 empty/loading presentation and M2 inherited notices are explicitly deferred by the controller for final triage; lifecycle/reconnect limitations remain as above.

## Task 9 — lifecycle, reconnect and migration safety

Base `9d5de6b06c793d6eee309777976ae0c0859e35a8`, same checkout/branch. Tests use Node24.12 with command-local `PATH=D:/nodejs;C:/Windows/System32/WindowsPowerShell/v1.0;...`, fresh temporary profiles/libraries and fixture HTTP only. No real API, real key discovery, paid request, D:/rea change, subagent or new worktree.

Implemented a coalesced `quiesceEngine(reason, absoluteDeadline)` and truthful ShutdownReport: stoppedClaiming, persisted, resourcesExited, cleanupPending, interrupted and optional original errorCode. Main/host share a20s deadline including a1.5s final owned-process exit reserve, exceeding the existing15s image decode bound. Already started scheduler recovery/commands/collection/maintenance remain drained or explicitly interrupted; guard ownership never expires with the caller's timer. Final cleanup failure retains the guard until actual process death. Main writes a secret-free profile/shutdown-report.json. Window close offers tray/full quit/return for active or uncertain tasks, optional preference, and explicitly says cloud jobs may continue and cancellation is separate.

Reload/resume use the existing LocalConnection, RuntimeProvider, scoped queries/drafts and durable outbox. Epoch rotates independently of engine instance; media caps invalidate; vault/status synchronization still precedes provider activation after utility restart. A utility crash during pending resume now waits that reconnect before restarting rather than losing the request. Definitive outbox rejections are transactionally preserved in rejected_command with original envelope/hash/error and stop starving later recovery; uncertain writes remain pending. Late old ACKs settle original outbox before stale-view rejection. A disconnected old event batch stops before the next callback.

Migrations now VACUUM INTO a consistent WAL-inclusive DB backup, migrate/validate a separate candidate, checkpoint/close original, and install only the valid candidate with Windows atomic rename. Failure keeps original/backup/candidate plus bounded diagnostic JSON, without private provider data. Maintenance serializes a schema-bound DB snapshot and reference manifest with task/collection/shutdown work. Current schema stays7. Full backup/restore/remote UI, backup-object copying/hash-verification, retention/GC, installer/updater acceptance and arbitrary schema downgrade remain later-phase work; old app restoration requires a matching DB backup.

RED/GREEN evidence (all commands run from repository root):

- `npm test -- tests/integration/engine-lifecycle.test.ts tests/integration/command-delivery.test.ts`: initial **3 failed/13 passed**, exit1,4.27s. Missing quiesce, COMMAND_ID_REUSED recovery starvation, failed migration changed original schema1→6. A test-authoring inspection-DB cleanup error was separately corrected; it is not product fault evidence.
- Real Node child fixtures pause after production dispatch intent/before HTTP send, after real loopback HTTP response/before recording, and after ObjectStore durable journal/original rename/before artifact publication. Parent kills only its spawned child, reopens same DB in a new child, observes **POST0/1/1 unchanged**, and recovers original SHA256/bytes. These are fixture-adapter process boundaries, not real provider verification. The new collection-crash file's3 cases passed.
- Cleanup-failure child RED: subsequent open returned LIBRARY_OPEN_FAILED rather than LIBRARY_IN_USE, proving guard released too early. Fix retains it until real child exit, then recovery preserves the project. Held collection + expired shutdown deadline checks report pending/interrupted and exclusive ownership until actual drain. Maintenance checks admission, shutdown coordination and consistent artifact manifest. A real child killed on fs.watch candidate creation recovers intact original schema1 or fully installed7 and consistent schema1 backup, with unchanged libraryId; this is not instruction-level rename or power-cut proof.
- Packaged reload RED `npm run test:electron -- tests/electron/workspace-reconnect.test.ts -t 'rotates only'`: **1 failed/2 skipped**,3.55s; epoch stayed unchanged. Rebuilt-package GREEN **1 passed/2 skipped**,4.13s: outbox replay exactly once, same instance/new epoch, old requests rejected, suspend/resume handshake.
- Early-load evidence was tightened: initial exploratory tests awaited renderer JS and were withdrawn as immediate-close/reload proof. With same-main-turn action at `isLoading=true`, actual close passed while actual reload entered a blocking startup error dialog. Driver firstWindow30s + cleanup30s failure was separated from a native load wait. A temporary test-only dialog interceptor confirmed `TASK9_EARLY_DIAGNOSTIC 启动失败`; it was removed. Product fix accepts only ERR_ABORTED for the same window's known replacement navigation to its exact trusted URL. Other load failures remain visible and close the engine. Corrected native did-stop-loading GREEN: actual early reload **1 passed/3 skipped**,4.61s. Final tests also assert native quit, actual owned main/engine exits, released OS guard, engine_owner0 and truthful shutdown report, with no renderer/preload/DOM readiness before the action.
- Old-library batch RED `npm test -- tests/integration/command-delivery.test.ts -t 'stops a queued'`: **1 failed/14 skipped**,2.89s; second old event delivered after callback disconnected. GREEN **1 passed/14 skipped**,2.67s.
- Resume+utility-death RED against earlier production build: **1 failed/1 passed/3 skipped**,36.21s; instance remained stale through15s. Final group passes after waiting in-progress reconnect before restart. This harness retains the exact owned utilityProcess object then imports actual built production main/engine; it adds no product hook.
- Actual Electron utility-process harness exercises production host:11s late handshake against10s budget, duplicate-start exclusion,3s graceful drain,300ms hung cleanup with honest forced report, recovered durable project, unexpected-exit callback, and real BrowserWindow/tray choices with only native user-response injection. A self-review extension found exhausted-deadline report stayed resourcesExited=false even after the child actually exited (**1 failed/4 skipped**,20.75s). Repeated quiesce now refreshes only that exact child's observed exit, retaining interrupted/cleanupPending without restarting a deadline or releasing another owner.

Final regression:

- `npm test` once: **12 files,156 passed/1 failed**,20.98s. Only failure: project-reopen expected LIBRARY_CLOSE_TIMEOUT but the wrapper returned generic ENGINE_CLEANUP_PENDING. ShutdownReport now preserves the original storage errorCode.
- Post-fix `npm test -- tests/integration/project-reopen.test.ts tests/integration/engine-lifecycle.test.ts tests/integration/generation-recovery.test.ts tests/integration/canvas-result-binding.test.ts`: **4 files,66/66 passed**,18.03s,exit0. Includes the sole broad failure and affected Task5/7 recovery/binding tests. No repeated full integration suite.
- `npm run test:electron -- tests/electron/workspace-reconnect.test.ts tests/electron/image-workflow.test.ts tests/electron/packaged-startup.test.ts tests/electron/ipc-policy.test.ts`: **4 files,11/11 passed**,77.59s,exit0. Includes five new lifecycle tests, fixture image/canvas/asset workflow, packaged reopen/special path and IPC boundaries. Incidental Task8 screenshot changes were restored.
- `npm run typecheck`, `npm run build`, `npm run package:win -- --dir`:exit0. Final small report/late-exit repairs are followed by rebuilt-package lifecycle-only verification recorded below. No claim of signed installer, clean-machine install, physical sleep/power-cut, all DPI/platforms or actual provider/billing.

Self-review checked ownership after timers/failures, first deadline coalescing, receipt-before-stale ordering, persisted intent recovery without re-submit, original output/provenance, vault ordering, migration original/backup safety, snapshot coordination and exact navigation abort condition. No new privileged renderer API or security relaxation. Only two failed diagnostic profiles' confirmed owned processes were stopped (`libtv-reconnect-LEUYqQ`, `libtv-reconnect-xaFewA`); their directories were not force-deleted. Earlier blocked Task8 roots were never touched. Existing SQLite experimental, builder unsigned/dedupe and Git line-ending notices remain; no pristine-output claim. Full report and Task10 Shared interfaces: `.superpowers/sdd/2026-10-25-desktop-image-workflow/task-9-report.md`.

Final closure: same host harness RED **1 failed/4 skipped**,19.97s, caught stoppedClaiming=true despite unknown ACK and unconfirmed child exit. All fallback fields were checked together: no ACK means persisted=false and cleanupPending/interrupted=true; stoppedClaiming/resourcesExited become true only from that exact child's observed exit. A repeated observation can confirm late exit but cannot upgrade persistence or erase pending cleanup. Final `npm run typecheck`, `npm run build`, `npm run package:win -- --dir` all exit0; the resulting unpacked package **includes the final errorCode compatibility and late-exit/fallback fixes**. Final `npm run test:electron -- tests/electron/workspace-reconnect.test.ts`: **1 file,5/5 passed**,30.24s,exit0. No further production change after this run. Exactly27 task files staged; cached whitespace check passes.

Task10 automation handoff: BrowserWindow.close with active/uncertain tasks intentionally offers tray/full quit/return; it is not an exit assertion. ElectronApplication.close requests app quit and bounded cleanup, and ordinary driver tests should wait real DOM readiness. Early reload may replace the DevTools Page before firstWindow attaches; dedicated loading tests observe native did-stop-loading and native app.quit, preserving the actual process handle before closing. Installer acceptance must separately verify explicit full quit/actual owned engine exit and intentional tray continuation. No final installer/signing/clean-machine acceptance was performed here.

## Task 9 review repair round 1 (base 73525f9)

I1: LocalConnection recovery now quarantines FILE_GRANT_NOT_FOUND, FILE_GRANT_EXPIRED and FILE_GRANT_CONSUMED only for asset.importGrantedFiles. Production command routing checks the committed receipt and accepted import_batch identity before grant validation, so these failures prove pre-admission rejection. The existing rejected_command transaction retains envelope/hash/error, then later commands recover. Accepted uncertain collections and unknown deliveries remain pending; a restarted accepted batch and its original committed receipt both recover without a memory grant.

I2: Main now invalidates both published and provisional LocalConnection objects with a lifecycle generation on suspend/reconnect/quit. A wake arriving during recovery invalidates that replay; after its late ACK settles the original outbox, the same worker performs fresh reconciliation before publishing another epoch. Work paused by suspend cannot publish; pending utility-restart intent survives until resume. Existing RuntimeProvider, command gate, transport and vault activation ordering remain unchanged.

Commands used command-local PATH D:/nodejs and C:/Windows/System32/WindowsPowerShell/v1.0 from D:/movieAgent/libtv-studio:

- RED `npm test -- tests/integration/command-delivery.test.ts -t 'grant|pre-admission'`: exit1, 3 failed/15 skipped (18),4.15s. Real engine/outbox restart returned FILE_GRANT_NOT_FOUND and the two other real pre-admission cases returned EXPIRED/CONSUMED instead of continuing.
- RED `npm run test:electron -- tests/electron/workspace-reconnect.test.ts -t 'invalidates provisional'`: exit1,1 failed/5 skipped (6),7.37s. With the first real reconcile completed and next.recover waiting on a held real successful execute ACK, suspend/resume then ACK release left reconcile request/response counts at1 instead of2. This is the exact provisional-recovery interleaving, not a normal reconnect test.
- GREEN `npm test -- tests/integration/command-delivery.test.ts`: exit0,1 file,19/19 passed,6.84s. Includes restart rejection evidence, EXPIRED/CONSUMED, accepted uncertain batch/receipt precedence, prior malformed/late ACK and unknown-delivery controls.
- GREEN after rebuilding production output: `npm run test:electron -- tests/electron/workspace-reconnect.test.ts -t 'invalidates provisional'`: exit0,1 passed/5 skipped,4.99s. A second real reconcile response is held; describe remains STALE_CONNECTION and the original pending row is already settled. Releasing it publishes a fresh epoch in the same instance, exactly one project, and the old provisional epoch is rejected.
- `npm run typecheck`: exit0. `npm run build`: exit0 (final main55.55kB; engine129.56kB). Final package and affected lifecycle regression results follow below.

Boundary: The new test-only CJS launcher wraps actual Electron utilityProcess message delivery then imports the actual built production main/engine. It holds the specific committed command ACK and second provider.recover response; it fabricates neither ACK nor recovery result and adds no production test hook. Existing packaged tests separately cover normal reload/resume and immediate close/reload; physical sleep and real provider/installer acceptance remain unverified. No real API/keys, external messages, global process termination, blocked-root cleanup bypass, or full-suite repetition occurred. Existing SQLite experimental, builder packaging/unsigned/dedupe and Git line-ending notices remain.

Round 1 final closure: `npm run package:win -- --dir` exit0; the rebuilt unpacked binary contains both I1/I2 repairs and all prior errorCode/exit-report fixes. Final `npm run test:electron -- tests/electron/workspace-reconnect.test.ts`: exit0,1 file,6/6 passed,30.89s (tests26.95s). Includes held provisional recovery, retained production crash-during-resume, host deadline/report faults, packaged reload/resume and genuine early-load close/reload. Final typecheck exit0. No production change followed this run. One scoped self-review checked the complete changed diff, grant validation after receipt/batch precedence, generation checks across awaits, provisional invalidation, retained restart intent, late-ACK-before-stale settlement, and fixture-owned teardown; `git diff --check` exit0. The six intended repair files alone are staged; the local ignored report remains local and unrelated untracked research/prototypes remain untouched.

Shared interfaces addition for Task10: lifecycle generation and provisional connection are main-only fences, not a new frontend state machine or serialized contract. Suspend makes both connection objects stale; resume completes fresh reconciliation before exposing a current epoch even if an older replay finishes late. Outbox rejection schema/receipt identity are unchanged, with three narrowly scoped pre-admission import errors added. ElectronApplication.close/tray/installer handoff remains as documented above; installer, physical sleep and real-provider verification are still deferred.

## Task10 — MovieAgent 本地测试 beta 历史基线（2026-10-25）

以下172/172、30/30、旧哈希与1255.16ms数据属于最终审查前的9af6ac7历史基线。当前交付证据见末尾“最终审查合并修复”；task-10下的manifest/probe/metrics文件在该次验证成功后显式更新为新包，不应与本节旧数值混用。

交付 **Windows x64 / 0.1.0 / 未签名本地测试版**。最终 NSIS 安装器已生成；完整 P1 仍未验收：用户明确把真实 API 留到以后，且没有无开发工具的干净 Windows 环境。本轮没有发现真实 Key、打开用户原有资料库或调用真实付费服务；不以 fixture 或开发机运行替代这两项。

| 检查 | 实际结果 | 范围 |
| --- | --- | --- |
| 类型检查 | `npm run typecheck` exit0 | 最终生产代码 |
| 完整集成测试 | `npm test`：13文件 **172/172**，18.25s，exit0 | SQLite/文件/真实子进程/协议 fixture |
| 构建 | `npm run build` exit0；main56.75kB，engine129.56kB | 两个 HTML、两个 preload、utility引擎 |
| 最终 NSIS | `npm run package:win` exit0 | 真实安装器与解包目录；未运行安装器 |
| 包资源与本机组件 | `node scripts/verify-package.mjs` exit0；[原始结果](task-10/package-probe.json) | 包内 Electron45 / Node24.22 / ABI150 / SQLite3.53.4；原生Sharp编码2×3 PNG96bytes，SHA256 `783cf58b9994058840e4c0ff7200389329302b6694e2392e3287fafa40655c26` |
| 完整桌面测试 | `npm run test:electron`：10文件 **30/30**，127.62s，exit0 | 最终包本机运行；实际 fixture 生成、原件、资产、画布、重开、IPC/凭据/媒体、重连、加载期关闭/重载、原生托盘/完全退出策略 |
| 产品与资料位置 | 实际旧包 getName=`@libtv/desktop`；新默认 profile 固定 `%APPDATA%/@libtv/desktop`，显式路径保留 | fresh appData 的实际 production-main 测试验证默认→显式旧路径同库/同项目，再验证独立指定路径；不访问真实用户库 |
| 中文/空格/特殊字符路径 | 最终 packaged-startup 用中文/空格 profile/library；exe父路径有中文、空格、`#`、`%` | 解包程序移动后实际打开/写入，非干净系统安装 |
| Windows文件属性/签名 | exe/installer ProductName=MovieAgent；两者 `NotSigned` | [实际属性](task-10/windows-metadata.json)；保留默认Electron图标 |
| 真实 API | **未完成** | 仅脚本默认拒绝/配置 fixture 与启动门禁测试；无真实调用/账单证据 |
| 干净 Windows 安装/升级/卸载 | **未验证** | 无该环境；不安装VM/服务/OS制造证据 |

最终产物记录见 [package-manifest.json](task-10/package-manifest.json)。`app.asar` 中 main、engine、两份 preload 与最终 build 输出逐字节相等，确保最后修复已进入发行包。最终源代码冻结后的 full suite/build 已运行一次；此前有一次历史预跑172/172，之后增加 startup admission fence，因此进行了必要的最后全套。Windows资源编辑配置单独修复为 `signExecutable:false` 后最终重打 NSIS，未为此重复 unit/build。打包过程中一次误重叠启动的自有 builder 被精确中止（退出4294967295），旧 builder 完成、确认无余留后，最后按单实例顺序完整重建成功；重叠/中止产物不作为证据。

| 最终文件 | 字节数 | SHA256 |
| --- | ---: | --- |
| `apps/desktop/release/MovieAgent-0.1.0-local-test-Setup.exe` | 129460048 | `7bda33f7d8b435b42a3323c375d5eba3e6bfc4a43f2e814eaf8d289078d86993` |
| `apps/desktop/release/win-unpacked/MovieAgent.exe` | 249797632 | `a7c2f24cddcfee5d14671e16887fecb73fc7a2c9c9e4afbe921e6ed49e31420e` |
| `apps/desktop/release/win-unpacked/resources/app.asar` | 17369782 | `9b4e1e2c85d59503e8a703bd1dd8e50e007d20fd4d2edf8a6ace76c7f7bd64da` |

CLI/门禁 TDD：先写实际 asar 缺 engine/凭据 preload、开发 Node ABI 拒绝及 live-config 测试，初始11失败因两个脚本尚缺失；实现后 Windows asar 路径分隔问题导致3失败/8通过，修复 normalize 后11/11。实际旧包命名断言 RED 得到 `@libtv/desktop`，临时 appData 测试 RED 得到 Electron 默认目录；修复后保留旧 profile 并设置 MovieAgent。实际 production-main admission RED 观察 provider.start=1（期望0），改为取得库独占后、供应商激活/outbox重放前检查。跨库 outbox 用例再暴露漏检，已改为整个 profile 的 pending 检查。最终6场景验证排队、完成待收存、未知提交及同/跨库 outbox 均拒绝且状态不变，仅空闲库启用供应商。task.list 从整个 task_attempt 读取，不受项目或 UI 分页限制；该窄启动模式没有新增任意执行 IPC。完整过程/测试编写问题在 Task10 本地报告记录，不将测试作者错误算为产品错误。

未来脚本必须显式 opt-in，恰好一张、固定 connection/profile引用和有限币种额度，经既有 prepare/approve 路径执行。启动前/取得库独占后两次拒绝其他待执行/待核实/未收存任务与全部 pending outbox；一次性证据文件用 wx 创建，未知/失败不得自动重发。成功分支准备记录脱敏外部 ID、配置版本/planHash、原件 hash/长度、耗时/已报告用量和重开；本轮没有执行该分支。匹配本次构建、独占使用的专用验收 profile/library 及用户后续明确授权仍是前提。详见[运行与有限验证说明](../development.md)。

视觉复用并直接复看 Task8 真实 [无图](task-8/home-empty-1100.png)、[随机导入](task-8/assets-random-1100.png)、[纯色画布](task-8/canvas-1100.png)；历史截图在回归测试后恢复，未重做装饰性截图。[本次性能原始数据](task-10/local-performance.json)：单次启动到 firstWindow+bridge+DOMContentLoaded **1255.16ms**；Windows10.0.19044，i7-10510U，8逻辑核，16,958,754,816bytes RAM；实际窗口1180×680、内容1166×643、renderer DPR1.5、Electron screen scaleFactor1.5。不是独立 OS DPI 校准。

两次事件快照涵盖 Browser/GPU/NetworkService/LibraryEngine/Tab 五进程：CPU百分比之和0→25.6942%，累计CPU1.859375→2.937684秒，采样工作集391.24→475.53MiB，各进程生涯峰值之和407.13→476.64MiB。生涯峰值之和不是同时发生的进程家族峰值；持续峰值未测，仅两个事件时点、一次项目写入、开发机解包运行，不能声称冷启动/安装后/500节点性能达标。

已知限制：默认图标、未签名/SmartScreen、真实API/计费/公共CDN、干净安装/升级/卸载、全部DPI/其他平台、物理休眠/断电、完整备份恢复/远程/Agent/视频/执行图/时间线都未借此计为通过。普通 ElectronApplication.close 请求完全退出；活动任务 BrowserWindow.close 的托盘继续与完整退出是两个分支，云端取消独立。SQLite experimental、builder包管理器/dedup/default-icon/signing和Git行尾提示仍在。Task8四个失败临时目录删除曾被自动策略拒绝，相关进程已停止；Task9及Task10失败诊断目录也可能残留。未绕过策略换工具重删，未全局结束进程。

## 最终审查合并修复 — 当前交付证据（2026-10-25）

本轮基于 `9af6ac7` 一次修复 I1、I2 和 M1–M4。当前产物仍是未签名 Windows 本地测试 beta，完整 P1 的真实接口/干净系统验收仍未完成。

- I1：按命令与实际处理路径分类确定拒绝；发送时和重放时共用分类。CANVAS_CONFLICT、同步配置的 CREDENTIAL_UNAVAILABLE 等拒绝归档到 rejected_command，保存完整 envelope/hash/error code；后续 pending 命令继续恢复。receipt/已接收异步命令身份优先，未知提交、异步收存、存储/网络失败保持待确认。真实 v1→v2→旧v1冲突、另一个ID解决、重启和后续命令一次提交的回归通过。
- I2：同一 renderer 会话的草稿按资料库/画布/节点 incarnation 保留，跨同库 wake/utility 重连仍可见且显示未保存。各字段最初 CAS 基线不被刷新重写；服务器改动显示冲突，明确重试才使用最新版本。原节点删除后撤销形成新 incarnation，旧草稿单独可见，不能复制进新节点。查询、命令、事件和草稿 ACK 仍受连接 epoch 隔离。没有新磁盘草稿存储，完全退出/renderer重载仍须事先保存。
- M1：仅展开 HTTP DNS/socket/abort/download、图像提交结果与 spool 持久发布相关密集代码；原有请求、重试、重定向、大小限制、清理与不可变内容身份规则保留。
- M2：成功快照才可显示空任务/空连接/空资产；初次等待、错误、未知版本数分开显示。后台刷新失败保留已加载连接数据并显示错误。
- M3：普通 startup 结果写 `test-results/packaged-startup-<timestamp>.json`，带实际 exe/asar SHA256，测试断言冻结文档未被改动。只有完整验证成功后才显式运行 promotion 脚本；非成功记录或包哈希变化拒绝提升。
- M4：已保存的明确固定文本输入可单独启用准备生成；引擎仍拒绝合并后空提示词，固定版本内容不随源文本改动，未加入依赖图执行。

定向 RED：I1 3失败/19通过；修复后22/22。旧包 M2 三个页面分别重现加载/初次失败误报空；校正测试对 ReactFlow 瞬时样式的无关比较后，I2 wake 和 M4 fixed-only 各得到真实 RED。字段 CAS 新用例先1失败/3通过，后4/4；promotion 新用例先因脚本缺失失败，后完整12/12。provider+draft定向50/50。上述测试仅使用新临时目录、dummy资料与本地HTTP fixture，不读取用户库/真实Key，不调用付费接口。

| 最终检查 | 实际结果 |
| --- | --- |
| 完整集成 `npm test` | 13文件 **178/178**，17.48s，exit0；一轮 |
| 类型检查/生产构建 | `npm run typecheck` / `npm run build` exit0；main58157bytes，engine129622bytes |
| 最终完整 NSIS | `npm run package:win` exit0，顺序单次构建；安装器未执行 |
| 最终包探针 | `node scripts/verify-package.mjs` exit0；Electron45/Node24.22/ABI150、SQLite3.53.4、包内Sharp实际PNG编码；[probe](task-10/package-probe.json)附采集时间和所测exe/asar身份 |
| 新包完整桌面 `npm run test:electron` | 11文件 **36/36**，150.81s，exit0；一轮，无失败/无整组重跑 |
| 构建与归档一致性 | 11份实际输出逐字节匹配，包括main、engine、共享chunk、两个preload、两个HTML与renderer JS/CSS；[manifest](task-10/package-manifest.json) |
| 产品元数据 | exe/installer ProductName=MovieAgent，二者NotSigned；[Windows属性](task-10/windows-metadata.json) |

全部生产代码冻结后构建并制作上述NSIS，再在该新包上执行完整桌面套件。集成测试后唯一显示整理是将旧节点草稿JSON改为可读文字/位置，随后类型检查、build和新incarnation桌面断言覆盖；没有留下旧二进制。最终桌面用例含同库suspend/resume事件、真实自有utility PID重启、内容/布局草稿保留、旧CAS冲突与明确解决、delete→undo新incarnation隔离、空库三种读取阶段、缓存刷新失败和fixed-text-only准备。

| 当前最终文件 | 字节数 | SHA256 |
| --- | ---: | --- |
| `apps/desktop/release/MovieAgent-0.1.0-local-test-Setup.exe` | 129459987 | `22f732eaa4848bf77ebdbf99199049aa670e5b39db6c8af227d93e4742e6e5ec` |
| `apps/desktop/release/win-unpacked/MovieAgent.exe` | 249797632 | `02550f72731883597899e66f184b907af39a9949b6610f1e7df3e9ffae6d5b57` |
| `apps/desktop/release/win-unpacked/resources/app.asar` | 17373423 | `9724a68a430f5a3f4a56111d449655fd7bf2afc9bd43fafc1a5a10eabbd1e4c9` |

完整桌面成功后，显式执行 `node scripts/promote-performance.mjs --source test-results/packaged-startup-1792887685815.json --target docs/verification/task-10/local-performance.json`，exit0。测量时间2026-10-25T00:21:23.705Z，新包单次启动 **1091.46ms**；身份与上表一致。两个事件时点、各5进程：CPU之和0→19.5344%，累计CPU1.677641→2.407479秒，工作集383.20→460.09MiB，各进程生涯峰值之和398.55→460.78MiB。窗口1180×680/内容1166×643，DPR与Electron scaleFactor均1.5。仍非冷启动、持续峰值、干净安装或大型库性能认证。Task8回归生成的图片已恢复为原历史截图；没有将混合时点图片冒充新包视觉证据。

保留稳定appId与历史appData/@libtv/desktop位置、既有live-check空闲门禁和一次批准语义。未执行真实API、安装器、签名、物理睡眠、全量恢复或后续P2–P5能力；已有警告及早前清理限制不变。完整本地修复报告：`.superpowers/sdd/2026-10-25-desktop-image-workflow/final-fix-report.md`。
