# 未知任务并发占用恢复验收

状态：2026-10-31 实现、工程回归、Windows目录包和真实Kimi补验通过。本报告补充SPEC-002；原长请求、视频和文本接续报告保留各自时点记录。

## 原因与处理

原Kimi请求已发出但结果未知，旧60秒租约过期后留下STALE_LEASE。延长新请求超时和租约不会改变旧请求事实；调度器持续将它算作并发，配置为1的连接因此无法继续运行不同的新任务。

任务详情新增“解除并发占用”：阅读说明并勾选“我了解原请求可能继续执行并产生费用”后，点击“确认解除占用”。这是本机调度决定；原请求仍unknown，任务历史、提交意图和费用风险预留保留。操作不自动重发原请求，也不提高连接并发。尚有有效工作者租约、非unknown、错误attempt或错误子项目作用域均拒绝。

命令task.releaseUnknownSlot接收taskId、attemptId、acknowledgeRisk:true，返回TaskView。schema27新增unknown_task_release独立审计表，TaskView投影可选concurrencyReleasedAt；不批量重写旧JSON。相同操作幂等，回执和task.changed在原有命令事务内保存；同连接待提交队列立即重新参与调度。迟到accepted事实会重新计入并发，completed仍走正常收存；界面显示恢复占位及此前解除记录。

## 工程证据

所有日志位于[verification/unknown-slot](verification/unknown-slot/)。

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 故障复现与集成回归 | RED 5失败；实现后5/5；包含并发1、保留费用、幂等、重开、备份、26→27迁移、拒绝活跃/错attempt/错集、迟到accepted | red.log、green1.log |
| 界面交互 | 确认门槛与准确请求RED→GREEN；迟到accepted提示另有RED证据 | ui-red.log、ui-green.log、late-ui-red.log |
| 全引擎/集成 | 835/835，114文件 | engine-final.json、engine-final.log |
| 全挂载界面 | 94/94，20文件 | renderer-final.log |
| 类型/构建 | 通过 | typecheck-final.log、build-final.log |
| 最终目录包 | 原生SQLite、Sharp、媒体运行时通过，21个out文件与ASAR一致 | package-final.log、package-verify.json、package-hashes.json |
| 最终包Electron | 3/3，2文件：subprojects、packaged-startup | electron-final.log |
| 真实调用与最终包引擎一致 | main/preload共7文件哈希不变；最终只补了界面状态文案 | real-runtime-hashes.json、real-final-runtime-comparison.json |

第一次Electron命令误纳入历史P4专用验收；该用例硬编码要求release-p4目录，在产品启动前即拒绝当前包。已停止该集合，保留electron-all-interrupted.log；随后按既定SPEC-002范围对最终包运行上表3项。没有为跳过失败修改产品或断言，不把中断的全集合称为通过。打包器的模块枚举遇到powershell.exe ENOENT后采用已有手工遍历回退，最终退出0，包体原生检查通过。

按executing-plans要求完成一次独立只读审阅：没有Critical/Important问题；一个Minor为迟到accepted后的界面仍显示已解除。已用失败界面用例复现并修复，全界面回归94/94通过。只有这一轮审阅与一次修复，没有额外循环。

## 真实业务验证

使用已有项目D:/movieAgent/projects/连续创作真实验收-20261031-601872、既有Kimi k3.1-pro及应用配置；没有改Key、Base URL、模型ID或并发1。

1. 通过真实桌面任务详情操作解除原任务ddf98a18-42ef-4a42-9fd6-8cbd04b9ad6f占位；解除本身未创建任何新任务。截图见[任务详情](verification/unknown-slot/released-real-task.png)。
2. 在同一连接并发1下，单独批准一次新文本请求。约6秒SUCCEEDED、providerState=completed、collectionState=durable，返回“新的文本任务已正常执行。”。文本制品dfe8aac7-7d83-43af-baf0-db233043a0c7，36字节，SHA-256为42a7c3b685881bce1a48ef22c23d028dff220895dc79772b79d64b9a75737665。
3. 生成最终包后重开同一项目，只读取并核对：解除记录保留、新任务仍成功、并发仍1、相对于解除前仅增加这1条任务。reopenVerified=true，未再调用模型。
4. 只读数据库与文件hash核对通过：schema27，原unknown提交意图保留，原1,000,000 CNY微单位本地风险预留未减少，审计指向原attempt。它不是供应方实际扣费证明。

证据：[live-result.json](verification/unknown-slot/live-result.json)、[real-data-audit.json](verification/unknown-slot/real-data-audit.json)、[原始回复](verification/unknown-slot/real-response.txt)。本次恢复补验新增1次真实文本调用、0次新视频，实际账单未知。

## 交付与边界

最终可运行目录：D:/movieAgent/libtv-studio/apps/desktop/release-spec002-task-recovery/win-unpacked。工作区“启动MovieAgent.cmd”和验收项目“打开本次验收项目.cmd”已指向该包。此次没有重做NSIS安装程序；schema27项目需用支持27的新包打开。

这一并发堵点已解除。原未知请求仍待供应方核实，费用预留继续计入预算；预算上限等其他正常约束仍有效。本次没有补验历史栏目语义、声音/TTS/ASR/方言/口型或第二集成片，不把一次短文本探针称为全部业务质量验收通过。保留已有工作树和创作数据，修改前文件在before/，没有Git提交、合并或推送。
