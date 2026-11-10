import fs from'node:fs';import path from'node:path';
const base='D:/movieAgent/spec/002-project-subprojects',v=base+'/verification/long-requests';
const parse=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const tests=parse(v+'/engine-final.json');if(tests.numFailedTests||tests.numPassedTests!==830)throw Error('engine verification incomplete');
if(!/Tests\s+3 passed \(3\)/.test(fs.readFileSync(v+'/electron-final.log','utf8')))throw Error('electron verification incomplete');
if(!parse(v+'/package-verify.json').verified||!parse(v+'/package-hashes.json').verified)throw Error('package verification incomplete');
const update=(p,fn)=>fs.writeFileSync(p,fn(fs.readFileSync(p,'utf8')));
const launchers=['D:/movieAgent/启动MovieAgent.cmd','D:/movieAgent/projects/连续创作真实验收-20261031-601872/打开本次验收项目.cmd'];
for(const [i,p]of launchers.entries()){const backup=path.join(v,'launcher-before-'+i+'.cmd');if(!fs.existsSync(backup))fs.copyFileSync(p,backup);update(p,s=>s.replace(/release-spec002(?=[\\/])/g,'release-spec002-long-requests'))}
const report=[
'# 文本长请求等待与租约修复 · 2026-10-31','',
'状态：源码、完整引擎回归、Windows 本机包验证完成。真实 Kimi 再次请求未执行；旧未知任务保留原状态。','',
'用户要求延长等待时间。现已将应用配置导入的文本连接（OpenAI/Anthropic 兼容）HTTP 超时从60秒改为300秒（5分钟）；生成任务初始租约从30秒改为600秒（10分钟），在首次提交与原任务对账等待期间每30秒续期。其他模态 HTTP 超时仍保留原配置。','',
'续期同时校验引擎拥有权、工作者 token、owner 与尚未过期；过期或被其他工作者接管的租约不能复活。等待结束和异常退出时清理续期定时器并释放本工作者租约。继续保留迟到事实，不放宽旧工作者写入检查。','',
'文件配置在下次启动/同步时创建新的连接、模型和预设修订，使新请求使用5分钟。已批准计划与旧任务固定的60秒连接快照不改写；旧未知请求不会因更新自动重新POST。应用models.json格式和凭据内容未更改。','',
'## 证据','',
'- 先新增5项回归：长提交、长对账、工作者接管、初始10分钟与过期不复活、60秒连接升级到5分钟并保留旧修订。旧源码4失败、1通过（red.log），修改后两文件57/57通过（green-final.log）。',
'- 最终 TypeScript 类型检查、构建通过。',
'- 全部引擎/集成：830/830，113个文件通过（engine-final.json / engine-final.log）。',
'- Electron：3/3，保护凭据导入及新包 utility engine 启动/重开通过（electron-final.log）。',
'- package-verify.json verified=true；package-hashes.json 确认21个包内构建文件与当前out逐一SHA-256一致。',
'- 新包：D:/movieAgent/libtv-studio/apps/desktop/release-spec002-long-requests/win-unpacked/MovieAgent.exe。',
'- 验证均使用本地HTTP夹具和隔离工程。本次没有调用付费模型，未再次生成视频。',
'- 未修改界面，未重复运行此前91项界面挂载测试；其历史结果仍单独保留。','',
'## 使用与限制','',
'工作区启动MovieAgent.cmd和本次验收项目的打开脚本已指向新包。关闭当前旧窗口，再通过任一更新后的脚本打开，新连接设置生效；未强制关闭用户窗口。',
'此次交付工作区本机可运行目录，原有NSIS安装程序没有重新生成。不是已完成真实Kimi重试或自动记忆语义验收的声明。',
'证据目录：verification/long-requests/。',''
].join('\n');
fs.writeFileSync(base+'/long-requests.md',report);
update(base+'/real-acceptance.md',s=>s+'\n## 后续修复\n\n用户要求延长等待时间后，已修复为文本请求5分钟、任务租约10分钟并每30秒续期；830项引擎和3项Electron验证通过。旧未知请求未重发，真实文本/记忆效果仍未补验。详见 [修复记录](long-requests.md)。\n');
update(base+'/implementation.md',s=>s.replace('真实短路径部分通过，发现文本长请求堵点，自动记忆语义未验。','真实短路径部分通过；文本等待/租约缺口已工程修复，真实文本补验和自动记忆语义仍未完成。')+'\n后续修复：[文本长请求等待与租约](long-requests.md)，5分钟请求、10分钟租约及30秒续期；最新引擎830/830、Electron3/3通过。\n');
update(base+'/spec.md',s=>s.replace('文本长请求堵点待修复，自动记忆语义未验。','文本长请求等待与续期已工程修复，真实文本补验和自动记忆语义未验。').replace('本文描述 MovieAgent 自身的目标设计','| 2026-10-31 | 按用户要求延长文本请求至5分钟，任务租约至10分钟并每30秒续期；830项引擎及3项Electron验证通过 | 工程修复完成；旧未知任务不重发，真实补验见long-requests.md |\n\n本文描述 MovieAgent 自身的目标设计'));
update(base+'/progress.md',s=>s+'\n- Long-request fix: 用户要求延长时间；文本连接导入默认300000ms，生成租约600000ms，submit/reconcile每30000ms续期并在finally清理，保留token/owner/过期校验。RED4失败1通过 → GREEN57/57；冻结全引擎830/830，类型/构建、3项Electron、包体原生模块与21文件hash通过。源码和测试共5文件，单独保存before备份；真实Kimi未重发，视频未增加调用。工作区与验收项目脚本指向release-spec002-long-requests，当前窗口由用户重开以保留草稿。\n');
update('D:/movieAgent/spec/README.md',s=>s.replace('真实短路径部分通过，文本堵点待修复','真实短路径部分通过，文本等待已工程修复，真实补验待完成'));
fs.writeFileSync(v+'/result.json',JSON.stringify({status:'engineering-verified',textRequestTimeoutMs:300000,generationLeaseMs:600000,leaseRenewIntervalMs:30000,enginePassed:830,electronPassed:3,packageVerified:true,paidCallsThisPatch:0,liveKimiRetest:false,restartRequired:true},null,2));
console.log(JSON.stringify({verified:true,enginePassed:830,electronPassed:3,updatedLaunchers:launchers}));

