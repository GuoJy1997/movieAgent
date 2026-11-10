# MovieAgent 完整功能 UI 概念图
生成日期：2026-11-02。生成方式：内置 ImageGen。状态：视觉探索，未实施，未验收；不是新的权威需求规格。
编号按本轮聊天中图片实际显示顺序排列。三张图展示同一套方向的不同工作场景，不是三套互斥方案。

## 效果图
1. [镜头与对白制作台](D:/movieAgent/output/ui-concepts/2026-11-02/01-shot-dialogue.png)：固定镜头列表、大画面、对白审核、角色声音和已有图复用。
2. [分集创作总览](D:/movieAgent/output/ui-concepts/2026-11-02/02-series-overview.png)：项目/集期层级、继续制作、前集记忆、共用角色与素材。
3. [成片剪辑工作台](D:/movieAgent/output/ui-concepts/2026-11-02/03-timeline.png)：素材箱、预览、属性和四轨同屏，支持高密度片段工作流。

[完整生成提示词](D:/movieAgent/output/ui-concepts/2026-11-02/prompts.md)。

## 设计判断
- 现有十入口导航按项目共用资源和当前集制作分组，持续显示剧名与当前集。
- 分镜列表、当前镜头、对白审核分区，技术来源与修订收进详情。
- 剪辑使用固定工作区及可调整分隔线，避免预览与轨道分处长页面上下两端。
- 保留深石墨与浅鼠尾草绿；发光效果集中在选中项和关键操作。
- 图中影视内容、角色、片长、数量和状态均为示例，不是用户项目数据。

## 本次依据与边界
本次重新读取当前规格与源码，并查看近期已有验收截图；没有运行真实模型或重新验收全部应用。本次没有修改产品代码。
当前源码已有：分集/多画布/主时间线、共享记忆与版本来源、项目资产作用域、角色默认声音、外部图复用、MCP设置、四轨剪辑、画面256及配音/音乐各256段。总时长上限仍为600秒。
MCP仅M1有既有工程和本机打包验收；图中未把M2/M3全流程外部控制当成已实现。
新增布局、固定分区、素材缩略条、导航分组是设计建议，不代表这些UI已实现。自动保存也不能由图中的“已保存”状态推断。

源码：
- D:/movieAgent/libtv-studio/apps/desktop/src/renderer/App.tsx
- D:/movieAgent/libtv-studio/apps/desktop/src/renderer/features/subprojects/SubprojectWorkspace.tsx
- D:/movieAgent/libtv-studio/apps/desktop/src/renderer/features/subprojects/ProjectAssetsPanel.tsx
- D:/movieAgent/libtv-studio/apps/desktop/src/renderer/features/creation/ShotProductionPanel.tsx
- D:/movieAgent/libtv-studio/apps/desktop/src/renderer/features/models/McpSettings.tsx
- D:/movieAgent/libtv-studio/packages/contracts/src/timeline-limits.ts
规格入口：D:/movieAgent/spec/README.md，SPEC-002、003、004。
视觉参考：10月25日历史概念图、SPEC-002分集验收截图、11月1日剧本分镜验收截图、10月29日时间线审查截图，以及11月2日资产验收截图。
历史设计保留原位；本目录只保存此次图像交付物和生成记录。

