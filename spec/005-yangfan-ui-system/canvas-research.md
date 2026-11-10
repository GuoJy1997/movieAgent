# 画布引导调研与实现记录 · 2026-11-08

用户要求：先用 REA 调研即梦画布，再完善羊番TV的新用户引导；组件与图标从工作区 UI参考.md 所列站点选择。规格归属 [SPEC-005](spec.md#2026-11-08-画布引导补充)，本文件记录证据与实现，不另建需求权威副本。

## 调研结论

关键是让用户在每一步知道能做什么：空白时给起点，选中节点后给下一步，缺少前置条件时给原因。常驻图标提供快捷访问，同时保留文字标签和可访问名称。

| 即梦实际可见行为 | 羊番TV的落实 |
| --- | --- |
| 空白画布提示双击创建；左侧按文本、图片、视频、音频、主体等组织入口 | 空白画布给人物/场景行动卡、文字/素材入口；双击或右键空白处打开添加面板 |
| 新建文本后选中节点，提示双击编辑；主体节点提供画布、资产库、本地来源 | 新增节点自动选中并定位，右侧给编辑/准备生成提示；人物/场景用现有实体编辑器保存修订 |
| 连线端点的加号打开上下文菜单；不相容类型禁用并解释 | 本轮保留现有连线校验；快捷工具按图像模型能力与固定参考门禁，不照搬未知类型 |
| 创作工具与底部选择、地图、连线、缩放控制分离 | 底部创作 Dock 与视图控制分区；保留声音、工作流、输出历史和撤销重做 |
| 工具箱分镜头、色彩、风格、运镜 | 按本产品可落实能力提供人物/场景六工具；通过可编辑提示词创建节点，再走既有生成批准 |

浏览器现场检查了空画布、文本节点、主体节点、添加连线节点菜单和工具箱。保留的[调研画布](https://jimeng.jianying.com/ai-tool/ai-canvas/8b6ae09c-de11-492f-bb35-6d8b481e686c?enter_from=page_click&from_page=create)名为“羊番TV画布交互调研（未生成）”，只有两个空节点。未提交生成，现场积分仍为40。没有上传用户项目、使用私有接口或复制即梦实现代码。

## REA 静态证据

使用官方 npm 包 rea-agents 6.8.0 的 JS 分析入口，对浏览器实际声明的公开脚本做静态分析。保留原始 [来源 URL](../../output/jimeng-canvas-research-2026-11-08/source-urls.json)、[运行脚本](../../output/jimeng-canvas-research-2026-11-08/run-rea.cjs)、[REA evidence](../../output/jimeng-canvas-research-2026-11-08/rea-focused-evidence.json) 和 [摘要](../../output/jimeng-canvas-research-2026-11-08/rea-focused-output.json)。

主证据标识：ev_8eea9d34b76ca316aff2dfb7a328bb640fef47ff141b6d92506f019285ade573。分析 canvas-view.8293941b40.js 一份脚本，209391 个 AST 节点、159 项 findings、0 解析失败；另两份已收集脚本未进入这次语义分析。节点保留上限1000、未知项上限100，应用/语义图均为 partial；不能声称完整逆向或完整调用关系已恢复。

| 静态证据 | 能确认的范围 | 不能据此推出 |
| --- | --- | --- |
| claimToolNodeConnectionGuide；脚本第2行列184254–184902 | 工具种类的引导记录按 seenKinds 去重并持久化；写入失败仍在当前会话去重 | 引导具体何时展示、所有用户都看到同一提示 |
| canvas-generation-tools；第2行列183726–185207 | 折叠状态有读取、写入验证、订阅与取消订阅 | 所有入口默认展开，或所有版本使用同一布局 |
| readDisplay；第2行列181100–181846 | 小地图和参考连线显示状态有校验，连线模式限定 all/selection-related | 未解析到的默认值、所有动态路径 |
| selected class 表达式；第2行列591360–591445 | 选中集合或 initiallySelected 影响样式 | 完整选中生命周期；REA 的低置信度 unresolved-reference 关系没有作为结论 |

前三项对应 AST evidence：jsrg_evidence_36f9dd8d86377fd5ebf56471d1600568b16de44c0e18ebac40755ccd607ad00d。静态事实与浏览器观察分别记录，互不冒充。初始运行的临时目录权限问题与扩大语义分析超时保留在 output 中；这里引用的是后续成功的 focused evidence。

## 组件与图标来源

来源链为 [UI参考.md](../../UI参考.md) → Aceternity [Floating Dock](https://ui.aceternity.com/components/floating-dock) / [Bento Grid](https://ui.aceternity.com/components/bento-grid) → 示例采用的 [Tabler Icons](https://tabler.io/icons)。

- 借鉴 Dock 分组和行动卡布局，使用项目自己的 React/CSS 实现，没有复制 Aceternity 组件源码；Aceternity 有其[独立许可](https://ui.aceternity.com/licence)，不能标为 MIT。
- 使用 Tabler 3.50.0 的26个 outline SVG；[MIT 许可](https://github.com/tabler/tabler-icons/blob/v3.50.0/LICENSE)保留在 CanvasIcon 同目录，并随包放入 resources/licenses/TABLER-ICONS.txt。
- 没有增加 Motion、Tailwind 或新的运行时依赖。保持既有羊番TV黑蓝色系。

## 实现与限制

- CanvasStarter：角色/场景行动卡，已有实体数量、真实画面/结果进度，起步指引可关闭/重开。
- CanvasToolsDialog：角色设定板、角色特写、脸身分区构图、场景设定板、昼夜天气变体、无人物空镜。复制当前实体文字修订，引用固定素材版本，只选择相容图像预设。
- 草稿采用现有导航保护，支持继续编辑、保留并离开、放弃；保留范围是本次应用会话。创建失败保留内容，选中参考失效时禁止静默退化为无参考生成。读取失败与尚未配置分别展示。
- 模型输出质量、精确抠图/脸身分离、真实图片文件在提交时的可读取性仍由媒体/生成准备链验证；本轮没有调用真实付费模型。工具是可编辑任务预设，不承诺专用图像算法效果。

工程验证与包交付结果见 [实施记录](implementation.md#2026-11-08-画布引导与工具)。
