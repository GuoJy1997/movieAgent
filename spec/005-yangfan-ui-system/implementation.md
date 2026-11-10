# SPEC-005 实施记录

更新：2026-11-08。规格状态 Approved；工程实现已落地，本机验证已完成下列范围；完整验收仍有未验项。

## 交付入口

- [本机交互预览](http://127.0.0.1:4175/yangfan-preview)：真实产品组件配隔离 fixture，不连接用户项目或模型服务。
- [Windows 解包运行版](../../libtv-studio/apps/desktop/release-spec005-ui/win-unpacked/MovieAgent.exe)：本轮最终源码打包，未制作 NSIS 安装器。
- [视觉 QA](../../libtv-studio/design-qa.md)及[实际首页](../../verification/2026-11-07-spec005-ui/screenshots/home-final.jpg)。
- [规格](spec.md)、[原计划](plan.md)。本记录是原计划实际执行情况，不能用规格批准代替验收。

## 实施决定

1. 在现有 codex/desktop-foundation 分支工作。该分支已有大量未提交功能，未重置、迁移、批量提交或覆盖用户数据。本轮原文件副本保存在 verification/2026-11-07-spec005-ui/before，修改清单为同目录 touched-files.txt；清单可包含重复修改记录。
2. 改现有 React/Electron 产品，没有另建演示产品或重写引擎。内部 app.setName、appId、profile、包名、可执行文件名与业务合同继续兼容，展示名称改为羊番TV。
3. 原创羊羊 PNG 作为品牌资源；常规图标采用锁定的 @phosphor-icons/react 2.1.10（MIT）。Windows 系统字体用于正文，重点标题使用粗斜体。未购买字体或调用图像模型。
4. 复用业务控制器与原审批流程，按需要拆出展示层。实际拆分路径以源码为准，没有机械创建计划里每一个建议文件。
5. 首页仅展示当前引擎可见项目；独立短剧目录通常是单卡。普通 Agent 仍返回文字提案。未编造其他项目、进度、媒体候选或跨目录封面服务。

## 任务完成情况

| 任务 | 本次实现 | 状态 |
| --- | --- | --- |
| 1 基础组件 | 黑蓝 token、蓝紫侧栏、Phosphor 图标、Brand 与基础控件 | 工程完成 |
| 2 导航壳 | 五主入口、底部任务/设置、展开/紧凑导航、scope 与草稿保护、全局页面返回 | 工程完成 |
| 3 首页 | ProjectHome、ProjectGallery；手动/自动/暂停/减少动效、预览与工作项目分离、真实分集与任务 | 工程完成 |
| 4 Agent | 连续 Composer、引用/模式/技能/模型/偏好、输入法与快捷键、明确新建会话、准备/批准/采用 | 工程完成 |
| 5 对话/画布 | CreativeWorkspace 共享 Agent 实例，窄窗辅助面板、同 scope 草稿与跨集保护 | 工程完成 |
| 6 资产 | 来源与类型独立筛选、大预览/版本详情、明确固定引用、缺失媒体门禁、原导入/回收及实体声音入口 | 工程完成 |
| 7 制作 | 资产列、可编辑镜头信息、采用版本预览、候选与历史、底部镜头条、对白路径与窄窗切换 | 工程完成 |
| 8 成片 | 时间线选择与返回、紧凑预览工具、制品页、独立成片助手；沿用四轨与恢复合同 | 工程完成；容量 UI 全边界人工覆盖未完成 |
| 9 全局页面 | 设置分组、MCP/维护/模型入口、启动器与窗口展示品牌 | 工程完成 |
| 10 验收 | renderer、集成、类型、构建、解包验证、Electron、浏览器视觉比较 | 本机范围已验证；完整 AC-10/11/12 和用户/真实服务验收待完成 |

## 关键源码

- [App](../../libtv-studio/apps/desktop/src/renderer/App.tsx)、[WorkspaceShell](../../libtv-studio/apps/desktop/src/renderer/features/shell/WorkspaceShell.tsx)、[统一样式](../../libtv-studio/apps/desktop/src/renderer/yangfan.css)。
- [ProjectHome](../../libtv-studio/apps/desktop/src/renderer/features/projects/ProjectHome.tsx)、[ProjectGallery](../../libtv-studio/apps/desktop/src/renderer/features/projects/ProjectGallery.tsx)。
- [AgentWorkspace](../../libtv-studio/apps/desktop/src/renderer/features/agent/AgentWorkspace.tsx)、[AgentComposer](../../libtv-studio/apps/desktop/src/renderer/features/agent/AgentComposer.tsx)、[草稿存储](../../libtv-studio/apps/desktop/src/renderer/state/agent-composer-draft.ts)、[CreativeWorkspace](../../libtv-studio/apps/desktop/src/renderer/features/creation/CreativeWorkspace.tsx)。
- [AssetVersionDetail](../../libtv-studio/apps/desktop/src/renderer/features/assets/AssetVersionDetail.tsx)、[ProductionWorkspace](../../libtv-studio/apps/desktop/src/renderer/features/creation/ProductionWorkspace.tsx)。
- [TimelineWorkspace](../../libtv-studio/apps/desktop/src/renderer/features/timeline/TimelineWorkspace.tsx)、[DeliverablesWorkspace](../../libtv-studio/apps/desktop/src/renderer/features/timeline/DeliverablesWorkspace.tsx)、[SettingsWorkspace](../../libtv-studio/apps/desktop/src/renderer/features/models/SettingsWorkspace.tsx)。

## 独立评审与修复

新上下文代码评审指出并已修复：按目标镜头解析所属剧本、旧库首项目显式绑定、从全局页返回保留时间线、历史中打开对白、创作模式展开新会话表单、旧集迟到的时间线创建与首页会话创建不能导航到新集。修复隔离令牌时发现正常首页交接被误拦截，已分离导航生命周期并补正向测试。修复前失败与修复后通过日志均保留；没有宣称评审者再次出具全量无问题结论。

## 验证结果

日志统一在 [verification/2026-11-07-spec005-ui/logs](../../verification/2026-11-07-spec005-ui/logs/)。

| 检查 | 结果和证据 |
| --- | --- |
| 基线 | typecheck 通过；旧 renderer 24 文件 / 111 项通过。使用已安装 Chrome，默认 Playwright 浏览器未安装不计为产品失败 |
| renderer 全量 | 34 文件 / 127 项通过：[final-renderer-1.txt](../../verification/2026-11-07-spec005-ui/logs/final-renderer-1.txt) |
| 后续修复覆盖 | 6 文件 / 28 项通过：[final-delta-renderer.txt](../../verification/2026-11-07-spec005-ui/logs/final-delta-renderer.txt)；最后首页交接 2 文件 / 7 项通过：[home-handoff-green.txt](../../verification/2026-11-07-spec005-ui/logs/home-handoff-green.txt)。这些与全量有重叠，不累加成一次全量通过 |
| 集成 | 首次全量 132 文件 / 938 项中，122 文件通过、924 项通过；10 文件出现超时与临时文件占用等失败。对应 10 文件降低并发后 62 项全部通过：[首次](../../verification/2026-11-07-spec005-ui/logs/final-integration.txt)、[定向重跑](../../verification/2026-11-07-spec005-ui/logs/integration-failure-recheck.txt)。不是一次全绿的全量运行 |
| 类型 / 构建 | 最终源码通过：[package-typecheck.txt](../../verification/2026-11-07-spec005-ui/logs/package-typecheck.txt)、[package-build.txt](../../verification/2026-11-07-spec005-ui/logs/package-build.txt) |
| Windows 包 | package:win --dir 成功；中间文件重命名/PowerShell 检测遇到环境问题，打包器后备路径成功。[打包日志](../../verification/2026-11-07-spec005-ui/logs/package-win.txt) |
| 包内验证 | 资源、隔离 preload、Electron ABI、Sharp/媒体运行时通过：[verify-package.txt](../../verification/2026-11-07-spec005-ui/logs/verify-package.txt) |
| 实际 Electron | 新羊番工作区与原目录工作区测试，共 2 文件 / 3 项通过：启动、创建项目、设置返回、重开与内部身份/隔离断言。[electron-spec005.txt](../../verification/2026-11-07-spec005-ui/logs/electron-spec005.txt)。未运行完整历史 Electron 套件 |
| 浏览器 | 内置浏览器检查真实组件与隔离数据；1536×1024 页面、800×560 画布/制作及侧栏；最终捕获未见控制台错误。[视觉 QA](../../libtv-studio/design-qa.md) |

后续只修改文档及截图比较材料，未再次全量运行已经适用的成功检查。

## AC 覆盖与剩余项

| AC | 证据 / 状态 |
| --- | --- |
| 01 入口 | 导航、全局页、制作、成片测试及源码映射通过；保留原声音/记忆/MCP/回收入口 |
| 02 品牌 | 浏览器截图及 Electron 标题验证通过；用户视觉验收待定 |
| 03 画廊 | home/navigation 的隔离多项目与单卡测试；浏览器交互检查；没有跨目录聚合 |
| 04 Composer | composer、agent-budget、home-session；预算/模型、IME、快捷键；原契约边界继续有效 |
| 05 批准/采用 | p3-acknowledgement、assets、production 与原集成合同测试；没有真实付费执行 |
| 06 scope/草稿 | draft-navigation、subprojects、review-regressions；迟到结果与正向交接分别验证 |
| 07 资产 | yangfan-assets、原资产集成、浏览器版本预览；不可用文件门禁 |
| 08 制作/声音 | yangfan-production、原图复用/对白/声音集成；真实试镜与生成质量未验 |
| 09 成片 | yangfan-finish、timeline 原测试与 finish-agent 集成；三协议和服务端容量边界保持，未新增完整 32/33 素材 UI 手工操作覆盖 |
| 10 可访问性 | 焦点样式、语义按钮、IME、键盘与减少动效有实现及局部测试；全页面键盘/回焦点和对比度自动测量未完整验收 |
| 11 尺寸 | 1536×1024 与 800×560 浏览器及实际 Electron 启动覆盖；未遍历所有指定内容视口和 Windows 100%/125%/150% DPI |
| 12 性能 | 画廊暂停/隐藏/减少动效行为有实现；未做旧版与新版同机同数据的持续掉帧/内存测量，不标通过 |
| 13 兼容 | 内部身份不改、目录及重开 Electron 测试、原恢复/回执集成；未做干净机器安装升级或用户真实目录迁移 |

未调用真实模型，未验收真实视频/音频质量或人工听感；没有新增云部署、安装器改名、付费请求或用户数据迁移。预览图片仅在测试 fixture 中引用；实际产品使用真实固定媒体。截图不证明真实服务成功。

## 2026-11-08 首页保真修正（用户指出后）

先前单项目截图未能证明用户要求的四海报立体画廊，首页视觉检查不足，本节替代原记录中的首页验收结论。

- 原因：交付 fixture 仅一项目；ProjectHome 还只给工作项目读取封面，其他项目一律默认图。新增失败测试复现后，修为各项目自己的分集/资产只读查询，并优先居中当前工作项目。
- 预览现在含四个独立演示项目及其封面。素材从用户已选图提取、透视还原，仅在隔离预览中使用，不向真实项目写入。实际产品保持查询到的真实项目数量；尚未新增跨目录聚合。
- 画廊实现中央横幅、两侧透视与轻微侧倾、反射、420ms转场；每6秒切换，箭头/圆点/键盘/拖动、悬停/焦点/隐藏/减少动效保护。拖动结束不再被后续click改回原卡。
- 首页校正226px侧栏、36px标题、17–20px工具/正文、150px连续Composer、分集图片与短选中线；取消首页额外顶层tabs，保留分集与项目记忆入口。
- 针对性测试：修复前 gallery-red.txt 中新增封面测试失败（原两项通过）；修复后 scope/交接相关7项通过，最终 home/navigation 2文件6项通过。导航测试相应改为实际点击分集管理入口，未删除能力断言。首次Chrome自动化启动异常，改用已安装的Playwright headless shell完成测试，未安装新浏览器。
- 类型与构建通过；证据在 verification/2026-11-08-spec005-home-fidelity/logs。浏览器同尺寸对照见同目录 screenshots；最新版首页和Hero对照取代上一轮首页截图。
- 本次更新源代码与运行预览，前一轮 release-spec005-ui 解包产物尚未重打，不能作为本次首页修正的验收包。
- 任务服务不返回百分比，使用真实状态/不确定进度；没有照抄图中的62%/41%虚构进度。镜头数、待审核数继续来自业务，不为图稿硬编码18/6。

## 2026-11-08 海报重制与比例修复

- 用户指出低清与片名裁切。本轮用内置image_gen逐张重制周末出逃、向晚的海、城市留声、逆风而行；[原图与提示词](../../output/yangfan-posters-hd-2026-11-08/README.md)保存在工作区。
- 原因是从整张UI截取的小图，以及卡片在各位置改变宽高比后使用cover。现在统一2:1完整图面、contain，旋转/等比缩放形成侧面；Hero调用original而非thumbnail。
- 新增回归覆盖四个选中位置：画面比例恒定、完整包含、只请求原图；修复前失败，修复后该文件5项通过，typecheck通过。日志在verification/2026-11-08-poster-quality/logs。
- 浏览器逐张居中、等待转场结束后拍摄；原图与渲染同输入对照见同目录screenshots/all-center-comparison.jpg。四张片名完整可见，naturalWidth/Height均1774/887，控制台无error。浏览器截图为工具返回的有损JPEG，仅原PNG文件作为清晰度交付源。
- **原生2K尚未达成**：首轮请求2048×1024，重试3072×1536，内置工具均返回1774×887。未擅自切换CLI/API、未简单放大或宣称2K。此分辨率限制仍待解决。
- 调用的是用户明确授权的内置图像工具；没有运行项目内部的真实生成流程或写入用户创作数据。此次仅更新源代码/预览，先前桌面EXE未重打。


## 2026-11-08 封面风格 V2

用户保留《逆风而行》，指出其余封面不像真人短剧，尤其《城市留声》。已用内置image_gen重做三张：城市采用真人音乐都市剧主角，向晚的海采用双人关系近景，周末出逃采用青春群像层级。源文件、完整提示词及当前清单见[海报资源](../../output/yangfan-posters-hd-2026-11-08/README.md)。保留V1以便回退，预览仅切换到V2路径。

仅修改演示素材与预览静态路径白名单，未修改画廊逻辑、样式或真实项目数据。浏览器检查三张居中状态、完整片名和实际加载地址，naturalWidth/Height均1774×887，object-fit为contain；控制台error为空。证据：verification/2026-11-08-poster-quality/screenshots/home-{weekend,city,sea}-v2.jpg。原生2K限制仍存在，之前5项画廊回归与类型检查适用于未改变的逻辑，本轮素材替换未重复运行全量测试或重打EXE。


## 2026-11-08 画布引导与工具

用户授权先调研再实施，规格见本需求的画布补充；[调研与来源](canvas-research.md)、[实施计划](canvas-plan.md)。本轮基于现有未提交工作树增量修改，未重置或覆盖创作数据。

### 已实现

- 空白画布的角色/场景行动卡、实际实体/画布进度、素材/文字入口；可跳过并从工具栏重开。
- 创建角色/场景复用 EntityEditor，保存真实实体修订；新增画布节点后选中、定位并提示下一步。
- 常驻添加、设定、素材、快捷工具、声音、工作流、引导；独立缩放、适应、小地图、连线控制。原历史、撤销、重做与生成批准路径保留。
- 六类人物/场景预设，按图像输入/输出能力选择模型；固定参考版本、复制文字设定后创建可编辑节点，不自动调用模型。
- 工具草稿的关闭/返回/跨页保护和会话内保留；缺参考/模型、参考失效、依赖查询失败均显式说明并阻止不完整提交。失败创建保留输入。
- 采用 UI参考.md 中 Aceternity 的布局方向，独立 React/CSS 实现；Tabler SVG 与完整 MIT 许可随新包交付。

源码：CanvasWorkspace.tsx、CanvasGuide.tsx、canvas-tools.ts、CanvasIcon.tsx、CanvasViewport.tsx、canvas-guide.css；直接调用方 CreativeWorkspace、EntityWorkspace；打包配置仅增加图标许可资源。没有修改存储合同或添加依赖。

### 本轮验证

| 检查 | 真实结果 |
| --- | --- |
| 引导/工具回归 | 初始新增功能3项失败，随后实现；独立审阅提出草稿丢失、可选参考静默丢失、依赖读取错误混同三项，新增3个回归均先失败、修复后通过 |
| renderer | canvas-guidance、dialogue-canvas、yangfan-creative-workspace 三文件9项通过；随后新增的场景保存/失败草稿恢复1项定向通过（其余7项跳过）。合计10个不同用例，不写成一次全量运行 |
| 类型 | tsc --noEmit -p tsconfig.base.json 通过；之后仅增加一项测试、调整局部 CSS、打包配置和文档，产品 TS 逻辑未再改变 |
| 视觉 | 真实 React 组件的1536×960及800×560截图已检查；修复窄窗横向收缩与按钮下缘遮挡，几何断言确认两创建按钮位于引导区内、视图栏位于窗口内，无横向溢出；工具面板截图已检查 |
| build | 最终局部 CSS 修正后 npm run build 通过；第三方 zod 注释位置有 Rollup 提示，不影响退出码 |
| package | npm run package:win -- --dir --config.directories.output=release-spec005-canvas 通过。目录重命名与 npm 子进程检测遇到环境问题，打包器的复制/依赖遍历后备路径成功 |
| 包内校验 | verify-package --dir apps/desktop/release-spec005-canvas/win-unpacked 通过：资源、4个隔离preload、CSP、Electron45/ABI150、SQLite、Sharp和媒体运行时；图标许可资源内容可读取 |
| 实际新包 | [package-smoke-result.json](../../output/jimeng-canvas-research-2026-11-08/package-smoke-result.json)通过：本机引擎、新建短剧/指定分集、空画布引导、真实角色/场景保存、缺模型门禁、renderer隔离、项目/library重开。使用独立测试目录、空模型配置；冒烟脚本按实际分集页与紧凑布局修正后通过 |

截图：[桌面画布](../../output/jimeng-canvas-research-2026-11-08/yangfan-canvas-desktop.png)、[工具面板](../../output/jimeng-canvas-research-2026-11-08/yangfan-canvas-tools.png)、[800×560](../../output/jimeng-canvas-research-2026-11-08/yangfan-canvas-800.png)、[真实打包画布](../../output/jimeng-canvas-research-2026-11-08/packaged-canvas.png)。隔离验收脚本保留在同一输出目录。

### 本机交付与未验范围

新解包目录为 libtv-studio/apps/desktop/release-spec005-canvas/win-unpacked；根目录 启动MovieAgent.cmd 已指向该版本，保留原应用模型配置参数、启动器模式、内部身份和旧版本目录。已运行的旧窗口需要先保存并退出，再使用该入口启动。

本轮不标记整个 SPEC-005 全部验收通过：没有真实模型请求，六工具真实生成质量未验；没有重跑全量历史 Electron/集成测试，没有覆盖所有 Windows DPI、性能或干净机器安装。内存工具草稿不保证跨应用退出保留。媒体包为本机测试使用，未主张可公开分发。

## 2026-11-08 Circular Carousel 适配

用户批准采用 React Bits Circular Carousel 为基础。已读取官方 TS/CSS registry，保留原始参考与完整许可，并从源码派生本地组件：复用弹簧积分、指针采样惯性、最近角度聚焦和可见性 RAF 生命周期；根据已选首页改为四海报展开前弧，不直接套用默认圆筒预设。

- 源码：libtv-studio/apps/desktop/src/renderer/features/projects/react-bits/CircularCarousel.tsx、CircularCarousel.css、LICENSE.md、README.md；ProjectGallery 保留作用域、原图加载、每6秒自动切换、暂停、悬停/焦点/隐藏/减少动效保护及明确进入动作。
- 拖动过程跟随指针，松手吸附；点击切换、箭头、圆点保留。2:1完整原图，片名保留在图中。未新增依赖、模型调用或数据迁移。
- 验证：新增跟手拖动检查在旧代码失败；最终首页6项通过，typecheck通过。覆盖选择与工作集隔离、作用域、自动与暂停、单卡、减少动效、800px窗口、原图/比例、拖动与吸附后再选择。首次验证受同时编辑中的CanvasIcon语法错误影响；该文件修正后重跑通过，本任务未编辑该文件。
- 浏览器：1536×1024与原首页图同输入对比，四张海报标题可读、中心片名完整，点击城市居中仍保留EP03；控制台error为空。证据在 verification/2026-11-08-circular-carousel/screenshots/home-final.jpg 和 logs。
- 仅源代码与运行预览更新，未重打Electron EXE。历史原生2K缺口仍为1774×887，未在本轮解决；未把本轮轮播通过视为整个SPEC或真实服务验收。
## 2026-11-09 Pill Nav 适配（2026-11-08 开始）

- 已将 React Bits Pill Nav 的前后边缘弹簧积分适配为受控共享组件 packages/ui/src/pill-nav/PillNav.tsx；来源、MIT + Commons Clause 完整许可同目录保留，无新增依赖。
- 接入 WorkspaceShell 页内标签、SettingsWorkspace 设置分类、ProjectHome 创作入口。保留各自 onNavigate / timelineNavigate / go 回调，首页仍隐藏额外顶部工作区 tabs；左侧主导航不变。
- 深灰胶囊、44px操作区、浅灰正文、仅选中项显示右侧蓝紫主题图。原创 sail / film / orbit 三张透明图由内置 image_gen 生成并存入组件 assets；完整提示词在 assets/prompts.json。未使用即梦品牌素材。
- 检查：导航9项、首页6项、设置3项，共18项通过；类型检查通过。新增键盘测试在旧组件失败，新组件通过；另覆盖取消导航、减少动效定位、1366/800宽度对齐和侧栏跨页稳定性。没有重复运行全量套件。
- 视觉：1536×1024下检查首页、创作和设置；证据在 verification/2026-11-08-pill-nav/screenshots。实际隔离预览已更新，没有请求真实模型、修改创作数据或重新打包Electron。尚未进行完整DPI、性能及用户视觉验收；历史原生2K海报缺口不变。
