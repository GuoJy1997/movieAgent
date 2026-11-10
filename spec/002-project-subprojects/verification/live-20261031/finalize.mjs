import fs from'node:fs';import path from'node:path';import{createHash}from'node:crypto';import{DatabaseSync}from'node:sqlite';
const dir='D:/movieAgent/spec/002-project-subprojects/verification/live-20261031',base='D:/movieAgent/spec/002-project-subprojects';
const s=JSON.parse(fs.readFileSync(path.join(dir,'state.json'),'utf8')),probe=JSON.parse(fs.readFileSync(path.join(dir,'media-probe.json'),'utf8').replace(/^\uFEFF/,''));
const movie=path.join(s.projectRoot,s.exportReceipt.relativePath),sha=createHash('sha256').update(fs.readFileSync(movie)).digest('hex');
if(sha!==s.exportReceipt.hash||sha!==s.deliverable.sourceHash)throw Error('EXPORT_HASH_MISMATCH');
const db=new DatabaseSync(path.join(s.libraryRoot,'library.sqlite'),{readOnly:true});
const attempts=db.prepare("SELECT json_extract(plan_json,'$.adapterId') adapter,json_extract(view_json,'$.state') state,json_extract(view_json,'$.errorCode') errorCode,json_extract(view_json,'$.reportedActualMicros') reportedActualMicros,json_extract(view_json,'$.settlementStatus') settlementStatus FROM task_attempt JOIN generation_task USING(task_id) JOIN generation_prepared USING(prepared_id)").all();
const posts=db.prepare('SELECT COUNT(*) n FROM task_attempt WHERE intent_json IS NOT NULL').get().n;db.close();
if(posts!==2)throw Error('UNEXPECTED_SUBMIT_INTENTS');
const launcher=path.join(s.projectRoot,'打开本次验收项目.cmd'),exe='D:\\movieAgent\\libtv-studio\\apps\\desktop\\release-spec002\\win-unpacked\\MovieAgent.exe';
const args=['--workspace-child','--project-root='+s.projectRoot,'--launcher-data='+path.join(dir,'launcher'),'--user-data-dir='+path.join(dir,'user-data'),'--model-config=D:/movieAgent/libtv-studio/config/models.json'];
fs.writeFileSync(launcher,'@echo off\r\nchcp 65001 >nul\r\nstart "MovieAgent 验收项目" "'+exe+'" '+args.map(x=>'"'+x+'"').join(' ')+'\r\n');
const result={status:'partial-pass-with-text-blocker',projectRoot:s.projectRoot,videoPath:movie,launcher,requestedVideoSeconds:4,actualDurationSeconds:Number(probe.format.duration),videoGenerationCount:1,textGenerationCount:1,submitIntents:posts,exportHash:sha,videoBytes:Number(probe.format.size),crossEpisodeReuse:s.sharedAssetProof,automaticMemory:'not-verified-pending-no-model',tasks:attempts,billing:'Video estimate CNY 1.60; actual billing unknown. Text request outcome/usage unknown.'};
fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));
const report=[
'# SPEC-002 真实短路径验收 · 2026-10-31','',
'结论：部分通过。真实视频生成 → 镜头选用 → 时间线 → 本机渲染 → MP4 导出 → 制品登记 → 第二集复用已通过。真实文本 Agent 请求得到未知结果，自动剧情摘要未完成，不能据此宣称全自动主流程已通过。','',
'## 实际工程与媒体','',
'- 项目：'+s.projectRoot,
'- 第一集：'+s.a.title+'；第二集：'+s.b.title,
'- 成片：'+movie,
'- 请求 MiniMax-H3-Highspeed 4 秒，768P、9:16；本机输出 H.264/AAC、1080×1920、30fps，实际 '+probe.format.duration+' 秒。',
'- MP4 '+probe.format.size+' 字节；导出 hash 与登记制品源 hash 一致：'+sha,
'- 视频任务 '+s.videoTask.taskId+'；保存原任务、原件和输出，仅一个视频提交意图。',
'- 第二集画布直接采用第一集同一 artifactId，来源归属保留，未复制原件或生成第二段视频。','',
'## 真实调用和费用','',
'本次按用户“跑一遍看看，视频用最短时间”授权调用已配置服务。数据库确认仅两个生成提交意图：1 次 Kimi 文本、1 次 MiniMax 视频。视频配置估价 ¥1.60，实际结算/账单未知；文本使用量和是否计费未知。未新增 TTS、ASR、对口型或图像生成调用。','',
'## 已发现的堵点','',
'Kimi k3.1-pro 的 Agent 提案请求等待约一分钟后没有拿到可收存的结果，最终显示 UNKNOWN / RECONCILE_REQUIRED，错误 STALE_LEASE。generation_fact 只有 unknown，没有 completed；不把它记作生成成功。',
'源码证据：packages/engine/src/generation-service.ts:268 的 claim 将租约固定为30秒；packages/engine/src/scheduler.ts:31 等待 submit 期间没有续期；apps/desktop/src/main/model-config-import.ts:80 将导入连接超时设置为60000毫秒。长请求可能先过租约再超时，不能仅据此判断供应商服务是否不稳定。',
'本次未修改生产源码、未重复原 Kimi POST、未新建另一个同类请求绕过未知任务。接下来的视频链路使用明确标记的人工验收剧本，并未伪装成 Agent 采用结果。',
'自动记忆没有配置该项目整理模型，完成快照保留为 pending，taskId=null；没有留下将来自动触发的记忆付费任务。真实自动摘要、下一集语义连续性、配音与对口型仍未通过此次验收。','',
'## 证据','',
'- verification/live-20261031/result.json：请求数量、媒体与来源结果',
'- verification/live-20261031/media-probe.json：实际视频格式',
'- verification/live-20261031/real-canvas-a.png：第一集生成画布',
'- verification/live-20261031/real-shared-canvas-b.png：第二集复用画布',
'- verification/live-20261031/state.json：本次固定业务 ID 与计划；无 API Key',
'- '+launcher+'：直接打开本次工程','',
'中间脚本问题：双文本边同时连接单一 prompt 输入被 GRAPH_PORT_LIMIT 拒绝，未发供应商请求；改为单提示词入口后通过。首轮 Node strip-only 不支持 TypeScript 参数属性，切换运行器 transform-types；均没有修改产品规则或重复付费提交。',''
].join('\n');
fs.writeFileSync(path.join(base,'real-acceptance.md'),report);
const update=(f,fn)=>fs.writeFileSync(f,fn(fs.readFileSync(f,'utf8')));
update(path.join(base,'implementation.md'),x=>x.replace('状态：工程实现、本机回归和包体验证完成；用户实际试用与真实模型语义质量尚未验收。','状态：工程实现、本机回归和包体验证完成；真实短路径部分通过，发现文本长请求堵点，自动记忆语义未验。').replace('## 验证边界','## 真实短路径补验\n\n2026-10-31 已执行真实服务补验：视频到成片和跨集复用通过，文本请求出现结果未知/STALE_LEASE。详见 [真实验收报告](real-acceptance.md)。下节原冻结验证边界对应之前未调用真实服务的一轮，不能覆盖本次补验。\n\n## 验证边界'));
update(path.join(base,'spec.md'),x=>x.replace('工程实现、本机回归和包体验证完成；用户实际试用与真实服务语义未验。','工程实现、本机回归和包体验证完成；真实视频短路径部分通过，文本长请求堵点待修复，自动记忆语义未验。').replace('本文描述 MovieAgent 自身的目标设计','| 2026-10-31 | 真实短路径：4秒视频请求、3.73秒成片、导出/制品和第二集复用通过；Kimi 长请求结果未知，自动记忆未验 | 部分通过；堵点及原任务见 real-acceptance.md |\n\n本文描述 MovieAgent 自身的目标设计'));
update('D:/movieAgent/spec/README.md',x=>x.replace('| Approved；工程完成，真实服务未验 | 2026-10-31 |','| Approved；工程完成，真实短路径部分通过，文本堵点待修复 | 2026-10-31 |'));
update(path.join(base,'progress.md'),x=>x+'\n- Real acceptance 2026-10-31: 用户授权最短视频实跑；1次 Kimi 文本结果未知（STALE_LEASE），未重复POST；使用人工验收剧本完成1次MiniMax-H3-Highspeed 4秒请求，实际3.733秒MP4、制品登记和第二集直接复用通过。工程未改动；长请求租约/超时为真实堵点，自动记忆pending无付费任务。详见real-acceptance.md。\n');
console.log(JSON.stringify({status:result.status,videoPath:movie,durationSeconds:result.actualDurationSeconds,submitIntents:posts,launcher}));

