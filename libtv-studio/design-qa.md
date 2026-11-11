# SPEC-005 视觉 QA

日期：2026-11-08。范围：依据 SPEC-005 功能合同，将用户提供的四图落实到现有 Windows 桌面产品。此报告结论只覆盖下列已观察状态，不代表全部规格验收或用户审美批准。

final result: blocked

## 最新复核：Pill Nav 标签适配（2026-11-09）

本轮标签适配 final result: passed。整份 SPEC 的历史原生2K缺口、完整DPI及用户视觉验收仍未完成。

- 参考：React Bits Pill Nav 官方预览、TS/CSS registry和用户提供的即梦主题图胶囊截图。使用官方边缘弹簧算法；取消白色填充和滚字，改为深灰选中胶囊与原创蓝紫透明图片。
- 已查看首页、创作、设置实际渲染；选中项图片出现在右侧，未盖住文字；未选中项保持纯文字。主侧栏几何不变。截图位于 ../verification/2026-11-08-pill-nav/screenshots。
- 导航9项、首页6项、设置3项通过，类型检查通过；覆盖键盘手动激活、导航取消、减少动效、800px布局与侧栏稳定性。新增键盘测试在修改前失败。
- 源代码和运行预览已更新，未重打Electron、未调用真实模型、未更改创作数据；用户对本轮视觉效果仍待反馈。

## 最新复核：Circular Carousel 适配（2026-11-08）

本轮轮播适配 final result: passed。仅覆盖本次交互与海报布局，历史原生2K缺口及完整SPEC未验项不变。

- 来源：[官方Circular Carousel](https://reactbits.dev/components/circular-carousel)，TS/CSS registry源码快照和官网预览在 ../verification/2026-11-08-circular-carousel/reference。采用官方动效核心并裁剪成羊番前弧画廊，完整许可保存在组件目录。
- 视觉基准：已选00-home.png；海报采用用户最新真人短剧V2。与[当前1536×1024截图](../verification/2026-11-08-circular-carousel/screenshots/home-final.jpg)在同一输入查看。保留中央横海报、两左一右透视；调节间距避免近侧封面遮住中央标题。字体/色彩/业务文案不在此次修改范围。
- 布局：四张源图面均2:1，contain，中央约476×238；标题正确完整。最远卡有少量边缘叠放，但片名可读。源图仍1774×887，未新增2K文件。
- 交互：官方弹簧积分与指针速度采样驱动连续拖动、松手吸附；仍支持6秒自动、暂停、点击、圆点与键盘。项目预览独立于当前EP03。
- 验证：新增拖动检查在旧代码失败；最终首页6项及类型检查通过，控制台error为空。未重跑全部项目测试或重打EXE。

## 历史复核：真人短剧封面 V2（2026-11-08）

用户保留逆风而行并要求其余封面更像真人短剧。本节替代下文V1海报风格相关结论，用户审美批准仍待反馈；原生2K缺口不变。

- 源图与提示词：[当前海报清单](../output/yangfan-posters-hd-2026-11-08/README.md)。城市留声从动漫改成真人都市音乐剧；向晚的海强化双人关系近景；周末出逃强化主配角层次。逆风原文件未修改。
- 当前渲染：[周末](../verification/2026-11-08-poster-quality/screenshots/home-weekend-v2.jpg)、[城市](../verification/2026-11-08-poster-quality/screenshots/home-city-v2.jpg)、[海](../verification/2026-11-08-poster-quality/screenshots/home-sea-v2.jpg)。1536×1024，转场结束后捕获，与此前显示的三张原图比较，标题均完整，人物与片名顺序正确。
- 四张源图实际均1774×887；浏览器加载的是三张V2与原逆风，contain不裁切。控制台error为空。字体、布局、导航、真实业务数值与画廊代码未修改。
- 本轮为静态素材替换，未重复运行原来已通过的5项画廊测试及类型检查。临时viewport已恢复；未重打桌面EXE，未写入真实创作数据。

## 历史复核：海报质量与裁切 V1（2026-11-08）

本节替代此前首页海报相关结论。最终状态 blocked 仅指新增的原生2K目标未达成；本轮版式/裁切修复已检查。

- P2 已修复：卡片位置变化导致比例变化和片名裁切；所有原始图面保持2:1，使用contain，真实3D旋转/等比缩放，Hero请求original。
- P2 未完成：用户期望原生2K，实际内置图像工具两次不同尺寸请求均输出1774×887；没有可用的尺寸控制参数。未把插值放大冒充2K，不将本次总体图像质量标为全部通过。
- Source visual truth：[四张原图及生成提示词](../output/yangfan-posters-hd-2026-11-08/README.md)；图片布局方向仍是此前00-home.png。
- Rendered implementation：[周末](../verification/2026-11-08-poster-quality/screenshots/home-weekend.png)、[海](../verification/2026-11-08-poster-quality/screenshots/home-sea.png)、[城市](../verification/2026-11-08-poster-quality/screenshots/home-city.png)、[逆风](../verification/2026-11-08-poster-quality/screenshots/home-wind.png)。viewport1536×1024、DPR1，转场结束后截图。
- Focused comparison：[四张原图与各自居中后的渲染](../verification/2026-11-08-poster-quality/screenshots/all-center-comparison.jpg)。原图仅在比较板等比缩小至476×238；右侧截取相同尺寸的中央卡，四张片名均完整。初次比较误取转场过程，已重新拍摄稳定状态，不能以过程截帧判定最终裁切。
- 字体：片名由生成海报自身提供，四个标题文字核对正确；界面字体不改。间距：保持上一轮页面位置，卡片图面比例固定。颜色：四种影片色调与黑蓝UI保持区分。图像：原PNG1774×887，浏览器naturalWidth/Height核对一致；截图工具返回有损JPEG，截图不能用作原图清晰度文件。文案：任务等业务数值保持原数据。
- 5项画廊测试和类型检查通过；浏览器切换四个选中态，控制台error为空。尚无原生2K文件；未进行额外插值或未经授权的API路径。

## 2026-11-08 首页重新验收（本节替代旧首页结论）

用户指出单卡首页没有还原四海报立体画廊。此前把单卡合同解释成视觉验收通过是不充分的；本次按同一参考图重新检查。

- 源：[00-home.png](../output/yangfan-reference-adaptations-2026-11-07/00-home.png)；运行：[首页预览](http://127.0.0.1:4175/yangfan-preview)。
- 实际：[home-final.png](../verification/2026-11-08-spec005-home-fidelity/screenshots/home-final.png)；源与渲染均1536×1024、CSS viewport1536×1024、1:1像素，比较板只加标签、不缩放。
- 同一输入全图：[comparison-final.jpg](../verification/2026-11-08-spec005-home-fidelity/screenshots/comparison-final.jpg)；Hero局部：[hero-comparison.jpg](../verification/2026-11-08-spec005-home-fidelity/screenshots/hero-comparison.jpg)；窄窗：[home-800.png](../verification/2026-11-08-spec005-home-fidelity/screenshots/home-800.png)。
- P1修复：预览仅一项目，无法展示轮播；其他可见项目没有封面查询。现使用四个独立演示项目，各项目通过自身scope读取固定媒体；真实产品不注入演示项目。
- P2修复：初次多卡仍过于平直、封面裁切丢失标题。改为局部perspective、rotateY、轻微rotateZ与淡反射；按参考海报四角还原测试素材，保持海报内艺术字，未用一整张UI图代替控件。迭代证据为comparison-v1.jpg及最终对照。
- P2修复：首页多余tabs和小字号改变首屏比例。首页226px侧栏、36px标题、17–20px正文/工具、150px Composer、分集缩略图与短选中线；管理入口移到分集区，仍能进入原功能。
- 五项表面：字体保留系统中文，字号与层级已校正，非精确艺术字体；各大区纵向顺序/间距与原图重新对齐；黑蓝/蓝紫/钴蓝token保持；海报使用原参考画面且已检查标题、裁切、倾斜；数量/任务状态等业务文案来自数据。未硬编码18镜头、6待审核或62%/41%。
- 行为证据：新增测试先失败后修复；最后home/navigation共6项通过，相关交接/scope7项在先前针对性运行通过。类型与构建通过。浏览器检查箭头、圆点、暂停、恢复、当前集保持与800×560；最后控制台error列表为空，临时viewport已复原。
- 当前预览处于恢复自动轮播状态；悬停、焦点进入会暂停，移开继续，每6秒切换。减少动效设置仍优先。
- 剩余P3：专用羊羊头部资源、标题字形精确度及反射细节可继续按用户意见调整。真实任务缺少百分比时保留不确定进度；原图媒体任务缩略图不能在未有固定引用时编造。

本轮首页 final result: passed。完整SPEC验收的DPI/持续性能/真实服务未验状态不变；本次未重打先前的解包EXE。

## 证据与比较条件（此前记录，首页以本次复核为准）

- Source visual truth：[首页](../output/yangfan-reference-adaptations-2026-11-07/00-home.png)、[Agent](../output/yangfan-reference-adaptations-2026-11-07/01-agent-conversation.png)、[资产](../output/yangfan-reference-adaptations-2026-11-07/02-asset-version-detail.png)、[制作](../output/yangfan-reference-adaptations-2026-11-07/03-shot-production.png)。
- Implementation：[运行预览](http://127.0.0.1:4175/yangfan-preview)，真实产品组件，隔离数据桥接；不连接用户项目或付费模型。
- Source 与 implementation 均为 1536×1024 像素；浏览器 CSS viewport 1536×1024，输出 1 像素对应 1 CSS px，未对截图缩放。比较板加 32px 标题条并左右拼接成 3072×1056；不把浏览器外框或原稿窗口按钮计入内容差异。
- 页面状态：首页有一个可见项目和四集；Agent 为已有会话的文字回复；资产为场景图片详情与第三版本；制作为镜头编辑/已采用图片预览。颜色均为黑蓝主题。
- 与源图数据不同：源首页四项目、Agent 三个媒体结果；产品 fixture 遵循单目录可见项目和文字 Agent 合同。先明确此差别，不能按相同媒体数量进行像素级断言。
- Full-view 对照已将两图放在同一输入中检查：[首页](../verification/2026-11-07-spec005-ui/screenshots/compare-home.jpg)、[Agent](../verification/2026-11-07-spec005-ui/screenshots/compare-agent.jpg)、[资产](../verification/2026-11-07-spec005-ui/screenshots/compare-asset.jpg)、[制作](../verification/2026-11-07-spec005-ui/screenshots/compare-production.jpg)。
- Focused region：[Composer 对照](../verification/2026-11-07-spec005-ui/screenshots/compare-composer-focus.jpg)，保留各自原始像素，填充比较板留白，不拉伸控件。
- 补充：[时间线](../verification/2026-11-07-spec005-ui/screenshots/timeline-final.jpg)、[设置](../verification/2026-11-07-spec005-ui/screenshots/settings-final.jpg)、[资产列表](../verification/2026-11-07-spec005-ui/screenshots/assets-list.jpg)、[800×560 画布](../verification/2026-11-07-spec005-ui/screenshots/canvas-agent-800-final.jpg)、[800×560 制作](../verification/2026-11-07-spec005-ui/screenshots/production-800.jpg)、[实际桌面包](../verification/2026-11-07-spec005-ui/screenshots/packaged-workspace.png)。

## Findings 与修复历史

| 严重度 | 位置、早期证据与影响 | 已执行修复 | 修复后证据 |
| --- | --- | --- | --- |
| P2，已修复 | 首页嵌套旧 creation-page 的高度/内距造成大块空白，内容顺序偏移 | 首页 Agent 使用零外层内距，约束 Composer 布局 | home-final.jpg / compare-home.jpg |
| P2，已修复 | Agent 旧布局未拉伸，约 682px 内容宽度改变对话与输入面比例 | CreativeWorkspace 与 Agent 主区域 stretch/100%，保留会话栏和羊番作者行 | agent-final.jpg / compare-agent.jpg |
| P2，已修复 | 资产详情叠加列表标题与二级 tabs，压低大图并重复层级 | 详情态隐藏冗余 tabs、减小标题间隔 | asset-detail-final.jpg / compare-asset.jpg |
| P2，已修复 | 运镜/画面长文本在单行字段中截断，妨碍编辑 | 镜头编辑采用多行 textarea，保留保存和冲突状态 | production-final.jpg / compare-production.jpg |
| P2，已修复 | 800×560 侧栏底部设置被裁，持久动作不可达 | 窄窗 64px 导航、低高度收紧间距；实测设置底部位于 y=519 | canvas-agent-800-final.jpg、production-800.jpg |
| P2，已修复 | 时间线预算/预览选项占据大段首屏，主预览权重不足 | 紧凑工作区将质量/预算收入可展开区，保存/历史保持可达 | timeline-final.jpg |
| P2，已修复 | 设置局部使用文本符号，和统一图标不一致 | 使用现有 Phosphor 图标，隐藏重复设置标题 | settings-final.jpg |

以上问题修复后重新捕获并比较；类型检查、打包本身没有被计作视觉迭代。当前观察范围未保留可执行的 P0/P1/P2 问题。原始迭代截图保存在同一 screenshots 目录，未覆盖最终截图以外的历史文件。

## 五项保真检查

| 表面 | 观察与判定 |
| --- | --- |
| 字体/层级 | Windows Microsoft YaHei UI 等系统回退用于 14px 正文；重点粗斜体保持品牌与标题层级。源图文字更大，实际按 spec 工作密度落地，未声称逐像素复刻。长镜头文字改多行；图稿手写片名属于封面内容，产品项目标题仍需可编辑。品牌专用字形可后续细化 |
| 间距/布局 | 展开侧栏 208px、紧凑 64px、内容页边距 24px；首页画廊→输入→分集→任务，资产大预览+版本+侧信息，制作资产/编辑/预览+镜头条保留。窄窗辅助面板切换；时间线四轨位于可滚动工作区，当前截图首屏未展示全部轨道 |
| 颜色/token | 黑蓝主底 #0b0e14、蓝强调 #2860e8、侧栏蓝紫渐黑；细分隔、局部选中线和实心图标，无奶油底/银色倒角/大块浅色选中。状态同时有文案/图标，未只靠颜色。完整对比度矩阵未测 |
| 图像/图标 | 复用原创透明羊羊 PNG，常规图标为 Phosphor 资源；没有用 CSS 绘画冒充品牌。测试媒体由提供的参考画面技术裁切，清晰度受原参考限制，仅用于验证；真实产品由已有媒体预览读取原件。品牌当前为全身羊羊，源图为头部，更精简的专用小尺寸图标列 P3 |
| 文案/内容 | 产品五入口与操作词已统一，所有数量/版本/任务来自实际查询或明确隔离 fixture；无任务显示空态。输入工具按真实 Agent 模板/预设显示，准备→批准→采用分开；不暗示文字模型已经生成视频 |

## 交互与限制

浏览器实际打开了首页、Agent、画布、资产列表/版本、制作、时间线、设置；检查了导航与返回、引用/技能/模型/偏好展开、版本只预览、窄窗面板。最终浏览器捕获时控制台 errors 为空。自动化证据见[实施记录](../spec/005-yangfan-ui-system/implementation.md)，包括 IME、草稿、跨集、迟到回调和实际 Electron。

接受的合同差异：
- 目录模式只有一部可见短剧时显示单卡；其他目录仍通过启动器打开。分集没有现成封面字段时显示集号，不生成假封面。
- 普通 Agent 的文字提案保持文字流；源图三媒体候选不能用装饰假数据替代真实生成。
- 制作图中的静态文字改为可编辑字段；资产“全部”正确包含角色/场景/道具，角色筛选不会混入。
- 新图未覆盖成片、任务、启动器所有状态，沿用同套 token 迁移原功能；不声称这些页面已经取得用户图稿最终批准。
- Native Electron 负责窗口控制按钮；浏览器预览不重复绘制系统按钮。

尚未完整验证：全尺寸/DPI 矩阵、全页面键盘与对比度、旧版/新版同机持续性能、真实服务和用户视觉接受度。它们仍登记在 spec，不由本报告 passed 覆盖。

## Implementation Checklist

- [x] 打开源图和实际渲染截图，同一比较输入核查四个重点页面。
- [x] 修复上述 P2，重拍相关状态；核查 Composer 局部。
- [x] 检查主要导航/输入/版本/窄窗及控制台，保留自动化和包验日志。
- [x] 区分 fixture、产品合同与真实服务，记录未验项。
- [ ] 用户确认实际运行界面的视觉效果。
- [ ] SPEC-005 尚未完成的 DPI、完整可访问性与持续性能验收。

## Follow-up Polish

- P3：提供同一原创羊羊的头部专用小尺寸品牌资源；现有资源可用，未为此额外生成。
- P3：品牌/主标题可引入经许可确认的专用中文字形，当前系统粗斜体不是源图艺术字体的精确替代。
