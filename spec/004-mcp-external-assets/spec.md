# SPEC-004：MovieAgent MCP 与外部创作资产接入

- 规格状态：Approved（用户于 2026-11-02 回复“可以，开始开发吧”）。
- 实现状态：M1 Implemented；M2/M3 未开始。
- 验收状态：M1 本机工程与最终打包 MCP 验收通过；宿主实际生图、真实视频 API 与人工质量未验；2项Minor延期。详见[验收报告](../../verification/2026-11-02-spec004-m1/report.md)。
- 创建/更新日期：2026-11-02。
- 适用范围：个人 Windows Electron 桌面、本机内置引擎、Codex 等本机 MCP 客户端。
- 用户原始需求：像 LibTV / BeefTV 一样提供 MCP；Agent 可以自己生成图片，再传入 MovieAgent 对应资产列表，不必每次调用应用配置的生图模型。
- 本次交付范围：按 [plan.md](plan.md) 实施 M1；后续阶段与真实服务验收分开记录。

## 1. 目标、边界与设计决定

MCP 是外部 Agent 的业务操作入口。Agent 可以完成创作、查看结果并继续调整；MovieAgent 持久保存项目、资产、版本、画布、任务、时间线和制品。桌面操作与 MCP 操作使用同一业务状态。

用户已经决定：支持 MCP；外部 Agent 生图后可导入；图片不强制来自 MovieAgent 生图模型；保留父项目共享资源与子项目连续创作；第一期为 Windows 本机。

已确认方案中的设计默认：

1. 本地 stdio MCP 进程接入正在运行的桌面主进程，再复用该工作目录唯一的引擎；不另开资料库写入者。
2. 目标覆盖完整生产流程，分阶段实施，第一批优先交付图片导入和“导入图直接生成视频”。
3. 优先接收本机文件；有大小限制的字节上传作补充；任意远程 URL 抓取暂不纳入第一批。
4. 默认在当前子项目收存；通过显式选项设为父项目共用素材。角色、场景、道具、风格依旧为父项目实体。
5. 沿用已有模型配置、固定版本、预算和任务批准语义；用户已授权的范围内连续执行，不为每个可逆编辑重复弹窗。

不包含 Linux、远程引擎、多人权限系统、MCP 内嵌 Codex 生图服务、复制其他产品未查证的私有接口、对整部剧艺术质量的自动保证。

## 2. 当前能力与实际缺口

以下均以当前工作树为准，不将其描述为本轮已实现：

| 现状 | 源码依据 | MCP 所需补充 |
| --- | --- | --- |
| 引擎有统一命令、查询、回执、版本和连接 epoch | packages/contracts/src/commands.ts；packages/engine/src/command-router.ts | MCP schema、白名单、身份与工作范围适配、结构化错误 |
| 本地素材收存、内容哈希、缩略图和固定资产版本已经存在 | packages/engine/src/asset-service.ts；packages/storage/src/object-store.ts | 外部 Agent 的受控文件接收入口和来源记录 |
| 当前文件授权仅来自系统文件选择器 | apps/desktop/src/main/file-grants.ts；workbench.ts | 专用导入桥；不能把任意路径塞进通用 renderer 命令 |
| 图片已有 PNG/JPEG/WebP 检查、完整解码和大小上限 | packages/storage/src/object-store.ts | 沿用当前默认 32 MiB、4000 万像素；不要仅相信扩展名 |
| 导入命令带 scope 时可记录项目/子项目归属，共用标记已有接口 | packages/engine/src/content-scope.ts；project-assets-service.ts | MCP 必须显式传范围，不能依据窗口当前选择猜归属 |
| 角色/场景/道具/风格实体可引用固定媒体 | packages/contracts/src/creation.ts | 导入与实体绑定组合操作、冲突处理 |
| 画布 image/media 节点与 reference/first_frame/last_frame 等端口已存在 | packages/contracts/src/canvas.ts | 新建、编辑、连接、查询等明确工具；不直接写数据库 |
| 分镜可选定外部 image/video 资产为结果 | creation.ts 的 SelectShotOutputInput | 将结果选择和生产输入区别表达 |
| 批量分镜生产按 imageProfileRef/videoProfileRef 创建节点；仅记录选择版本，没有把现有 selection.image 冻结成视频首帧 | packages/engine/src/shot-production-service.ts 的 prepare；packages/contracts/src/shot-production.ts | 增加显式复用固定图的生产模式；这是业务缺口，不能只做 MCP 包装 |
| 引擎资料库有排他所有权 | packages/storage/src/database.ts | 同一工作目录复用引擎，不让 MCP 独立 SQLite 写入 |

### 2.1 参考产品的已查证范围

- BeefTV 固定提交 `4b4ca0626dca478b7ba1aead89fb81f8cc462161` 的 `backend/cmd/beeftv/mcp_client_test.go`：官方客户端通过 `beeftv mcp serve` 连接；工具来自工作区 operations 和业务 handlers；测试检查 operationId 幂等键、版本冲突、只读标记。这里是源码/测试契约依据，没有运行其测试。
- 同提交 `backend/cmd/beeftv/business.go`：业务文件参数支持 filePath 或 name/mimeType/data（base64），转交允许上传的业务接口；有 64 MiB 单次限制与分块路径。此限制属于 BeefTV，不直接套用 MovieAgent。
- 本机 LibTV 1.0.0 插件 `skills/music-driven-product-ad/references/libtv-production.md` 明确要求上传已有素材，核对媒体 ID/格式/尺寸，以及操作节点、边线、生成和导出。它证明已有素材是合法输入，但不能据此宣称掌握全部实时 MCP 工具或服务端实现。
- `D:/BeefTV` 是安装目录，非完整源码。本次使用此前缓存的 bare clone 固定提交；未修改 BeefTV 产品源码或调用其业务服务。

## 3. 方案与取舍

| 方案 | 价值 | 代价与判断 |
| --- | --- | --- |
| MCP → 本机桌面桥 → 既有引擎（推荐） | UI 与 Agent 共用状态、回执和任务；符合 Windows 本机约束 | 需新建受控进程桥和工具适配层 |
| MCP 独立启动另一套读写引擎 | 可脱离桌面运行 | 要解决双写、目录锁、配置和状态同步；不适合本期 |
| 仅提供文件夹监听导入 | 最快完成收图 | 无法表达绑定、画布、任务、时间线和失败恢复，不能满足整体 MCP 目标 |

推荐方案不要求重写现有业务引擎。客户端用 stdio；桥接采用 Windows 本机管道或等效的本机受控通道。最终管道命名与打包形式由实施者确定，但必须有当前用户边界、会话认证、实例发现和单一引擎所有权。

应用未启动时默认返回 APP_NOT_RUNNING 及启动入口；第一版不隐式新建独立引擎。关闭桌面后连接明确失效；已持久任务的恢复沿用应用逻辑。将来自动拉起桌面作为单独增强，不影响首批可用。

## 4. 创作流程

### 4.1 外部图片进入业务

1. Codex 或其他 Agent 使用其当前可用生图工具，得到可读取的图片文件或字节。
2. 发现 MovieAgent 实例，明确 libraryId、projectId、subprojectId，读取可用导入能力和限制。
3. 导入图片，指定名称、标签、来源说明和归属。应用复制/收存文件到对象库，不能仅保存临时路径。
4. 返回真实的 assetId/version、哈希、MIME、尺寸，以及可读取的预览引用。
5. 根据用户目标绑定为角色/场景/道具/风格参考图，或选为某分镜的图片结果；可同时新增画布图片节点。
6. 视频生产准备明确使用此固定图片，不要求配置图像模型，也不自动创建图像生成任务。
7. 视频生成结束，读取实际任务、选定视频结果，放到目标子项目的时间线，渲染与导出成片。

示例用户指令：为“第一集”生成朱清的参考图，导入《大明朱清》的共用资产，绑定朱清角色，再把选好的场景图用于 G01 的视频首帧。

MCP 不负责赋予宿主生图能力。Codex 生图工具的可用性与成本由该宿主决定；不能承诺 MovieAgent 自动继承 Codex 的订阅权益。若宿主只返回会话内部图片标识，需先通过宿主支持的下载/文件输出能力得到文件或字节，再导入；不要伪造路径。MCP 导入本身不调用生图服务。

### 4.2 图片的业务身份

同一张图片的“入库”“绑定角色”“选作分镜图”“放入画布”“作为视频首帧”是不同操作。入库后仅返回成功，不代表后面全部完成。

- 父项目共用：角色、服装、场景、道具、风格参考等跨集复用素材。
- 子项目素材：当集分镜图、片段和阶段产物；其他子项目按现有项目资产规则查用。
- 画布节点引用固定 assetId/version，不复制原件；边线明确 reference 或 first_frame 等用途。
- 参考图改变时创建资产新版本；既有实体修订、镜头和已冻结任务保留旧版本，迁移引用必须显式执行。
- 实体种类与媒体类型分开：图片可以是角色的参考，也可以是场景的参考，不能只靠文件名推断。

## 5. MCP 能力目录

下列是拟新增的公开能力分组，工具名为设计名，最终 schema 以实现与 capabilities 输出为准。不能提供允许任意 method/SQL/shell 的通用执行工具。

| 组 | 能力与返回内容 | 交付阶段 |
| --- | --- | --- |
| system | doctor、capabilities：版本、引擎/工作目录状态、支持的工具/输入限制 | M1 |
| workspace/project | 列举已登记目录、打开已有目录、创建项目与子项目、读取范围 | M1；目录新建 M2 |
| assets | list/get/preview、import、addVersion、updateMetadata、标记共用 | M1 |
| creation | 读取/保存角色、场景、道具、风格、剧本、分镜；绑定固定参考 | 绑定 M1；完整编辑 M2 |
| canvas | list/get、创建图片节点与连接；完整节点/边线增删改、布局 | 导入闭环 M1；完整编辑 M2 |
| production | prepare/execute/status/cancel/reconcile；选择导入图、视频模型和参考用途 | 单镜头外部图 M1；批量 M2 |
| models | 列出现有模型配置、能力与可用状态 | M1；不返回 API Key |
| tasks | 查询、等待、取消、恢复/重试及提交不明核对 | M1 起按已交付能力提供 |
| voice/audio | 声音档案、音频导入与绑定、已有配音/转写/修复任务操作 | M2，沿用 SPEC-001，不新增模型承诺 |
| timeline | 列表、读取、版本化编辑、装配、预览、本地渲染 | M3 |
| export/delivery | 导出计划、任务状态、核对恢复、制品登记 | M3 |
| continuity | 共享记忆读取、按现有子项目完成流程更新 | M3，沿用 SPEC-002 |

M1 不是完整 MCP 项目完成，只有 M1–M3 全部验收后才能称为目标范围交付。各组工具返回 capabilities，未交付能力不伪装为可用。

## 6. 接口与一致性

### 6.1 会话、范围与权限

- MCP 会话绑定具体应用实例、资料库和授权范围；多窗口、多工作目录必须显式选择。
- 写操作带稳定 requestId，桥内映射已有 commandId；对同请求相同参数回放原结果，不重复导入/建节点/扣费。同 ID 不同参数返回冲突。
- 单一操作涉及的 scope 固定为 libraryId + projectId + subprojectId；切换 UI 页签不改变正在执行的范围。
- 改已有对象必须提交 expectedRevision 等现有版本字段；冲突返回新版本与可重读提示，不能无条件覆盖用户编辑。
- 引擎重启改变 connectionEpoch；桥重新发现并校验范围，先查持久回执/任务再决定续作，不能盲目重发生成。
- 事件通知让桌面刷新；Agent 可通过增量事件或有界 wait 获取进展。任务返回 ID，不用一条 MCP 调用等待整个视频生成。
- 只公开明确白名单业务工具。模型密钥、任意对象库路径、内部能力 token 不进入返回值或日志。
- 本机客户端对一个项目的操作授权和付费模型预算分开；沿用现有 prepare/approve 计划与实际持久授权机制，不凭模型提交的 approved=true 赋予权限。具体宿主确认映射在实施计划中确定，但不得弱化已有成本控制。

### 6.2 assets.import 拟定请求

必填：requestId、明确工作范围、name，以及一种 source。

source 为二选一：

- localFile：importSourceId + 相对文件路径。importSourceId 来自一次配置的允许导入目录，建议为 Agent 产物目录或应用提供的收件目录。解析最终真实路径，防止链接、路径越界或源文件中途改变。普通 renderer 仍不能传裸绝对路径。
- bytes：fileName、mimeType、base64。先限定编码请求大小，再解码到应用私有暂存文件，随后走相同收存链。首版建议解码后上限 8 MiB；更大图片用本机文件方式，保留当前图片 32 MiB/4000 万像素上限。数值属于设计默认。

可选：tags、sourceInfo（sourceKind、sourceApp、可选模型说明/提示词/生成时间）、shared、targetAsset（assetId + expectedVersion）、bindings。

来源信息是声明，不把外部“模型名称”当已认证事实；记录实际导入时间和内容哈希。完整提示词为可选项，不自动复制用户聊天历史、凭据或绝对源路径到跨项目可见字段。

bindings 可包括 entityRef、shotRef + role、canvasRef + layout，每项均带当前版本；新建业务对象使用专用创建工具获得 ID，不能依赖模糊名称匹配。

返回：operationId、state、assetRef（含版本）、尺寸/MIME/字节数/哈希、实际项目归属、每一项绑定结果及可恢复错误。预览通过受控 MCP 资源或图片内容返回；不是返回仅 Electron 可用的内部 URL。列表默认不附原图 base64。

### 6.3 复合导入与恢复

收存先完成；归属、元数据、共用、实体绑定、分镜选择和画布插入可为多个现有命令。不得宣称整组天然原子。

新增持久 mcp_operation 记录：请求摘要、归属、状态、各步骤确定性 commandId、已取得 assetRef、已完成绑定、失败码。外部来源元数据独立保存，与实际资产版本关联；不能杜撰 sourceArtifactRef 把外部图伪装成应用生成结果。

状态：received → collecting → asset_ready → binding → completed；绑定失败时 partial，含保留的资产和未完成绑定。原件损坏或授权不成立时 rejected/failed；来源暂时不可读时可重试。取消若发生在 asset_ready 之后，应报告已留下的资产，不静默删除已成功原件。

复合操作重放只接续未完成步骤；已入库图不得重复变成新资产。进程在任一步崩溃，重开根据步骤回执恢复。相同文件哈希可复用对象字节，但不同角色/项目的逻辑资产不能擅自合并。

### 6.4 分镜生产必须支持复用外部图

拟增加显式输入策略：reuse（固定 assetRef + 用途）或 generate（现有 imageProfileRef）。工具先读取当前分镜图片选择，提示可复用；准备时冻结具体版本，不能在执行时偷偷换成最新版。

reuse 的必须行为：

1. 不要求 imageProfileRef，不生成图像模型步骤，不因缺少图像模型阻断。
2. 固定图可作为 video first_frame 或 reference；由目标模型能力核对，不能静默改用途或丢图。
3. 批量时每镜头可分别复用或生成，计划明确列出跳过的生图步骤、实际固定图和会产生费用的步骤。
4. 原件、镜头选择、实体或画布版本改变时按现有规则返回过期/冲突并重新准备。
5. 已批准冻结计划仍指向原图版本；新版本需要新计划。现有不可变历史计划可继续读取，旧 generate 路径保持兼容。
6. 同一策略应复用于 UI 和 MCP；不能只有外部手工拼图可用，应用批量生产仍忽略导入图。

## 7. 错误与兼容

- 未运行、未连接、选错工作目录：明确错误与选择/启动指引，不创建第二个引擎。
- 图片文件丢失、格式损坏、链接或超限：拒绝入库并返回具体原因，不自动替用户调用生图模型补图。
- 已入库后源临时文件消失：对象库仍可显示、绑定、导出和参与生成。
- 模型不支持首帧/参考模式：准备阶段报告能力不匹配；允许用户选其他模型，不提交必然失败的请求。
- 远端返回未知状态或客户端超时：保留 taskId/请求回执并核对；未知不等于失败，不自动再次扣费。
- 用户和 Agent 并发编辑：冲突只影响对应未完成步骤；成功资产保留、可重新绑定。
- 旧数据库新增迁移、来源字段和操作日志均可为空；旧资产没有 provenance 时标作未知，不虚构模型来源。
- 导出沿用 SPEC-003 总预算与实际文件完成核对。MCP 等待超时不能误报导出已取消或释放仍在运行的任务所有权。
- 启停 MCP 不改变模型配置；桌面显示正在连接的客户端、工作范围和可撤销连接状态。

## 8. 验收标准

### 8.1 工程与真实本地链路

1. 打包后用真实 MCP 客户端完成 initialize/list/call；所发布 schema、只读/写入标记与实际能力一致。
2. MCP 与桌面编辑同一资料库；变更在 UI 可见；错误实例、越权范围、陈旧 epoch 不得串项目。
3. 对允许目录内真实 PNG/JPEG/WebP 导入，核对 hash、缩略图、尺寸、归属；清理验收用源临时副本后，重开应用仍能读取。
4. 把导入图绑定角色、场景、分镜并创建画布引用；在另一子项目读取共用角色和素材，不能误入另一父项目。
5. 相同 requestId 重发只产生一次逻辑资产和一次节点/绑定；相同 ID 不同内容拒绝；每阶段崩溃、取消、部分成功均可恢复。
6. 新版本导入不影响旧分镜/冻结任务；并发版本冲突可见，不覆盖用户最新修改。
7. 未配置图像模型时，使用导入图准备视频任务；拦截适配器证明实际请求包含该图且图像模型调用次数为 0。模型不兼容时在提交前失败。
8. 实际 MCP 调用完成画布 → 时间线 → 本地渲染 → 导出；这条本地链路可使用已有视频素材，必须标明没有验证云生成。
9. 非法路径、损坏图、超大载荷、重复调用、断线和并发请求均有确定结果；无密钥/授权 token 输出。

### 8.2 宿主生图与真实模型验收（独立状态）

- 在具备生图工具的真实 Agent 会话生成一张图，获得真实文件/字节，经 MCP 导入并在 MovieAgent 桌面显示。此项证明宿主与应用互操作。
- 获得测试调用授权后，选择已配置视频模型支持的最短时长，只提交一次，用该导入图产生视频，等待同一任务、保存结果、加入时间线并导出。
- 报告分别标记：本地 MCP 通过、宿主生图导入通过、真实视频 API 通过、画面/音色/口型人工验收。任一项不能代替其他项。
- 外部生图的费用/权益与 MovieAgent 的视频调用费用分开；以实际回执为准，未知不能写成零成本。

## 9. 实施次序与未确定项

M1：MCP stdio 与桌面桥、实例和范围发现、模型能力查询、图片接收/资产列表/预览/来源/版本、绑定与最小画布操作、单镜头复用外部图视频准备和任务状态。这是首个可以实际试用的交付。

M2：完整创作/画布工具、批量生成或复用策略、工作目录新建、音频导入与现有声音业务工具；复用共同服务，保持版本/预算/未知提交语义。

M3：时间线编辑、渲染、导出恢复、制品和连续记忆工具；完成真实客户端端到端验收，并提供客户端配置示例与 MovieAgent 操作 Skill。

实施者可决定：SDK 的兼容稳定版本、工具具体命名、包布局、本机管道细节、日志表字段、分页/有界 wait 参数；需在 plan.md 固定并验证。不能自行扩大到远程引擎或拆成另一套数据库。

用户已确认整体设计与分批方向，M1按批准范围完成；完整 MCP 继续按M2/M3安排。默认不开放任意 URL 导入、不从聊天内容推断新的付费授权。

## 10. 来源与变更记录

MovieAgent 源码根目录：`D:/movieAgent/libtv-studio/`。第2节记录实施前源码核查；当前实现与测试依据见本轮验收报告。

- [BeefTV MCP 客户端验收源码](https://github.com/glanderness/BeefTV/blob/4b4ca0626dca478b7ba1aead89fb81f8cc462161/backend/cmd/beeftv/mcp_client_test.go)
- [BeefTV 业务文件接入源码](https://github.com/glanderness/BeefTV/blob/4b4ca0626dca478b7ba1aead89fb81f8cc462161/backend/cmd/beeftv/business.go)
- LibTV 本机参考：`C:/Users/1266/.codex/plugins/cache/libtv/libtv/1.0.0/skills/music-driven-product-ad/references/libtv-production.md`。
- 前置规格：[SPEC-001](../001-character-voice-consistency/spec.md)、[SPEC-002](../002-project-subprojects/spec.md)、[SPEC-003](../003-production-reliability-and-capacity/spec.md)。

| 日期 | 状态 | 记录 |
| --- | --- | --- |
| 2026-11-02 | Draft 0.1 | 源码核查与方案草案；确认外部图片接续视频的生产策略缺口；未改产品代码、未安装依赖、未调用模型 |
| 2026-11-02 | Draft 0.1 审阅 | 独立 builder check 未发现重大未决项；见 [review.md](review.md)。未获用户设计批准、未进入实施 |

| 2026-11-02 | Approved / M1 Implementing | 用户确认开始开发；采用本目录 plan.md，后续阶段未开始 |

| 2026-11-02 | M1 Implemented / local verified | 核心938、界面111、媒体30、最终桌面3全部通过；2Important修复、2Minor延期。M2/M3与真实服务未验 |

M1验收对应8.1的图片闭环；第8项时间线/渲染/导出MCP属于M3。来源与回执存主进程专用日志，不随项目备份；暂存副本为恢复保留。
