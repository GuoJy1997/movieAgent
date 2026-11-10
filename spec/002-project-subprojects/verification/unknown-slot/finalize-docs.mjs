import fs from 'node:fs';import path from 'node:path';
const root='D:/movieAgent',dir=path.join(root,'spec/002-project-subprojects'),ev=path.join(dir,'verification/unknown-slot');
const read=f=>fs.readFileSync(f,'utf8');const write=(f,t)=>fs.writeFileSync(f,t);
const live=JSON.parse(read(path.join(ev,'live-result.json'))),engine=JSON.parse(read(path.join(ev,'engine-final.json'))),pkg=JSON.parse(read(path.join(ev,'package-verify.json'))),hashes=JSON.parse(read(path.join(ev,'package-hashes.json')));
if(!live.reopenVerified||live.concurrency!==1||live.additionalTextRequests!==1||!engine.success||engine.numPassedTests!==835||!pkg.verified||!hashes.verified||!/Tests\s+94 passed/.test(read(path.join(ev,'renderer-final.log')))||!/Tests\s+3 passed/.test(read(path.join(ev,'electron-final.log'))))throw Error('FINAL_EVIDENCE_INCOMPLETE');
const report=`# 未知任务并发占用恢复验收

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
`;
write(path.join(dir,'unknown-slot-verification.md'),report);
let p=path.join(dir,'unknown-slot-recovery.md'),s=read(p).replaceAll('- [ ]','- [x]');s+='\n结果：工程835/835、界面94/94、最终包Electron3/3，真实并发1下1条新Kimi请求6秒成功，最终包重开保持。单轮审阅的迟到accepted界面提示已修复。详见[验收报告](unknown-slot-verification.md)。\n';write(p,s);
p=path.join(root,'spec/README.md');s=read(p).replace('验收库旧未知任务占并发仍阻塞','旧未知任务并发恢复已真实验证，其他语义仍部分未验');write(p,s);
p=path.join(dir,'spec.md');s=read(p).replace('验收库历史未知任务仍占唯一并发位，历史栏目等语义未验，详见 [真实补验](real-text-acceptance.md)。','旧未知任务并发堵点已修复并在并发1下真实验证，见 [恢复验收](unknown-slot-verification.md)；历史栏目等语义仍未验，详见 [真实补验](real-text-acceptance.md)。');
s=s.replace('7. 同一次完成快照以幂等键登记更新任务，重复点击完成或重开不重复付费提交；结果未知时查原任务，不直接新建请求。','7. 同一次完成快照以幂等键登记更新任务，重复点击完成或重开不重复付费提交；结果未知时查原任务，不直接新建请求。未知请求无法核实时，可在任务详情明确确认风险后解除本机并发占用，以继续不同的新任务；保留原unknown、请求历史和费用预留，不自动重发旧任务。');
s=s.replace('### 6.3 项目目录','- 未知请求的手动解除固定taskId与attemptId，仅无有效工作者租约时允许；跨子项目编辑守卫仍生效。schema27独立审计表保存本机决定，操作与回执/事件原子保存。仅unknown且已解除不占并发；迟到accepted重新占位、completed正常收存，预算预留不因解除减少。\n\n### 6.3 项目目录');
s=s.replace('### 6.4 接口与模块','### 6.4 接口与模块\n\n恢复接口：task.releaseUnknownSlot({taskId, attemptId, acknowledgeRisk:true})返回TaskView；可选concurrencyReleasedAt投影审计记录并兼容旧JSON。任务详情提供风险确认与状态，细节见[恢复计划](unknown-slot-recovery.md)。');
s=s.replace('| AC-18 | 验证分层 | fixture 验证归属、连续性引用和恢复；真实模型语义质量另验，不把模拟当效果保证 |','| AC-18 | 验证分层 | fixture 验证归属、连续性引用和恢复；真实模型语义质量另验，不把模拟当效果保证 |\n| AC-19 | 未知请求并发恢复 | 明确风险确认后可解除旧unknown占位；原请求/费用保留、不自动重发、活跃/错attempt/错集拒绝、迟到accepted重新占位、重开及备份保持；并发1可继续不同新任务 |');
s+='\n\n## 10. 未知任务恢复补丁\n\n2026-10-31：用户授权“解决这个堵点”后完成schema27和任务详情恢复操作。835项引擎、94项界面及最终包3项Electron通过；原任务不重发、风险预留保留，真实并发1下新Kimi请求6秒成功，最终包重开无新增任务。详见[恢复验收](unknown-slot-verification.md)。此结果更新前述历史堵点，不扩大其他真实服务验收范围。\n';write(p,s);
p=path.join(dir,'implementation.md');s=read(p).replace('验收库历史未知任务仍占唯一并发位，历史栏目、声音/对口型等未验；见 [真实补验](real-text-acceptance.md)。','旧未知任务并发占用已修复并真实验证，见[恢复验收](unknown-slot-verification.md)；历史栏目、声音/对口型等仍未验，见 [真实补验](real-text-acceptance.md)。');s+='\n\n## 未知任务恢复补丁（schema27）\n\n新增明确确认风险后的task.releaseUnknownSlot与任务详情入口。原unknown、费用和请求保留，迟到事实正常处理；默认并发1未改。最终835/835引擎、94/94界面、3/3包体Electron和21文件ASAR核对通过；真实新Kimi请求6秒成功并重开保持。详见[完整恢复验收](unknown-slot-verification.md)。前文schema26及冻结数据为原实施时点。\n';write(p,s);
p=path.join(dir,'progress.md');s=read(p)+'\n- Unknown-slot recovery：按用户授权完成schema27独立审计、task.releaseUnknownSlot、任务详情风险确认及状态展示；5项集成RED→GREEN，界面RED→GREEN并修复单次审阅的迟到accepted提示。最终引擎835/835、界面94/94、类型/构建、目录包原生/媒体、21文件hash及Electron3/3通过。真实原unknown解除后仍保留1,000,000微单位预留；同连接并发1下只新增1次Kimi文本请求，6秒SUCCEEDED，最终包重开无重复。启动脚本已更新。账单仍未知，未增加视频。详见unknown-slot-verification.md。\n';write(p,s);
for(const name of ['long-requests.md','real-text-acceptance.md']){p=path.join(dir,name);s=read(p);s+='\n\n## 后续恢复更新（2026-10-31）\n\n本报告所记旧unknown占并发堵点已在后续补丁解决：任务详情显式风险确认后解除本机占位，旧请求及费用风险仍保留；并发1下1次新Kimi请求6秒成功，最终包重开保持。详见[恢复验收](unknown-slot-verification.md)。上文未修复的叙述是该轮验收时点，不代表当前状态；其余真实语义未验项不变。\n';if(name==='long-requests.md')s=s.replace('历史未知任务占并发仍是该验收库堵点','历史未知任务占并发在后续补丁已恢复，见[恢复验收](unknown-slot-verification.md)');else s=s.replace('**该验收库仍有一条历史未知任务占用唯一并发位，不能据此宣布整条业务已无堵点。**','**本轮记录时旧未知任务仍占并发；后续已修复并真实验证，见[恢复验收](unknown-slot-verification.md)。其余真实语义仍为部分覆盖。**');write(p,s);}
console.log(JSON.stringify({updated:['spec/README.md','spec.md','implementation.md','progress.md','long-requests.md','real-text-acceptance.md','unknown-slot-recovery.md','unknown-slot-verification.md'],evidenceVerified:true}));
