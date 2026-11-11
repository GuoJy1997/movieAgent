# MovieAgent 本地开发和交付

当前交付为 [P5 Windows x64 0.2.0 本机维护版](delivery/2026-10-29-p5-local-desktop.md)。支持完整项目备份、恢复默认暂停、显式启用、迁移和手动升级辅助，见 [本机维护说明](P5-本机维护使用说明.md)。安装器来自 electron-builder NSIS；开发机运行解包程序不替代干净 Windows 安装、覆盖升级和卸载验收。下方 P2 部分保留历史开发记录，当前发行文件以 P5 最终交付文档为准。

## 运行测试版

P2 最终程序为 `apps/desktop/release-p2-final/win-unpacked/MovieAgent.exe`。canonical release 内的旧安装器/程序是历史 P1 包，不能作为本轮 P2 验收包。默认 Electron 图标尚未定制，程序和安装器均未签名。操作系统提示/信任状态没有在干净机器上测过。

默认 profile 使用旧包实际应用名对应的 `%APPDATA%/@libtv/desktop`，包括 `library`、`credential-vault` 和 `client-state`。显示名 MovieAgent 不会另建默认 profile；包名/appId 保留。可指定绝对路径：

```powershell
& '.\apps\desktop\release-p2-final\win-unpacked\MovieAgent.exe' '--user-data-dir=D:\创作资料\profile' '--library-root=D:\创作资料\library'
```

先建项目、导入 PNG/JPEG/WebP、将固定资产插入画布并保存文本/位置，再完全退出并重开。模型配置分连接、模型、生成预设，凭据只在独立窗口输入；安全存储不可用可显式选择仅会话。此轮未使用真实 Key 或调用真实服务。窗口关闭选择托盘会继续本机编排；完全退出会等待本机引擎停止，云端任务可能继续。未知提交请查询/对账，不要把重新生成当作恢复。

源代码 schema 当前为10（资产元数据8、图边9、工作流10）；已发布包的实际版本以引擎握手为准。升级前的数据库备份、迁移候选和诊断保存在资料库内；较旧程序只能配合相应旧备份恢复，不支持任意降级。维护快照与原件引用清单并不等于完整可移机备份；没有自动 GC、完整恢复向导或跨机器凭据保证。

## 工具链与验证命令

开发机使用 Node24.12.0 / npm11.6.2；Electron45.0.0 自带 Node24.22.0、ABI150、SQLite3.53.4，不使用开发机 Node ABI 代替发行验证。依赖版本锁在 package-lock.json。开发安装用 `npm ci`，不要求终端用户安装 Node/SQLite。

```powershell
$env:PATH='D:/nodejs;C:/Windows/System32/WindowsPowerShell/v1.0;'+$env:PATH
npm run typecheck
npm test
npm run build
npm run package:win
npm run verify:package
npm run test:electron
```

`package:win -- --dir` 只制作解包目录；完整交付需不带 `--dir` 的 NSIS 构建，并在最终代码冻结后重新打包。`verify:package` 检查 asar 的主/utility入口、四个 HTML 和四个隔离 preload，运行包内 Electron 的 SQLite 写读和包内 Sharp 本机 PNG 编码，拒绝缺资源、开发 Node/错误 ABI 或缺原生 DLL。它不替代真实窗口/IPC/退出测试。`test:electron` 必须已有最终包；本地 HTTP 生成测试明确使用 fixture 证据，默认测试不发现真实 Key 或调用付费服务。

普通 packaged-startup 测试只在自身全部断言成功后，将性能测量保存为 `test-results/packaged-startup-<timestamp>.json`，附实际 executable 与 app.asar 的 SHA256。它不会更新冻结的发布文档。完成整套最终包验证后，选择该次成功文件，显式运行 `node scripts/promote-performance.mjs --source test-results/packaged-startup-<timestamp>.json --target docs/verification/task-10/local-performance.json`；脚本拒绝非成功记录或哈希已变化的包。随后更新 manifest、probe 和对应叙述，避免不同构建的证据混用。

画布未保存草稿在同一 renderer 会话内按资料库、画布和节点版本保留，可跨同库休眠事件/引擎重连恢复；网络请求仍受连接轮次隔离。保存时保留最初编辑字段的版本检查，服务器已改动会显示冲突。节点被删除或重建后，旧草稿单独显示，不能自动覆盖新节点。这不是磁盘草稿存储：完全退出或 renderer 重载前仍应保存。

测试可能保存临时诊断资料。Task8 四个失败测试目录的删除被自动策略拒绝，相关进程已停止，未绕过策略重试；Task9 和 Task10 失败诊断也可能留有临时目录。没有自动删除用户资料或全局结束进程。Git 行尾、SQLite experimental 与 unsigned/default-icon/builder dependency notices 已记录。

## 未来有限真实接口检查（本轮未执行）

只在用户之后明确授权时使用 `scripts/run-live-image-check.mjs`，当前真实 API 验收未完成。它默认拒绝，必须指定新生成证据文件、已保存的项目/连接/Profile引用、单图数量、币种、有限额度和 `--allow-paid-image-generation`。脚本不接收明文 Key、不查环境变量 Key、不读凭据文件，秘密只由产品既有 main/vault 能力使用。使用与本脚本同次构建的 MovieAgent 包，并关闭使用该 profile/library 的其他实例；建议为该次验收准备专用资料库/profile。

配置文件必须恰好包含以下字段。示例为虚构引用/路径及示例额度，不是调用授权；将每个值换成用户明确选择的内容。金额单位为币种的百万分之一，count只能1。

```json
{
  "schemaVersion": 1,
  "executable": "D:/MovieAgent/MovieAgent.exe",
  "libraryRoot": "D:/验收资料/library",
  "userData": "D:/验收资料/profile",
  "libraryId": "library-fixture",
  "projectId": "project-fixture",
  "connectionRef": {"libraryId":"library-fixture","id":"connection-fixture","revision":2},
  "profileRef": {"libraryId":"library-fixture","id":"profile-fixture","revision":3},
  "prompt": "用户批准的提示词",
  "count": 1,
  "currency": "USD",
  "allowanceMicros": 100000,
  "budgetLimitMicros": 100000,
  "acknowledgeUnknown": true,
  "evidenceFile": "D:/验收资料/evidence/once.json"
}
```

安全校验（不启动应用、不打开资料库/凭据）：

```powershell
npm run check:live-image -- --validate-only --config D:/验收资料/check.json
```

得到另外授权后才运行 `npm run check:live-image -- --allow-paid-image-generation --config D:/验收资料/check.json`。启动前脚本拒绝非空闲资料库和任何 pending outbox；main 取得引擎独占权后，在供应商激活/调度与 outbox 重放前再次检查整个资料库的全部任务及整个 profile 的 outbox。非终结、供应商未知/已接单、完成未收存任务均拒绝；该模式没有新增任意执行通道，也不绕过 prepare/approve。

证据路径先以独占创建写入 once-only 标记；失败、超时或未知结果都保留标记，不自动重试/重提。检查任务状态后人工恢复原任务，勿删除标记盲目重跑。成功时脚本完全退出再重开同一库，核验原件 SHA256/长度，记录固定配置引用/planHash、本机任务ID、外部ID的哈希、耗时、供应商报告用量（未知保留null）和重开结果，不保存提示词、Key、URL或供应商原始错误。最多轮询五分钟；本地预算/计时不构成供应商账单上限。仅验证单张文本→PNG协议子集，不承诺参考图/遮罩/批量/所有兼容服务/公共CDN输出已通过。

## 目录式短剧工作台（2026-10-25）

默认启动进入无引擎的项目启动器，不打开旧资料库。新建短剧先选择父目录；“从已有文件夹创建”选择素材目录本身，只补模板、不移动或覆盖原文件。“打开项目”要求已有 movieagent.project.json。目录搬移后用“打开项目”重新定位；原目录仍存在的相同 workspaceId 副本拒绝打开。最近界面显示50条，注册表保留所有身份（上限10000条/4MiB）。

每个短剧的资料库固定在 `.movieagent/library`，由 manifest 绑定一个 project。独立 profile 位于启动器 userData 的 `directory-workspaces/<workspaceId>`，含 outbox 和受保护 vault。只允许启动器写全局最近索引；子工作台只读校验全部保留身份。相同短剧重复打开聚焦原窗口，不启动第二个引擎；关闭启动器不会退出项目工作台。

实际本机启动器为 `D:/movieAgent/启动MovieAgent.cmd`，模型文件为软件项目内的 `D:/movieAgent/yangfan/config/models.json`，默认短剧项目父目录为 `D:/movieAgent/projects`。模型配置属于软件全局设置，各短剧共用，不放进短剧素材目录。交付准备命令 `node scripts/start-local.cjs --prepare-only` 优先保留项目内已有配置；若不存在则逐字节复制旧位置的配置，旧文件仅保留为备份，不再由更新后的启动脚本引用。只有完全匹配程序原先生成内容的旧启动脚本会更新路径，自定义脚本保持原样；省略参数会启动可见应用。实际 `config/` 配置已排除 Git，可提交的空值模板位于 `configs/models.example.json`。配置填写 baseURL/apiKey/modelId，支持文本、文生图、参考图生成与 MiniMax 视频的明确协议子集。空白可编辑项目；非法配置显示固定错误码，可修正文件后在模型设置重新载入。“已载入”不代表服务验证通过；载入不自动发测试请求。Key 留在 main 与受保护 vault，界面只收到路径/条目ID/状态/错误码。

P2 页面现已通过独立受限窗口管理同一全局 JSON：新增文本/图片/视频、Base URL、API Key、模型 ID；高级设置保留准确协议、参数和价格。保存后明确显示文件写入/项目载入两个结果。Key 不回显，留空保留；并发文件冲突保留草稿。已有项目可重新载入，新项目继承全局配置；独立项目预设保留不可变版本。

开发或其他安装位置默认使用启动器 userData/models.json。显式 `--model-config=<绝对本地路径>` 由启动器记住并传给其项目。`--project-root=<项目目录>` 经启动器登记后打开；`--project-launcher` 强制启动器。已有 `--library-root=<目录>` 和 `--legacy-workspace` 保留旧模式（默认 `%APPDATA%/@libtv/desktop`），不迁移旧数据。

模板包含 scripts、storyboards、assets、shots、audio、exports 与 `.movieagent/library`。脚本是可在系统编辑器编辑的 Markdown，分镜为版本化空镜头列表；工作台“打开短剧文件夹”提供访问。当前图像/文本画布、资产、任务与模型配置沿用已有实现；已支持 P2 文本/图像/视频生成与依赖计划；无新增 Agent、音频时间线、自动索引或成片导出承诺。

验证顺序：`npm run typecheck`、`npm test`、`npm run build`、`npm run package:win -- --dir`、`npm run verify:package`、`npm run test:electron`。新增目录 Electron 流程默认验证实际 unpacked 包；开发阶段仅可用命令局部 `DIRECTORY_TEST_DEV=1` 调试构建输出。截图和本轮证据写在 `.superpowers/sdd/2026-10-25-directory-projects`，原 P1 历史证据不覆盖。
