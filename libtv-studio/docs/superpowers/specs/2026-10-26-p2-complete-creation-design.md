# P2 完整基础创作与软件模型配置同步

2026-10-26。用户已批准完整 P2，并明确纳入页面模型配置与软件目录 `config/models.json` 同步，要求直接实施。基线 e7731c8；现有目录项目、图片任务、MiniMax 文生视频、资产保存、基础画布和原件恢复继续复用。

## 完成范围

1. 文本模型生成可持久保存、再次作为输入的文本；图像模型使用参考图片生成；MiniMax 图生视频支持首帧、首尾帧和参考图片。
2. 页面管理软件全局模型配置，能增加、编辑、删除、设置参数、更新 Key、重新加载文件；新项目和已有项目均能导入相同配置。项目内不可变运行快照与全局默认配置分开。
3. 资产名称、标签、检索、版本列表、生成结果另存为新版本、软删除和恢复；历史固定引用仍可访问。图片、视频和文本都能查看与加入画布。
4. 类型化画布连线；运行当前节点、运行所需上游、运行选定子图。先预览冻结计划与费用范围，一次批准后按依赖顺序运行；失败阻断依赖分支，独立分支继续；停止不再创建新任务；恢复不重复生成。
5. Windows 本机桌面实际可运行，旧项目迁移、原有图片/视频流程和新的文字→图片→视频链有确定性端到端证据。真实服务验收与 fixture 验证分别说明。

不扩展到 P3 Agent/结构化剧本分镜/角色实体、P4 音频时间线成片导出、P5 远程部署。文本生成使用有明确长度上限的非流式 Chat Completions 子集，不伪装流式输出或工具调用。图像编辑是参考图驱动生成，不包含遮罩绘制与局部重绘 UI。

## 模型与输入协议

- 保留 `openai-image-v1`、`minimax-video-v2`；新增 `openai-chat-v1` 与 `openai-image-edit-v1`。实际能力由适配器声明，不根据模型名称猜测兼容性。
- Chat Completions：连接 Base URL 下 `/chat/completions`，一次 user 消息，`stream:false,n:1`，支持 `max_tokens` 整数 1–8192（默认1024）。未知参数拒绝。生成输出为纯 UTF-8 文本，单个原件最多1 MiB；界面以转义纯文本展示，不执行模型 HTML。文本价格默认未知，沿用明确有限额度与未知费用确认。
- 参考图生成：`/images/edits` multipart/form-data，`model,prompt,n=1,output_format=png`，图片数组 `image[]`；输出继续复用已有图像结果解析/原件收存。已有 size/quality 子集保持兼容。
- 参考输入最多4张，PNG/JPEG/WebP，单张<=10 MiB，总计<=32 MiB，按有序角色+固定 MediaReference+原件 hash/大小/尺寸/MIME 冻结。请求体上限48 MiB仅用于含图片的明确协议；既有无图128KiB和下载图32MiB/视频64MiB限制保持。
- MiniMax 使用已验证的 H3 Highspeed 与原生 v2 submit/query。图像通过 `image_url.url` data URI，角色 first_frame/last_frame 或 reference_image；首尾帧与参考模式互斥，首/尾各最多1张，尾帧单独模式可拒绝并明确提示。首帧模式 ratio=adaptive；文生视频禁止 adaptive。图片尺寸256–5760，宽高比0.4–2.5。输入不符合时拒绝并提示，不静默裁切/压缩用户素材。时长4–15秒、768P不变。
- 图片字节只从当前资料库固定原件读取，在受控 engine/main 通道内组装发送；renderer/通用命令不接受任意磁盘路径、file URL、远程参考 URL 或任意 HTTP。每次发送前复核冻结 hash，秘密只在主进程 vault 范围中使用。模型参数、Key版本、输入版本变化不改写已受理任务。
- PreparedGeneration 增加可选 `referenceImages`，缺省视为空，以兼容已有持久快照。每项 `{role:'reference'|'first_frame'|'last_frame',ref:MediaReference,hash,mime,byteLength,width,height}`。外部 prepare 输入只提交 `{role,ref}`，元数据由引擎解析。Canvas generation content 增加可选 `referenceImages`；旧 FixedTextInput 继续可用。
- 文本原件复用对象区/收存日志，mime=text/plain，width=height=0。普通媒体嗅探不能把任意未知文件当文本；只允许显式文本生成或显式 .txt/.md 导入且严格UTF-8/NUL检查。文本 hash、版本、历史与图片视频同等持久。

## 软件配置文件同步

- 配置界面以添加文本/图片/视频模型为入口，主要连接字段为 Base URL、API Key、模型 ID；名称可选自动生成，条目ID内部生成并保持稳定。接口适配器属于内部配置，选择器与可选参数、价格、私有端点选项放入默认折叠的高级设置。新建文本默认 openai-chat-v1，图片默认 openai-image-v1，视频默认 minimax-video-v2；明确提示当前支持的兼容范围。高级设置仍可选择参考图生成；编辑已有条目不能因高级设置折叠而重置其适配器或参数。不根据模型名猜任意协议，也不发送付费请求试探兼容性。此项来自用户对 OpenCode 配置体验的明确反馈。
- 文件唯一来源仍是软件 `config/models.json`；项目下不创建另一份模型配置。V1读兼容；用户主动保存时写V2。V2 provider保留原7字段，增加明确 adapterType、parameters（默认参数值）、pricing（沿用已有价格联合类型）；kind支持text/image/video。最多32条，文件64KiB上限，重复ID、能力与参数矛盾、无效URL、秘密落入公开字段均拒绝。
- 普通工作台只能得到脱敏配置与 `hasKey`，不返回 apiKey。新增/编辑通过独立受限模型配置窗口完成，Key只在该专用窗口输入，留空表示保留原Key；清除必须显式操作。保存前后反馈明确区分“文件已保存”和“当前项目已载入”。
- 主进程固定文件路径、严格输入校验、文件版本前置条件、跨进程同路径写入锁、同目录临时文件+fsync+原子替换；冲突拒绝覆盖，保留用户草稿。应用写入者之间互斥；保存前检测外部编辑，失败不损坏旧文件。锁只由拥有者释放，死进程锁恢复不能按年龄盲删活锁。
- 文件成功写入但导入失败可重试导入，不回滚或覆盖较新配置；重试不得不断创建重复配置/凭据版本。已有运行使用冻结版本。删除全局条目不销毁历史项目的连接、Key版本或输出；旧项目保留历史配置并明确标注来源，新项目不再导入删除条目。
- 全局配置默认参数与项目预设用途分开：文件管理全局默认，项目可保存独立预设。文件管理的连接/模型编辑入口引导到全局编辑器，避免工作台“保存”后又被文件覆盖。已有手工项目配置不强行迁移/丢弃。

## 资产管理

- 元数据有独立 revision；名称<=200字符，标签最多20个，每个1–32字符，trim去重。改名/标签/回收站操作采用 expectedRevision，命令去重和事件沿用现有机制。
- asset.search支持名称、标签、mime类别、active/trash、latestOnly；空payload保留旧调用契约。UI默认最新版本与有效资产。asset.history返回同一asset的固定版本、来源、时间与可读元数据。
- 已有 asset.saveArtifact 的assetId/expectedVersion用于新增版本；补UI选择与冲突提示。导入新版本通过明确目标版本前置条件，不能改写旧版本或自动移动画布引用。
- 软删除隐藏常规列表和新的选取；已有画布/任务固定引用不失效。恢复保持身份与全部版本，不物理删除原件。P2不新增永久清空/GC，避免超出已批准的可恢复操作。
- 导入选择器支持现有图片、MP4和显式TXT/MD。本地复制进资料库，路径不进入renderer。资产拖入/选择进画布引用固定版本；切换到最新版须显式选择。

## 画布与执行计划

- 增加 `CanvasEdge`：id、sourceNodeId/sourceIncarnation、targetNodeId/targetIncarnation、sourcePort='output'、targetPort='prompt'|'reference'|'first_frame'|'last_frame'。输出类型text/image/video由节点或模型能力决定；prompt只接受text，其余只接受image；不支持的视频输入必须拒绝。边增删采用画布观察版本前置条件，拒绝自环、环、跨库、悬空、重复/超限端口；节点删除同步移除边且撤销不复用旧incarnation。
- 继续兼容旧 text/image/generation节点；新增通用media节点承载固定文本/图像/视频资产。快照增加edges；旧存储缺省空边。UI提供拖线以及可访问的显式来源/端口选择。
- 运行请求 `workflow.prepare`：canvasId、mode=current|upstream|selection、nodeIds、executionOwner、runId。current只执行一个目标，读取明确选定的固定上游输出；缺失或过期时提示并拒绝，不自动发起上游。upstream执行目标所需上游闭包；selection仅执行所选子图，外部输入必须有明确固定产物。不因相同参数自动缓存生成。
- PreparedWorkflow冻结canvas revision、每个node incarnation/semanticRevision/selectionRevision、配置快照、文本内容、固定输入或StepOutput依赖和执行数量；最多32个生成步骤、128条计划内依赖，拒绝混合币种计划或要求先统一币种。显示每步估价/未知与合计风险额度。批准后变更范围/模型/输入需新计划；纯布局移动不影响有效性。
- `workflow.approveAndEnqueue`绑定plan hash/owner/runId及每步有限额度和单一项目预算；明确一次批准涵盖依赖产出输入，不反复弹每节点批准窗。等待步骤额度计入工作流总预留，不能被其他单次任务/工作流重复占用；转入实际任务时转移而非双计。提交不明仍占用，未提交停止/阻断可释放。供应商账单仍未知。
- 每步生成仍由现有 generation/task scheduler负责；工作流协调器只消费durable状态并将StepOutput解析成固定artifact后创建下一步冻结请求。稳定work/run/step命令ID和唯一约束确保重启/ACK丢失不重复排队。不能重新遍历运行中的活画布来替换批准的输入。
- 工作流状态prepared/running/stopping/succeeded/failed/stopped/needs_attention；步骤waiting/queued/running/succeeded/blocked/failed/stopped/needs_attention。未知提交阻断其依赖并提示核实原任务；独立分支按批准范围继续。停止与下一步创建在同一所有者/事务边界排序，停止后不新增生成；已受理云任务允许查询/收存并明确无法撤回。
- 语义内容、连接、输入选择、模型变化将下游标为stale；布局不影响。历史一直可读，迟到结果仍遵守现有RunBinding/CAS，不能覆盖人工选择。已批准计划可完成其冻结输入，结果绑定不再匹配时只进历史。

## 数据迁移、验证和交付

按顺序新增迁移：资产元数据8、图边9、工作流10（配置写文件和文本对象不必变更DB表）。集中当前schema常量，更新握手/维护/验收脚本，保留旧迁移与自动备份恢复边界。迁移需用schema7真实fixture验证，旧视频/图片原件hash不变。

每个任务先针对性RED/GREEN，再相关回归；最终完整integration/typecheck/build/package/真实Electron一次，失败后仅针对变化复跑。使用当前未签名Windows包和真实子进程/SQLite/本机HTTP fixture，覆盖完整文本→图片→视频，以及停止、恢复、坏输入、跨库、文件冲突、资产回收、历史不变、无重复POST。不以UI假数据代替业务。

当前只有MiniMax视频配置，P2开发不默认产生额外费用。文本、图像和参考输入真实服务验收取决于用户补齐模型与测试范围；缺失时完成开发和本地验证并明确未验证边界。以前provider任务456268409471408及独占验收记录必须保留，不再次提交旧样例。保持原工作目录/分支，不能全局结束Node/Electron；打包前确认运行窗口，必要时用独立输出目录而不强关用户项目。

官方接口依据（2026-10-26读取）：[Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[Image edits](https://developers.openai.com/api/reference/resources/images/methods/edit)、[MiniMax v2](https://platform.minimax.cn/docs/api-reference/video-generation-v2-create)。协议资料本地缓存 test-results/p2-research/；实现仍须依此验证字段，不能从能力名称推断API。
