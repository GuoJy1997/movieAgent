# MovieAgent 需求规格目录

本目录是当前工作区 `D:/movieAgent` 的新需求 spec 统一入口。产品源码位于 `../libtv-studio/`。

## 存放规则

- 每个新需求建立 `NNN-short-topic/` 子目录，正文固定为 `spec.md`。
- 编号按本索引顺序递增；同一需求的修订更新原文，并记录变更，不另建同义规格。
- 配套 `plan.md`、`review.md`、验收记录可放在同一需求目录；没有实际执行时不要写成已完成。
- 规格至少涵盖目标/边界、已验证现状、用户流程、数据与接口、错误/恢复、兼容、验收、来源和未确定项。可参考 [模板](TEMPLATE.md)。
- 区分“源码已有”“历史验证”“本次验证”“建议新增”，以及工程测试与真实模型质量。
- API Key、Token、带签名的媒体 URL 不写入 spec。
- 用户要求先写 spec 时，仅交付文档；不会自动进入功能实施或付费调用。
- 历史设计保留在 `../libtv-studio/docs/superpowers/specs/`，历史 UI 审阅保留在 `../libtv-studio/specs/`；不搬迁、不复制为第二份权威正文。新需求统一用当前单数 `spec/`。
- 本目录在产品源码 Git 仓库外，属于用户指定的工作区级文档；不能声称已随源码提交，也不自动改变仓库布局。

## 需求索引

| 编号 | 需求 | 状态 | 日期 |
| --- | --- | --- | --- |
| SPEC-001 | [角色声音一致性](001-character-voice-consistency/spec.md) | Approved；工程完成，真实服务未验 | 2026-10-30 |
| SPEC-002 | [项目、子项目与连续创作](002-project-subprojects/spec.md) | Approved；工程完成，真实视频/文本/自动摘要/第二集接续部分通过，旧未知任务并发恢复已真实验证，其他语义仍部分未验 | 2026-10-31 |
| SPEC-003 | [Agent 默认预算、ZIP 稳定性与时间线扩容](003-production-reliability-and-capacity/spec.md) | Approved；收尾修复与本机自动验收完成，两项Minor关闭、30分钟资源验证通过；人工听感/真实质量未验 | 2026-11-02 |
| SPEC-004 | [MCP 与外部创作资产接入](004-mcp-external-assets/spec.md) | Approved；M1工程与本机打包验收通过，2Minor延期；M2/M3及真实模型未验 | 2026-11-02 |
| SPEC-005 | [羊番TV 界面系统与工作区重构](005-yangfan-ui-system/spec.md) · [实施计划](005-yangfan-ui-system/plan.md) | Approved；工程已落地，本机验证通过（含集成定向复跑）；完整DPI/性能、用户视觉与真实服务未验 | 2026-11-08 |

SPEC-003 于 2026-11-02 补充[剩余项收尾计划](003-production-reliability-and-capacity/plan.md#2026-11-02-收尾修复计划待执行)，F1–F4本机工程部分完成：核心908/908、界面109/109、媒体30/30、最终包60次导出及30分钟资源验证通过，人工听感仍未验。历史验收记录保留，详见[当前进度](../verification/2026-11-02-spec003-followups/progress.md)。

最新业务主流程核查：[2026-11-01 复核](../verification/2026-11-01-main-flow/report.md)，确认5项待处理（1容量、2配置、Agent默认预算、原件ZIP可恢复超时）；未改产品代码、未新增真实模型调用。历史记录：[2026-10-30 主流程检查](../verification/2026-10-30-main-flow/report.md)。核查不另建同义需求规格。



