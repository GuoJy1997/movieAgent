# SPEC-002 真实短路径验收 · 2026-10-31

结论：部分通过。真实视频生成 → 镜头选用 → 时间线 → 本机渲染 → MP4 导出 → 制品登记 → 第二集复用已通过。真实文本 Agent 请求得到未知结果，自动剧情摘要未完成，不能据此宣称全自动主流程已通过。

## 实际工程与媒体

- 项目：D:\movieAgent\projects\连续创作真实验收-20261031-601872
- 第一集：第一集 · 邸报；第二集：第二集 · 前情验证
- 成片：D:\movieAgent\projects\连续创作真实验收-20261031-601872\exports\video\episode1-cut-r1-b381d275-b12d-4f15-804a-b62bc4cec7d6.mp4
- 请求 MiniMax-H3-Highspeed 4 秒，768P、9:16；本机输出 H.264/AAC、1080×1920、30fps，实际 3.733333 秒。
- MP4 3749825 字节；导出 hash 与登记制品源 hash 一致：d46d52bc69f7d371c2aaa2a7e38f046b3951b2ccfde10c3ad6ed7738017b2060
- 视频任务 6ccd397e-3f7e-4916-811a-f213e7608be7；保存原任务、原件和输出，仅一个视频提交意图。
- 第二集画布直接采用第一集同一 artifactId，来源归属保留，未复制原件或生成第二段视频。

## 真实调用和费用

本次按用户“跑一遍看看，视频用最短时间”授权调用已配置服务。数据库确认仅两个生成提交意图：1 次 Kimi 文本、1 次 MiniMax 视频。视频配置估价 ¥1.60，实际结算/账单未知；文本使用量和是否计费未知。未新增 TTS、ASR、对口型或图像生成调用。

## 已发现的堵点

Kimi k3.1-pro 的 Agent 提案请求等待约一分钟后没有拿到可收存的结果，最终显示 UNKNOWN / RECONCILE_REQUIRED，错误 STALE_LEASE。generation_fact 只有 unknown，没有 completed；不把它记作生成成功。
源码证据：packages/engine/src/generation-service.ts:268 的 claim 将租约固定为30秒；packages/engine/src/scheduler.ts:31 等待 submit 期间没有续期；apps/desktop/src/main/model-config-import.ts:80 将导入连接超时设置为60000毫秒。长请求可能先过租约再超时，不能仅据此判断供应商服务是否不稳定。
本次未修改生产源码、未重复原 Kimi POST、未新建另一个同类请求绕过未知任务。接下来的视频链路使用明确标记的人工验收剧本，并未伪装成 Agent 采用结果。
自动记忆没有配置该项目整理模型，完成快照保留为 pending，taskId=null；没有留下将来自动触发的记忆付费任务。真实自动摘要、下一集语义连续性、配音与对口型仍未通过此次验收。

## 证据

- verification/live-20261031/result.json：请求数量、媒体与来源结果
- verification/live-20261031/media-probe.json：实际视频格式
- verification/live-20261031/real-canvas-a.png：第一集生成画布
- verification/live-20261031/real-shared-canvas-b.png：第二集复用画布
- verification/live-20261031/state.json：本次固定业务 ID 与计划；无 API Key
- D:\movieAgent\projects\连续创作真实验收-20261031-601872\打开本次验收项目.cmd：直接打开本次工程

中间脚本问题：双文本边同时连接单一 prompt 输入被 GRAPH_PORT_LIMIT 拒绝，未发供应商请求；改为单提示词入口后通过。首轮 Node strip-only 不支持 TypeScript 参数属性，切换运行器 transform-types；均没有修改产品规则或重复付费提交。

## 后续修复

用户要求延长等待时间后，已修复为文本请求5分钟、任务租约10分钟并每30秒续期；830项引擎和3项Electron验证通过。旧未知请求未重发，真实文本/记忆效果仍未补验。详见 [修复记录](long-requests.md)。
