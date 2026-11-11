# P3 创作 Agent、剧本分镜与桌面交付验证

日期：2026-10-26–27（含最终集中修复和交付复核）。Task4 基线 `45938b0`；最终修复提交 `25513e9bb8fce30436036c9be82c153bb8f18272`。运行包使用 schema14；现有用户工作台 PID9268 与 schema10 资料库保持原样。没有调用真实模型、读取用户模型配置/Key或修改旧发行目录。最终复核通过后，控制器仅将外层启动脚本中的程序路径切换至 `release-p3`；原参数及配置路径保持原样。

## 已实现

- 新增「创作 Agent」「剧本分镜」「角色场景」入口，复用现有深色组件。实体、剧本/场景、镜头使用中文表单和明确保存基准修订；查询/事件刷新不替换本地草稿；历史可读、冲突可见。
- Agent 会话/模式/版本化模板/文本预设/上下文/固定素材/输出 token 预算；复用财务表单，通过 `agent.approveTurn` 批准单次文本请求。展示可读提案、部分镜头选择及依赖、采用回执、原任务、失败/无效/未知/停止状态。不由 mount 提交，不显示合成思考进度。
- 镜头制作预览显示固定父剧本、场景、镜头与实体修订、实际参数覆盖；布置到画布后严格 `workflow.prepare → shots.attachWorkflow → workflow.approveAndEnqueue`。已准备/关联计划可重新打开；停止使用既有 P2/production gate。
- 镜头结果直接预览图像/视频、原任务、生产和输出历史、人工选择及收存诊断。绑定画布节点不能另改正文，提供镜头编辑入口。原输出修订从固定媒体引用匹配生产历史，未知来源明确标注，人工选择不把旧结果伪装为新修订。
- `window.studio.exportCreation({projectId,scriptId,revision,format})` 是唯一新增桌面能力。主进程验证当前目录项目/资料库绑定，读取引擎 canonical creation snapshot，并读取镜头所引用的精确不可变实体历史；不接受 renderer 内容、任意路径或文件名。写入固定 `exports/creation`，文件名包含剧本 ID、修订和随机导出 ID，使用 `wx` 独占创建。每级目录验证普通目录、realpath 和无链接，拒绝 junction、现有文件/硬链接、跨项目及过期剧本修订。JSON schemaVersion1 / Markdown 上限 4 MiB。
- `engine-host` 从旧 P2 返回类型列表改为共享查询类型校验器；P3 查询可读，跨类型响应仍拒绝。项目文件夹/启动器操作失败在导航栏下方显示。

## 验证证据

涉及引擎/桌面的测试使用临时资料库、临时 user-data、显式 fixture/空 `--model-config`。模型 HTTP 仅为 127.0.0.1 fixture；视频原件使用仓库 fixture，通过已有 ArtifactSource 存入临时库。最终表单检查使用独立 headless Chromium 挂载真实 React 页面，只替换 runtime 的命令/查询边界并延迟回执；不启动 Electron、不打开资料库、不请求模型。

1. 集成稳定后完整核心套件运行一次：36 文件 / 493 测试通过（23:13:27，38.38 秒）。随后仅运行受影响的检查。
2. focused creation-export / shot-production / agent-recovery：34 项通过。包括恶意未选 asset alias 经真实 harvesting 得到 INVALID 且无创作写入；scene/shot/script 关系与 operations 类型/引用的畸形 DTO 拒绝。
3. host 查询边界回归 + command-delivery：23 项通过；验证 P3 响应、错类型响应、错误 launch、无效查询及回执恢复。
4. 扩展导出 / host 查询 / 原输出修订显示 helper：3 文件 / 8 项通过。覆盖同名已有文件及硬链接不覆盖、junction 不逃逸、历史实体 v1 不替换为当前 v2、Markdown、缺失目录和未知输出来源。
5. `tsc --noEmit -p tsconfig.base.json`、electron-vite build、electron-builder `--config.directories.output=release-p3` 通过。
6. 打包 Electron 最新行为验收（23:31:43，32.90 秒）：P3 全流程 + impacted IPC，2 文件 / 3 项通过。普通控件完成启动器新建/打开、手工实体/剧本/场景/镜头、鼠标滚动、草稿刷新保留、一次文本提案及部分采用、图像→首帧视频、实际视频解码、人工选用历史、绑定节点只读和编辑跳转、单张图像审批回归、JSON/Markdown 导出、人工编辑冲突拒绝、停止未批准轮次、无效提案无副作用、关闭/重新打开后历史与旧修订提示且无新增 POST。
7. IPC 验证新的窄 preload key、路径参数拒绝、无目录旧库错误、其他窗口/同源子 frame 拒绝。新版 GUI 会话中只有 3 次文本、2 次图像、1 次视频提交；没有额外 mount/reopen POST。

该完整 GUI 运行对应 app.asar SHA256 `8219ef2218d6eb10185d3272a892082dfe5390ca7c8582ff89fafa835f39f6ba`。最终发行包在此之后还包含：中文画幅说明、原始输出修订/未知来源展示映射、跨剧本编辑器状态、已有目标提案审阅 UI，以及本页末记录的回复历史与保存回执修复。输出映射有 focused helper 证据；本轮另有 11 项实际挂载页面检查和 5 项状态/静态渲染检查；最终代码与包通过类型检查、构建和 package verifier。未额外重跑打包 Electron GUI，因此先前 3 项 GUI/IPC 测试与截图只作为对应旧哈希的流程/布局证据，不能声称精确最终 archive 跑过它们。

## 可检查截图

来自上述真实 fixture 会话，目录 `test-results/p3-creation/`：

- `01-manual-editor.png`：镜头中文表单、固定实体、未保存草稿。
- `02-agent-proposal.png`：可读提案与部分镜头采用。
- `03-production-preview.png`：预设名称、中文参数、固定版本披露、明确制作操作。
- `04-results-reopened-1100.png`：1100px 重开后的图片/视频与旧镜头提示。
- `05-creation-overview.png`：顶层剧本/场景/镜头页面概览。

## 边界与未验收项

- 未测试用户真实 Kimi 长剧本结构化输出；既有连通测试不能替代它。未验收真实图像/参考视频整链或真实账单。
- JSON 是受控提案协议，不是自主原生 tool_calls 或递归 Agent。图像/视频上下文仅元数据，文本按预算摘取；输出预算不会自动升高或自动重试。
- 导出是当前剧本与当前镜头的一次快照，精确保存固定实体引用。历史镜头当时的父剧本上下文需从其生产批次追溯；不把当前父正文冒充旧批次内容。不会自动同步起始模板，也不是 MP4 导出。
- 未签名 Windows 本地 beta。干净机安装、签名、跨平台和完整备份恢复未验收。
- 保留 Node SQLite experimental、builder 依赖重复引用/default icon/未签名等已知警告；未将其描述为“无警告”。

## 最终交付标识

最终包使用本机已安装 Electron 45.0.0 distribution 打包（此前仅文案重打包曾遇下载 ECONNRESET；最终没有改变依赖）。`verify-package.mjs --dir apps/desktop/release-p3/win-unpacked` 通过：Electron45 / ABI150 / Node24.22.0 / SQLite3.53.4 / sharp 原生 PNG 探针、四个独立 preload 精确 allowlist 与 CSP。

| 文件 | 字节 | SHA256 |
| --- | ---: | --- |
| `D:\movieAgent\libtv-studio\apps\desktop\release-p3\MovieAgent-0.1.0-local-test-Setup.exe` | 129628069 | `82840a8c600fa372f2e0458c6550cf82f6a37907f4a101c115256df15e406bde` |
| `D:\movieAgent\libtv-studio\apps\desktop\release-p3\win-unpacked\MovieAgent.exe` | 249798144 | `b339ea9baedb388c51e6bdef2b43b2b6adec8434b573de150f105ee4bbfe53ea` |
| `D:\movieAgent\libtv-studio\apps\desktop\release-p3\win-unpacked\resources\app.asar` | 17933813 | `f9ece7b411147bc9f8f7deceeb690bb7e74c11f350596c701d2ccf3aac311728` |

外层 `D:\movieAgent\启动MovieAgent.cmd` 已切换至上表的 `release-p3` 程序，脚本读回一致且目标文件存在。未执行启动脚本，PID9268 继续运行旧包；用户退出旧窗口后使用同一入口打开新版。所有临时 GUI 测试会话已正常关闭。


## Task4 审阅修复一（2026-10-27）

修复基线 `52d81dc`。仅处理 Important1/2：

- 从画布跳到镜头后显式切换剧本，使用原子导航状态清除 focus、镜头编辑和剧本编辑；编辑解析还检查镜头所属剧本，编辑器 key 带当前 scriptId。不会把 A 的镜头放在 B 的场景选择器下。
- 对已有剧本/实体/镜头提案展示捕获版本的字段前后值，包括正文、场景、动作、台词、约束、固定素材和实体修订；空字段/清空引用明确显示。新对象保持原有简单卡片。
- 差异随当前选择及必要依赖更新。场景合并遵循 `agentApplication`：未出现的旧场景保留，部分采用只合并所选镜头需要的场景并保留原正文，显示保留/修改/不变/新增及最终场景顺序，未声称支持场景删除。已采用轮次不重新模拟另一份批准范围，原提案与实际回执明确区分。
- renderer 只使用 contracts DTO 与 React，没有 engine/provider 导入；测试中用 engine 的纯 `agentApplication` 对比合并语义。格式化了修改的 AgentRunCard，并新增格式清晰的 ProposalDiff；其余既有长行函数的整理仍作为 Minor 记录，不扩大重构。

针对性命令 `D:/nodejs/node.exe node_modules/vitest/vitest.mjs run tests/integration/creation-review-presentation.test.ts`：1文件/5测试通过（01:13:08，0.504秒）。覆盖焦点切换/归属、字段清空/引用版本、静态可读渲染、全量/部分场景合并与新对象/未勾选范围。先观察到缺失模块 RED，再实现；SSR 的 classic JSX 转换需显式 React 命名空间，修正后 GREEN。随后 `tsc --noEmit -p tsconfig.base.json`、build、使用本地 Electron45 的 release-p3 builder 和 `verify-package --dir` 全部通过。未重跑493项或 Electron GUI；旧截图只证明此前版本布局，不能当成新差异组件的截图。原有 SQLite/toolchain/未签名警告继续保留。

## 最终集中修复（2026-10-27）

- I1：按 `runId` 关联已持久化的 assistant 消息，在提案区域之外显示正常 REPLIED 和 STOPPED 迟到回复。已有消息时不重复输出提案中的 reply；无消息的旧提案保留 fallback。挂载/重开只读取历史。
- I2：实体、剧本和镜头实际保存处理共用 `useRevisionDraft`。提交捕获草稿、编辑代次与编辑器生命周期；回执只推进已保存基准修订，期间继续输入的内容和「有未保存的修改」提示均保留。没有后续编辑时才显示已保存。显式重载或卸载使旧确认失效，旧 onSaved 不会修改新编辑器选择。Agent 只清除仍等于提交内容的需求；切换会话/卸载会阻止旧准备或创建会话回执打开批准卡或导航。
- M1：表单与请求/PreparedTurn 校验共用 `AGENT_MESSAGE_MAX_LENGTH=4000`，界面显示上限与已输入字符数。
- M2：本轮涉及的实体、剧本/镜头、Agent 表单与异步处理已格式化。未改动的 `ShotProductionPanel.tsx` 仍有长行，保留为非阻断 minor；未扩大组件重构。

先对旧实现观察到 10 项行为 RED（3 个保存丢失后续文本、3 个旧编辑器回调、Agent 清空需求/旧批准卡、长度上限、回复缺失）；随后补充创建会话回调的单项 RED。最初本机默认 Chromium 版本缺失与 Vite 扫描配置错误属于测试装配问题，修正后才记录上述干净行为 RED。

最终命令在 `D:/movieAgent/libtv-studio` 执行：

```powershell
$env:MOVIEAGENT_TEST_CHROMIUM='C:/Users/1266/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'
D:/nodejs/node.exe node_modules/vitest/vitest.mjs run --config vitest.renderer.config.ts
D:/nodejs/node.exe node_modules/vitest/vitest.mjs run tests/integration/creation-review-presentation.test.ts
D:/nodejs/node.exe node_modules/typescript/bin/tsc --noEmit -p tsconfig.base.json
```

分别为 **1 文件 / 11 项通过**（01:49:46，10.45秒）、**1 文件 / 5 项通过**（01:49:57，0.719秒）、类型检查 exit0。独立 renderer 配置避免给原核心套件增加 Chromium 依赖。测试挂载实际页面、操作实际控件，命令 promise 受控延迟；第二次保存断言保留下来的 B 内容携带 `expectedRevision:2`，再确认后才清除 dirty。切换测试还验证实体最新版本归属、剧本选择和新镜头 scriptId。全部页面检查均断言无 POST、无 renderer 错误；回复重开还断言无任何 runtime command。

随后在 `apps/desktop` 使用含 `D:/nodejs`、System32、原生 PowerShell 的 PATH 执行：

```powershell
D:/nodejs/node.exe ../../node_modules/electron-vite/bin/electron-vite.js build
D:/nodejs/node.exe ../../node_modules/electron-builder/cli.js --win --x64 --config.directories.output=release-p3 --config.electronDist=D:/movieAgent/libtv-studio/node_modules/electron/dist
```

两者 exit0，renderer 300 modules。根目录 `D:/nodejs/node.exe scripts/verify-package.mjs --dir apps/desktop/release-p3/win-unpacked` exit0，确认 Electron45 / ABI150 / Node24.22.0 / SQLite3.53.4、sharp PNG、四 preload/CSP。最终身份见上表，替代修复一的 `35bf7b…` archive。日志、package JSON、哈希和详细报告已归档至 [P3 证据目录](p3/README.md)。控制器独立核对全部21个编译文件与 archive 字节一致，3个发行文件的完整 SHA256 和大小与报告一致，见 [交付记录](p3/controller-delivery.md)。本轮没有重复 493 项核心测试、打包 Electron GUI 或真实服务验收。
