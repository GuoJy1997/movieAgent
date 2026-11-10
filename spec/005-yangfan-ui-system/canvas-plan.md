# 画布引导与工具入口实施计划

Goal：新用户能从空画布直接建立角色、场景或添加素材，完成后看得见下一步。
Architecture：复用实体编辑器、资产固定引用、ReactFlow 与生成批准；增加起步面板、工具对话框、视图控件。不改存储合同。
Tech Stack：React / CSS / 现有 ReactFlow；从 Aceternity 示例选取 MIT Tabler SVG。
Spec：[SPEC-005](spec.md)。用户已要求调研后实施。

## 选择与约束

可跳过、可重开引导；保留羊番TV黑蓝界面。角色/场景仍是实体修订；快捷工具只创建可编辑生成节点，不调用付费模型。参考固定版本，不能误选文本模型。缺模型/参考与读取错误明确说明。组件独立实现，只借鉴 Aceternity Floating Dock/Bento Grid。

现有工作树含前序未提交实现，本轮在其上追加，不重置、不提交混合改动。相关文件基线保留在 output/jimeng-canvas-research-2026-11-08/before。权限限制使用显式工具审批写入指定文件，不改目录 ACL。

## 任务

- [x] 1. renderer 回归先失败：空状态、实体创建、正确模型/参考、缺前置条件、读取错误。
- [x] 2. 实现 CanvasStarter、CanvasTools、CanvasViewportControls、CanvasIcon 与局部 CSS。
- [x] 3. 接入画布；保留声音、工作流、历史、撤销重做，实体关闭遵守草稿保护。
- [x] 4. 新增及直接相关 renderer 测试、typecheck、build；桌面/800×560 实际组件截图。
- [x] 5. 独立审阅、修复实质问题、记录真实验证范围。

## 状态

已完成限定范围的 REA 静态分析和浏览器观察、实现、独立审阅修复、针对性验证、独立 Windows 包与实际启动检查。具体证据与未验项见 [调研记录](canvas-research.md) 和 [实施记录](implementation.md#2026-11-08-画布引导与工具)。真实模型效果、全量 DPI/性能和用户视觉验收未标为完成。
