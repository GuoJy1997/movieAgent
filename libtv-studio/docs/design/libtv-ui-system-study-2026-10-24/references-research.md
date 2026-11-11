# LibTV Studio：六站组件参考资料核实

研究日期：2026-10-24。此份记录核实公开官方文本、文档和示例源码；没有购买、安装、修改原型或进行浏览器交互。**未看截图，不把文档推断写成视觉观察。**

优先参考工作台基础能力：Obsidian 的外壳与异步状态，Space UI 的分隔面板/数值输入/命令/工具条；PaceUI 提供模型能力选择参考。Libraries 适合少量状态动效。Vanta 和 Planes 的公开预览可学习交互，但不因此获得收费源码。

## Libraries.dev

**定位（官方文字）**：面向 AI 界面的独立交互动效库；提供 React 包、可调 playground 和可复制的代理提示词，付费 Studio 提供更深的配置。不是完整的编辑器组件体系。 [官网](https://libraries.dev)

| 组件 / 公开页面 | 已核实行为 | 对本产品的用法 |
| --- | --- | --- |
| [Image FX](https://libraries.dev/image.html) | WebGL 像素马赛克加载器溶解为真实图片；公开参数含 images、autoReveal 和三种 preset；three 是 peer dependency。 | 生成队列卡片由等待状态过渡到结果缩略图。 |
| [Voice](https://libraries.dev/voice.html) | 沿输入框底部显示随音频电平变化的光带；可以输入 MediaStream 或 0–1 电平，processing 切换为等待动画。 | 语音输入和录音状态反馈，可借鉴输入与处理两种状态区分。 |
| [Bot avatars](https://libraries.dev/bots.html) | Canvas 绘制代理头像；default / working / sleeping 状态，支持暂停、降低动态和离屏暂停；文档列出多种形状及材质。 | 代理身份与忙闲状态可用一个小图形承载，保留可读文字。 |
| [Thinking orbs](https://libraries.dev/orbs.html) | 九种状态的加载指示器，包括 searching、listening、connecting、composing；不同尺寸单独调校，可暂停。 | 借鉴状态的语义划分和 20px 行内版本。 |
| [Border beam](https://libraries.dev/beam.html) | 包裹卡片、按钮或输入框的边缘动效；active 可关闭动画，strength 调节强度，提供明暗主题。 | 只在当前生成目标或一次短暂反馈中使用弱化的边界提示。 |

**取舍**：把动效绑定到真实的录音、连接、处理、完成状态。 同一组件提供小尺寸、暂停和降低动态版本。 直接铺满彩虹描边、粒子和金属效果。 Magnetic UI 实际是手机磁力计及实体磁铁追踪模型，不是鼠标磁吸；不适用于当前 Electron 工作台。

**许可/收费**：官方 Terms 明确：七个公开 npm 效果库采用 MIT，可用于个人和商业项目；Studio、Pro skill、付费预设与配方另有许可，不能作为竞争组件库重新分发。 Pro 页面显示 $9/月、个人 Lifetime $149 一次；Business $29/月。这里只核实边界，不建议购买。 [官方条款/来源](https://libraries.dev/terms.html) [官方价格/目录](https://libraries.dev/pro.html)

首页 FAQ 仍写 five libraries，Terms 已写 seven；数量以当时页面为准，不能把首页摘要视为全部许可范围。Magnetic 模型未单独核实其许可证。

## Planes（.com 候选；.co 未验证）

**定位（官方文字）**：候选 .com 官方站自称 React 的交互层，提供 React / Tailwind / Motion 源码、shadcn registry、MCP 与 llms.txt；包含 UI 控件、AI、媒体和营销组件。 [官网](https://useplanes.com)

**域名缺口**：用户给出的 `useplanes.co` 在 Jina 中 DNS 失败、直接请求 TLS 失败、web open 也不可访问。下表全部来自可读的 `useplanes.com` 候选；尚未验证别名/跳转关系，待用户确认。

| 组件 / 公开页面 | 已核实行为 | 对本产品的用法 |
| --- | --- | --- |
| [Physical Knob](https://useplanes.com/components/physical-knob) | 受控数值旋钮，示例用 value / onChange；官方列出音量、gain、滤波器和亮度等用途。 | 可作为音频或特效参数控件的触感参考。 |
| [Command Palette](https://useplanes.com/components/command-palette) | Ctrl/Cmd+K 打开；命令可分组并链接或执行操作；无结果时可显示 Ask AI，把查询交给助手。 | 项目、镜头、资产、命令和 Agent 的统一入口。 |
| [Image Generation](https://useplanes.com/components/image-generation) | 生成图抵达时的揭示动画；公开文档明确提到可由真实 job progress 驱动多张卡片，并可用于 inpaint/upscale 后结果。 | 图像生成队列与版本更新。 |
| [Photo Stack](https://useplanes.com/components/photo-stack) | 图片堆叠在悬停时展开；可配置图像和尺寸。 | 一个镜头有多个候选 take 时，可参考覆盖图与数量提示。 |
| [AI Chat](https://useplanes.com/components/ai-chat) | 组合 prompt、推理与回复的聊天表面；官方也把无后端原型列为用途。 | 画布右侧 Agent 面板的局部组成参考。 |

**取舍**：适合研究具体动作与响应的衔接，尤其命令入口、参数控件与生成结果。 组件源文件交付的结构比整体模板更符合自行维护组件库的目标。 用户尚未确认 .com 是否所指来源，不把 .com 作为 .co 的已验证重定向。 本次列出的五个组件均标 Pro；仅学习公开交互说明，不复制受限实现。

**许可/收费**：候选 .com 的 Terms：Pro 有效许可可修改并用于无限个自身/客户项目；不得原样发布、转售或作为竞争组件库/公共源码仓库分发 Pro 源码。免费组件公开，但本次未确认统一的免费源码许可证。 .com 首页显示 $99 一次、单开发者、长期更新；条款另有 seat/activation limit。 [官方条款/来源](https://useplanes.com/terms) [官方价格/目录](https://useplanes.com/#pricing)

## ObsidianUI

**定位（官方文字）**：React / Tailwind / Motion 交互组件库，现有目录同时包括工作区外壳、设置列表、状态条和媒体动效；可查看与复制公开组件代码。 [官网](https://obsidianui.dev)

| 组件 / 公开页面 | 已核实行为 | 对本产品的用法 |
| --- | --- | --- |
| [Dashboard Shell](https://obsidianui.dev/docs/dashboard-shell) | 分组侧栏可拖动调整，默认 200px、范围 180–400px，双击复位；内容独立滚动，标题/标签/工具栏固定；有筛选、行选择、撤销及键盘菜单。 | 作为资产库、任务列表、设置页面的结构参考，面板尺寸变化也有真实行为。 |
| [Active Sessions](https://obsidianui.dev/docs/active-sessions) | 异步操作期间保留行；成功才折叠移除，失败原地显示错误；部分成功时失败项留下；完成后谨慎恢复焦点，慢于 150ms 才显示 spinner。 | 可迁移到本机/远程引擎连接、任务取消和批量资产操作。 |
| [Status Bars](https://obsidianui.dev/docs/status-bars) | 按日显示运行、降级、停机状态；鼠标、点击或方向键可看事件；窄容器自动缩小展示天数。 | 远程服务历史或生成任务完成历史的紧凑概览。 |
| [Art Gallery](https://obsidianui.dev/docs/art-gallery) | 页面标题为可拖动照片网格；公开源码使用 Three.js、图像图集和 shader，含惯性式插值与降低动态 hook。 | 参考以图像和简短元数据为主的资产墙。 |
| [Hover Image](https://obsidianui.dev/docs/hover-img) | 公开代码用 GSAP 让图片预览跟随鼠标，切换行时平移缩略图；contained 模式把预览限制在容器内。 | 资产列表的可选快速预览。 |

**取舍**：最值得迁移的是异步状态、滚动归属、调整面板及焦点处理。 从一个真实外壳中统一按钮、菜单、筛选器与确认弹窗，比逐个添加特效更有价值。 将美术展示网格当成完整编辑器画布。 把演示数据或缺失状态默认值直接带入实际引擎管理。

**许可/收费**：官网链接的官方仓库 LICENSE 已读取，确认为 MIT；保留版权和许可声明。没有从免费开源组件推导示例图片、品牌或其他数字商品都可无限使用。 本次组件研究不需要购买；未核实其他商品的价格。 [官方条款/来源](https://github.com/Atharvsinh-codez/ObsidianUI/blob/main/LICENSE) [官方价格/目录](https://obsidianui.dev/components)

## PaceUI

**定位（官方文字）**：基于 Motion / shadcn 的 React 组件、区块、模板和 starter，主要面向 Next.js 与 TanStack Start；公开目录把 Native AI / GSAP 系列标为 Legacy。 [官网](https://paceui.com)

| 组件 / 公开页面 | 已核实行为 | 对本产品的用法 |
| --- | --- | --- |
| [Model Selector](https://paceui.com/components/motion/ai-model-selector) | 模型选择器带工具提示和能力提示；可控制 showCapabilities / showDescription；该页标 Free。 | 自配模型选择时显示文字能力、供应方和局限。 |
| [Model Ability Selector](https://paceui.com/components/motion/ai-model-ability-selector) | 紧凑能力开关；图标用 spring；maxVisible 默认 3，buttonVariant 可选；该页标 Free。 | 把常用生成/理解能力收在输入器附近，避免完整参数表常驻。 |
| [Voice Record](https://paceui.com/crafts/voice-record) | 录音 pill 带频率条，停止操作与 loader 形态转换；标 Pro。 | 录音、停止、等待识别三个阶段的局部连续反馈。 |
| [Chat App](https://paceui.com/blocks/app/chats) | 提供控制台/助手工作区；预览包括建议操作、输入字数和对话入口；当前 Chat 1 标 Pro。 | Agent 面板空状态和快捷任务的组织方式。 |
| [Agent Dashboard](https://paceui.com/templates/agent-console-template) | 模板说明含流程构建、实时执行轨迹、supervisor、资源/token 分析和控制台日志；有官方 Live Preview。 | 研究任务进度如何和日志、资源消耗关联；预览 https://paceui.com/preview/templates/agent-console 。 |

**取舍**：模型能力的渐进披露，以及 Agent 执行状态和细节的层级。 优先看局部控件，减少把整套 SaaS 后台搬入桌面工具。 Native AI / GSAP 被目录标为 Legacy，不宜未经核实就当成当前推荐架构。 不要因为首页写 clean code you own 就认为全部代码是 MIT 或可自由再分发。

**许可/收费**：Free 与 Pro 混合。通用 Terms 明确各产品有各自许可证，单项条款优先；官网视觉/营销资料另受限制。没有核实 Model Selector 的单项再分发条款，不能因 Free 标签宣称 MIT。 首页显示 Free $0；Pro $179 一次，单开发者、无限商业项目。Voice Record / Chat 1 / Agent Dashboard 为 Pro。 [官方条款/来源](https://paceui.com/terms-of-service) [官方价格/目录](https://paceui.com/pricing) [官方价格/目录](https://paceui.com/components)

## VantaUI

**定位（官方文字）**：以实际产品界面为参照的 React / Next.js 组件、区块、模板与 Figma 资源库，提供公开预览和分级付费获取。 [官网](https://vantaui.com)

| 组件 / 公开页面 | 已核实行为 | 对本产品的用法 |
| --- | --- | --- |
| [Frequencii Sidebar](https://vantaui.com/explore/components/frequencii-sidebar) | 支持展开/折叠，默认宽度 256/48px，可持久化；主导航、连接分区、用户底部；条目含 badge 与明确 active 状态。 | 研究紧凑导航、服务连接分区和展开/折叠信息层级。 |
| [Focal Select](https://vantaui.com/explore/components/focal-select) | 行内选择器展开为竖向文字 reel，中心选项清晰；可受控、禁用和表单提交。 | 可用于短且有限的非关键选择，研究触发器和选中态。 |
| [Dynamic Tabs](https://vantaui.com/explore/components/dynamic-tabs) | 一个主选项加一个可展开的成组选项；选中 indicator 滑动，提供受控值和禁用态。 | 少量模式之间的切换与分组关系。 |
| [Integrations Dialog](https://vantaui.com/explore/components/integrations-dialog) | 组合源/目标服务图标、说明、权限列表、可复制链接、文档及连接操作；支持 open 状态与可关闭结构。 | 为自部署远程服务配置提供清楚的连接对象与操作反馈。 |
| [Hold Button](https://vantaui.com/explore/components/hold-button) | 持续按住后完成删除，默认 1200ms；支持按键长按、完成标签与撤销回调。 | 高成本破坏性动作的确认和撤回反馈参考。 |

**取舍**：具体操作控件的完整状态，以及连接对话框的信息结构。 侧栏保持主要导航和服务连接的可区分性。 五个已读组件均显示 Pro/Plus 门槛；公开预览不等于获得源码许可。 Focal Select 的模糊 reel、Dynamic Tabs 的形变只是局部手法，不能替代信息架构。

**许可/收费**：价格页：免费层有限组件，标 Personal use only；Plus/Pro 是一次性付费，商业使用属于付费层。Terms 限制转载/再分发、竞争资源库和未经许可的自动化获取及 AI 派生用途；本次不复制收费代码。 Jina 价格文本把三个层级都抽取成 $0，疑似动态价格未加载。实际 Plus/Pro 金额未核实，不能报告免费。 [官方条款/来源](https://vantaui.com/pricing) [官方价格/目录](https://vantaui.com/terms)

官方组件页给出的独立预览：[预览 1](https://vantaui-registry.vercel.app/components/focal-select)、[预览 2](https://vantaui-registry.vercel.app/components/dynamic-tabs)、[预览 3](https://vantaui-registry.vercel.app/components/hold-button)。

## Space UI

**定位（官方文字）**：Base UI + Tailwind 的基础控件与交互组件体系，另有区块、模板、hooks、创意工具与付费访问；既有工作台基础控件，也有大量 shader/装饰组件。 [官网](https://spaceui.one)

| 组件 / 公开页面 | 已核实行为 | 对本产品的用法 |
| --- | --- | --- |
| [Resizable](https://spaceui.one/components/resizable) | 拖拽分隔线调整面板；有横向、纵向、嵌套、三栏 Files/Editor/Preview 示例，以及拖动时的 handle 反馈。 | 资产/画布/检查器与底部时间线的空间分配。 |
| [Number Field](https://spaceui.one/primitives/number-field) | 直接输入、增减按钮、方向键和可拖动 scrub 区；有范围、步长、格式化值和尺寸变体。 | 镜头时长、音量、缩放、强度等精确参数。 |
| [Command](https://spaceui.one/primitives/command) | 基于 Base UI Autocomplete 和 Dialog 的搜索命令菜单；支持分组、空结果、快捷键说明和上下键/Enter/Escape。 | 全局命令、资产定位和面板切换。 |
| [Toolbar](https://spaceui.one/primitives/toolbar) | Base UI toolbar 包装：组、分隔线、按钮、toggle、链接、输入可在同一紧凑工具条组合。 | 画布工具、选中对象的上下文操作和时间线工具。 |
| [Loading Orb / BuildingLoader](https://spaceui.one/components/loading) | 4×4 像素矩阵状态图形；可调 pattern、速度和 motion preset；BuildingLoader 把状态主标签、详情文字和 shimmer 放在一张卡片。 | Agent 执行摘要，文字承担状态，图形辅助识别。 |

**取舍**：基础控件的可访问行为、尺寸和受控状态，比装饰层更适合作为组件系统底座。 精确参数输入和可调整面板直接对应影视工作台。 Timeline 是活动记录/里程碑，不是音视频剪辑时间线；只能参考生成任务历史。 Handle Reel 是带动量的名字滚轮，不是时间线拖拽把手。 不要把 shader、plush、sound 等工具默认铺进工作区。

**许可/收费**：Terms 明确组件、primitives、blocks、hooks 和 utilities 源码为 MIT，可个人/商业使用；同时存在 Pro registry、模板与数字资产的付费访问。MIT 不等于无需获得访问权限；品牌和原始插画另受保护。 价格页显示 Community 免费、Pro $99/年（页面促销划线 $169）、Lifetime $129 一次；价格会变，未购入。 [官方条款/来源](https://spaceui.one/terms) [官方价格/目录](https://spaceui.one/pricing)

## 本产品的迁移原则与缺口

用统一规则连接资产、Agent、画布与时间线：面板可调整，工具位置稳定；参数能直接输入；模型名称与能力可比较；执行中、成功、失败、取消、未知分别有文字状态。动效解释状态变化，不替代状态。

需要避免的误读：Libraries Magnetic UI 是手机磁力计方案；Space Timeline 是事件历史；Handle Reel 是名字滚轮；Obsidian Status Bars 的缺失日期补成正常状态不能迁移到我们的服务状态。

Planes `.com` 待用户确认；Vanta 的抓取价格均显示 $0，不能当成真实免费；PaceUI 单项许可未完全核实。组件来源的视觉质量、Electron 可用性、性能与键盘可访问性尚未实测。详细逐组件注意点、官方链接和证据类别见同目录 `references-research.json`。

