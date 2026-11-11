# LibTV 界面实看与组件研究记录

日期：2026-10-24。目标：为个人 Electron 创作工具定义统一的组件与页面风格。

## 覆盖与方法

使用当前已登录的 LibTV 页面，实际点选导航、tab、菜单、模型选择、表单和已有画布；保存当轮截图。记录 **56 个界面/状态**：54 个有可观察结果，2 个预览/工具层结果不确定。数量包括同页的不同状态，**不代表 56 个独立页面，也不代表每一个功能都验收完成**。

截图与 UI 文本是观察证据；“可迁移到我们的产品”属于设计推导。除第 05 项 DOM 读取的颜色/尺寸外，文中的宽度等为观察估计。静态截图不能证明全部动效、键盘可访问性或性能。

“结构清楚”仅表示该帧的信息层级可理解；“有改进点”指本轮发现的具体问题或设计取舍；“覆盖受限”表示模型载入、裁图或工具条件限制；“待复核”不用于外观判断。

## 关键判断

1. 主要质感来自灰阶层级、精确的行高与间距、统一字阶及控件边界。LibTV 的内容图与 UI 框架有明确分工。
2. 首页、资产浏览、Agent、画布和 3D 子编辑器具有不同结构，不能用同一套卡片模板换内容冒充全产品。
3. 菜单、筛选 popover、表单 dialog、大型资产浏览 dialog、确认层必须分别设计。
4. tab 的视觉需要跟随“文档 / 页面分区 / 互斥视图 / 组合条件”这四种关系。
5. LibTV 也有不应继承的地方：自动促销/白色问卷打断、未改表单的退出确认、部分文本截断。菜单触边与 Escape 行为仍需针对性验证。

## 已知账户变化

点击项目列表的“新建文件夹”时，系统立即新增了一个空的“未命名文件夹”，没有先弹出名称表单。已在进行过程中向用户说明；未删除。除此之外，本轮没有已知的新内容提交、真实生成、发布、付款或权限变更。Skill 点击只加入了输入器上下文，未发送；草稿 token 的最终清理状态未核实，研究标签页不作为交付保留。

## 未覆盖或不能确认

- 当前资产/生成历史为空，未验证真实资产详情、批量选择、上传完成/失败、取消恢复等状态。
- 没有新开真实 Agent 任务；消息流、工具运行、计费、预算审批、重试、部分成功没有运行证据。
- 付费生成、图像加工、视频加工、最终发布/分享和账户设置保存未执行。
- 图片灯箱及图片工具菜单的截图不稳定，保留为待复核；不能说已完整看过。
- 插件页只确认截图中的 OpenClaw + CLI 等可见状态，没有逐一确认所有平台组合。
- 3D 页面观察了布局、对象/机位/轨迹标签与时间轴；没有编辑关键帧、录制、导出或连接手机。
- 支付码截图不进入交付图库；运动轨迹截图裁去动态配对码区域。
- 浏览器全页截图曾影响状态组件重建；后来改用当前视口。由截图造成的裁切不计为产品缺陷。

## 逐项记录

| 编号 | 界面 / 状态 | 健康判断 | 证据与说明 |
| --- | --- | --- | --- |
| 01 | 首页自动促销弹层 | 有改进点 | 页面自动出现大尺寸订阅弹层，深色遮罩、两栏购买区、胶囊分段选项和行式套餐；不作为创作主界面风格依据，未支付。 支付码截图不展示 |
| 02 | 首页 | 结构清楚 | 240px 导航，主区 40px 边距；创建入口用点阵与灰色表面，不依赖海报；快捷功能统一容器，最近项目为横向行卡。 [截图](screenshots/02-home-overview.jpg) |
| 03 | 项目列表与自动问卷 | 有改进点 | 项目卡片为 16:9 预览+独立标题和日期；页头搜索/回收站/文件夹。自动问卷采用白色浮窗，破坏深色一致性；不应继承到自用产品。 [截图](screenshots/03-projects.jpg) |
| 04 | 项目列表／一键新建文件夹 | 有改进点 | 新建文件夹不弹对话框而直接落盘，产生一个空的未命名文件夹。立体文件夹造型与项目预览卡分开；这是本轮唯一已知账户内容新增，未删除。 [截图](screenshots/04-folder-dialog.jpg) |
| 05 | 回收站模态框 | 结构清楚 | 大内容模态与小命名弹层应区分；背景模糊遮罩、52px 头部细分隔线、底部选择/恢复操作；空态不使用大插画。 [截图](screenshots/05-trash-dialog.jpg) |
| 06 | 资产／生成历史 | 结构清楚 | 三列：主导航、内容、右侧资产来源；媒体类型为轻量胶囊 tab，数量独立降权。当前账户为空，因此实际素材详情和生成失败卡片不可验证。 [截图](screenshots/06-asset-history.jpg) |
| 07 | 媒体标签与评级浮层 | 结构清楚 | 图片/视频/音频标签已逐个切换，均为空；评级浮层约 200px 宽，顶端与触发器右对齐；行高约36px、选中用右侧勾，不用发光描边。 [截图](screenshots/07-rating-popover.jpg) |
| 08 | 排序菜单 | 有改进点 | 140px 窄菜单、两行顺序项、右侧单选勾；本轮 Escape 未观察到评级浮层关闭，点击其他触发器后关闭，键盘支持需单测。 [截图](screenshots/08-sort-popover.jpg) |
| 09 | 个人资产库 | 结构清楚 | 空态由小图标、标题、次级上传按钮构成；主动作只在页头高亮为白色，清楚区分主次。 [截图](screenshots/09-personal-assets.jpg) |
| 10 | 资产新建菜单 | 结构清楚 | 白色主按钮展开深色窄菜单，只有文件夹/上传两个动作，避免内容区多入口重复。未选操作。 [截图](screenshots/10-asset-create-menu.jpg) |
| 11 | 资产筛选面板 | 结构清楚 | 筛选约300px宽，标题+重置、标签组、底部取消/应用；动作固定底部，白色仅用于提交。与窄菜单和大模态是不同层级组件。 [截图](screenshots/11-asset-filter.jpg) |
| 12 | 可灵主体库 | 结构清楚 | 角色/场景/道具/特效分类，方形创建占位；不同于文件资产，是可复用实体。 [截图](screenshots/12-kling-library.jpg) |
| 13 | 创建主体表单 | 有改进点 | 约680px表单模态；双上传区、名称计数、双列选择、描述区域、右下动作。可输入控件边界偏低对比；必填与禁用状态可见。未填写/提交。 [截图](screenshots/13-subject-create-dialog.jpg) |
| 14 | 音色下拉／弹层中的弹层 | 有改进点 | 选择器带预览按钮、来源 badge 与滚动条。720px 高视口下菜单下缘超出可见区，自己的浮层需碰撞检测/自动向上展开，不照搬这一问题。 [截图](screenshots/14-voice-select.jpg) |
| 15 | 未保存退出确认 | 有改进点 | 小确认框约300px宽，叠加于表单；危险按钮红色，文案与图标一致。空表单退出也提示，自己的产品应仅在脏数据时触发。 [截图](screenshots/15-discard-confirmation.jpg) |
| 16 | Agent 首页／Skill 推荐 | 有改进点 | 顶部轻衬线一句话与大输入框，下方两个层级的 tabs；卡片用横向缩略图+窄文字列，不是大海报；中文长标题被截断，应提供悬停完整内容。 [截图](screenshots/16-agent-home.jpg) |
| 17 | Agent 模型选择器／图片 | 结构清楚 | 约370px浮层；图片/视频分段，模型一行包含图标、名称、说明与加入按钮；选择是添加上下文，不只是单值下拉。 [截图](screenshots/17-agent-model-picker.jpg) |
| 18 | Agent 模型选择器／视频 | 结构清楚 | 选中标签用灰色滑块；列表滚动到视频分组，说明与模型主名在一行体系；能看见会员标识但未选择模型。 [截图](screenshots/18-model-video-tab.jpg) |
| 19 | 生成模式菜单 | 结构清楚 | 两行主/说明文字 + 选中勾，语义说明消耗规则；仅查看，没有切换自动生成。 [截图](screenshots/19-generation-mode.jpg) |
| 20 | Agent 收藏 tab | 结构清楚 | 一级文字 tab 仅靠明暗/字重，切换后保留输入框；空收藏用小型文件夹图标，没有大量说明。 [截图](screenshots/20-agent-favorites.jpg) |
| 21 | Agent 我的 tab | 结构清楚 | 相同 tab 容器内按上下文露出创建 Skill 的主动作，避免全页重新布局。 [截图](screenshots/21-agent-my-skills.jpg) |
| 22 | Skill 创建菜单 | 结构清楚 | 主动作菜单为图标+标题+说明的双行项目，约264px宽；未创建或导入 Skill。 [截图](screenshots/22-skill-create-menu.jpg) |
| 23 | Skill 卡片选中／输入框上下文 | 结构清楚 | 点击 Skill 卡片将 Skill 标签插入输入框，发送按钮变为可用；未发送。清空文字后标签是否仍保留未验证，该研究标签页将关闭。 [截图](screenshots/23-skill-detail.jpg) |
| 24 | 插件导航菜单 | 结构清楚 | 侧栏子菜单向右展开，圆角容器与图标统一；无需在主导航常驻两个插件项目。 [截图](screenshots/24-plugin-menu.jpg) |
| 25 | 插件内页／Plugin | 结构清楚 | 独立展示页：品牌说明+嵌套的 Agent 图标 tabs 和接入方式分段；安装流程用编号与纵向分栏，非工作台密度。 [截图](screenshots/25-plugin-page.jpg) |
| 26 | 插件内页／CLI | 结构清楚 | 接入方式切换后流程文字更新，图标 tabs 保持同一布局；当前截图是 OpenClaw+CLI，仅作视觉参考，未执行安装。 [截图](screenshots/26-plugin-cli-tab.jpg) |
| 27 | 学院首页 | 结构清楚 | 内容教育页面用大字号标题、左右图文课程卡；与画布不是同一个密度。可迁移至我们的帮助中心，不搬促销。 [截图](screenshots/27-academy.jpg) |
| 28 | 学院／亮点功能 | 结构清楚 | 四列 16:9 教程卡，图片与说明分开，内容区独立滚动而侧栏固定。 [截图](screenshots/28-academy-feature-tab.jpg) |
| 29 | 创作精选 | 结构清楚 | 该页用下划线 tab 与横向滚动类别，卡片图片独立于头像/作者文字；图片承担内容而非全站背景。 [截图](screenshots/29-showcase.jpg) |
| 30 | 作品详情 | 结构清楚 | 预览为独立全屏式布局：大媒体区、右侧评论、下方描述与推荐；无需外层导航。视频自动播放，已暂停；未点赞、关注、评论或复制创作过程。 [截图](screenshots/30-work-preview.jpg) |
| 31 | 挑战赛列表 | 结构清楚 | 活动卡图内放状态，标题置于图外；该运营模块仅作为卡片层级研究，不纳入自用产品首期导航。 [截图](screenshots/31-challenge-page.jpg) |
| 32 | 画布工作流 | 结构清楚 | 左侧320px节点列表；主画布点阵、标题在媒体框上方、灰色连线；底部浮动工具条。节点媒体占主体，未选中时几乎没有参数表单。 [截图](screenshots/32-canvas-overview.jpg) |
| 33 | 故事板模式 | 结构清楚 | 实际进入的是 Agent 主工作区 + 右侧项目素材（图片/视频分区），不是假定的三列镜头时间线；两种工作模式布局明显不同，需要分别设计。 [截图](screenshots/33-storyboard.jpg) |
| 34 | 故事板布局菜单 | 结构清楚 | 对话左右位置单选，项目素材显示为开关；菜单与当前空间关系明确。 [截图](screenshots/34-storyboard-layout.jpg) |
| 35 | Agent 全局设置 | 结构清楚 | 600px设置模态：提示条、协作/预算/通知分区、行内开关、右侧数值；没有把每个设置包成独立卡片。未改变权限、预算、通知或协议。 [截图](screenshots/35-agent-settings.jpg) |
| 36 | Agent 历史对话空态 | 结构清楚 | 历史为锚定头部的小浮层，而非新页；当前账户无对话，真实消息/工具调用/失败重试状态未验证。 [截图](screenshots/36-agent-history.jpg) |
| 37 | Agent 创作模式菜单 | 结构清楚 | 全能/剧本/导演按角色分组，底部锚点菜单自动向上展开；未改变创作模式。 [截图](screenshots/37-agent-mode-picker.jpg) |
| 38 | 添加节点菜单 | 结构清楚 | 添加节点与导入资源分组，功能是图标+名称，版本 badge 很小；浮层从底部工具条向上展开，未创建节点。 [截图](screenshots/38-add-node.jpg) |
| 39 | 画布节点搜索 | 结构清楚 | “搜索画布节点”会把左侧列表工具栏变成输入框，画布不被遮罩；适合局部筛选，不应全部替换成居中命令框。 [截图](screenshots/39-node-command-search.jpg) |
| 40 | 全部功能目录 | 结构清楚 | 大模态三列，视频/图片/音频/工具分组；图标容器与文字对齐，部分功能有次级菜单。当前截图显示上半内容，完整入口通过 AX 读取；未触发付费编辑。 [截图](screenshots/40-feature-catalog.jpg) |
| 41 | 图片节点右键菜单 | 结构清楚 | 顶部评分，中段专用功能，下段剪贴板/副本/删除与快捷键；按语义用分隔线分组。未评级、复制、删除或运行校验。 [截图](screenshots/41-node-context-menu.jpg) |
| 42 | 图片节点聚焦态 | 结构清楚 | 双击节点平滑放大到176%；图像仍在画布内，工具栏悬浮于节点上方，关联连线出现蓝色流动高亮。选中态不把参数永久塞满节点。 [截图](screenshots/42-image-detail.jpg) |
| 43 | 图片预览触发 | 待复核 | 点击“预览”后未观察到稳定独立预览层，仍为画布聚焦态；不据此声称已审查图片灯箱。 全页截图可能触发组件重建，这属于研究工具限制，不能作为产品缺陷结论。 [截图](screenshots/43-image-lightbox.jpg) |
| 44 | 图片工具更多菜单 | 待复核 | AX 曾返回人像调节/扩图/裁剪等菜单项，但截图中浮层未稳定出现，随后定位已不存在；仅记录入口，不作为菜单外观证据。 全页截图可能触发组件重建，这属于研究工具限制，不能作为产品缺陷结论。 [截图](screenshots/44-image-tools-menu.jpg) |
| 45 | 快捷键面板 | 覆盖受限 | 快捷键面板按四组排列，kbd 与说明分开；本帧右侧内容裁切可能受视口与截图方式影响，未据此确认产品溢出缺陷。我们的面板仍须限制宽度并支持滚动。 [截图](screenshots/45-keyboard-help.jpg) |
| 46 | 缩放菜单 | 结构清楚 | 输入比例 + 放大/缩小/适应 + 预设，快捷键靠右；交互密度明显高于生成图。 [截图](screenshots/46-canvas-zoom-menu.jpg) |
| 47 | 3D 导演台／导演视角 | 覆盖受限 | 三段式专业工具布局：左对象列表、中央3D视口、右属性检查器；数值输入与滑条混排，分区分隔。此帧角色模型未完整显示，仅据 UI 分析。未修改场景。 [截图](screenshots/47-director-stage.jpg) |
| 48 | 3D 动画时间轴 | 结构清楚 | 1280×800 实测：底部时间轴与视口共存，有对象轨、时间刻度、播放头、导出帧率；原全页截图会影响组件重建，已改用当前视口截图。未播放/编辑关键帧/导出。 [截图](screenshots/48-director-timeline-live.jpg) |
| 49 | 3D 机位属性 | 结构清楚 | 机位模式显示预览、名称、选择器、XYZ数值、关键帧菱形；紧凑参数区与长内容独立滚动。 [截图](screenshots/49-director-camera.jpg) |
| 50 | 运动轨迹 tab | 覆盖受限 | 运动轨迹页含手机虚拟相机配对、预设运镜和时长。参考文件仅保留左侧视口裁图，避免在报告展示动态配对码；未连接手机/录制/应用预设。 [截图](screenshots/50-director-path-tab.jpg) |
| 51 | 角色造型室 / 我的角色库 | 结构清楚 | 独立大型弹层；我的/官方主标签、属性筛选、列表与宫格；未创建角色。 [截图](screenshots/51-character-studio.jpg) |
| 52 | 角色造型室 / 官方角色库 / 宫格 | 结构清楚 | 角色封面为内容，筛选与图文卡结构独立；未添加到画布、编辑或生成。 [截图](screenshots/52-character-library.jpg) |
| 53 | 画布素材库菜单 | 结构清楚 | 素材库为风格/特效两项弹出菜单；带说明与新增标识；未插入节点。 [截图](screenshots/53-material-library-menu.jpg) |
| 54 | 画布生成历史 | 结构清楚 | 生成历史实际为大型资产浏览 dialog，左侧来源分类，上方本项目/全部项目和媒体筛选；当前为空，失败/批量/真实产物状态未验证。 [截图](screenshots/54-canvas-generation-history.jpg) |
| 55 | 发布与分享菜单 | 结构清楚 | 发布作品与共享画布是两项带用途说明的入口；未生成分享链接、修改可见性或发布。 [截图](screenshots/55-share-menu.jpg) |
| 56 | 画布侧栏 / 项目资产 | 结构清楚 | 项目资产在相同侧栏区域切换，搜索/批量/筛选/创建入口；空状态提供建立分类及上传；未触发。 [截图](screenshots/56-project-assets-tab.jpg) |

## 六站参考范围

公开官方资料共核实 30 个组件条目，详见 [来源研究](references-research.md)。以下为实际浏览器观察；文字/源码研究不冒充实看动效。

| 编号 | 来源与组件 | 可观察结果 |
| --- | --- | --- |
| R01 | [ObsidianUI / Dashboard Shell](https://www.obsidianui.dev/docs/dashboard-shell) | 实际全屏演示：侧栏、标题、tab、筛选栏、表格各自一层；未借助媒体图片。 [截图](screenshots/r01-obsidian-shell.jpg) |
| R02 | [ObsidianUI / Category menu](https://www.obsidianui.dev/docs/dashboard-shell) | 字段名/当前值分离的触发器，窄菜单、右侧勾与细边缘阴影；此菜单没有搜索输入。 [截图](screenshots/r02-obsidian-filter.jpg) |
| R03 | [Space UI / Number Field](https://www.spaceui.one/primitives/number-field) | 轻边界数值输入；减号、居中数值、加号同一高度；实际点击加号从0变1。 [截图](screenshots/r03-space-number.jpg) |
| R04 | [Space UI / Resizable](https://www.spaceui.one/components/resizable) | 纵向分隔的基础容器，边界极轻，内容面保持连续；三栏变体来自文档，未实测拖动。 [截图](screenshots/r04-space-resizable.jpg) |
| R05 | [PaceUI / Model Selector / composer](https://paceui.com/components/motion/ai-model-selector) | 模型和能力入口紧靠输入器底部，外层留白，边界很轻；不需要大面积品牌装饰。 [截图](screenshots/r05-pace-model-selector.jpg) |
| R06 | [PaceUI / Model Selector / open](https://paceui.com/components/motion/ai-model-selector) | 实际展开模型菜单，图标/名称、短说明、能力区分层；只查看未发送。 [截图](screenshots/r06-pace-model-open.jpg) |
| R07 | [VantaUI / Integrations Dialog / detail](https://www.vantaui.com/explore/components/integrations-dialog) | 公开页明确标 Plus/Pro；本轮只查看公开预览。 [截图](screenshots/r07-vanta-integrations.jpg) |
| R08 | [VantaUI / Integrations Dialog / open](https://www.vantaui.com/explore/components/integrations-dialog) | 实际打开弹层：配对图标、标题、用途、权限列表、地址和独立底部操作区；未点击最终 Connect。 [截图](screenshots/r08-vanta-dialog-open.jpg) |
| R09 | [VantaUI / Dynamic Tabs](https://vantaui-registry.vercel.app/components/dynamic-tabs) | 观察到 Free 主选项与 Premium 成组入口；点选 Premium Solo 后选中状态未改变，未据此确认切换动效。仅为默认态外观证据。 [截图](screenshots/r09-vanta-tabs.jpg) |
| R10 | [Planes（.com 候选） / Physical Knob](https://useplanes.com/components/physical-knob) | 公开预览是金属同心纹旋钮、刻度与橙色指示；可作为局部参数的材质参考，不建议套用整个工作台。尚未确认 .co 与 .com 的关系，未取 Pro 源码。 [截图](screenshots/r10-planes-knob.jpg) |
| R11 | [Libraries.dev / Voice](https://libraries.dev/voice) | 实际页面展示底部局部彩色光带与输入器示例；Source 为 Demo voice，未选择 Microphone。播放按钮操作超时，未取得可靠的运行态对比。 [截图](screenshots/r11-libraries-voice.jpg) |
| R12 | [Libraries.dev / Image FX / capture limitation](https://libraries.dev/image) | Image FX 标签的浏览器操作与截图持续超时；文档可读，但不据此声称已实看其运行效果或已测性能。  |

## 如何使用交付物

- [可交互样板](index.html)：三种材质、组件、五类页面组合与实看图库。所有运行结果是本地演示。
- [完整设计规范](design-system.md)：页面骨架、28 类组件合同、模型连接、动效及后续验收。
- [设计变量](tokens.json)：提案值，可供后续实现复用。
- [来源与许可](references-research.md)：未购买模板；不能把 Free 标签自动等同于 MIT。

## 规格审阅

独立 builder check 已完成，结论为没有阻碍制定后续计划的关键缺口。它不代替用户对视觉风格的批准，也不证明正式软件已实现。
