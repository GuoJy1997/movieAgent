import fs from'node:fs';import path from'node:path';
const b='D:/movieAgent/spec/002-project-subprojects/',v=b+'verification/';
const engine=JSON.parse(fs.readFileSync(v+'frozen-engine-final.json','utf8'));
if(engine.numFailedTests||engine.numPassedTests!==825)throw Error('Engine verification incomplete');
const renderer=fs.readFileSync(v+'frozen-renderer-final.log','utf8').replace(/\u001b\[[0-9;]*m/g,'');
const ui=renderer.match(/Tests\s+(\d+) passed \((\d+)\)/),files=renderer.match(/Test Files\s+(\d+) passed \((\d+)\)/);
if(!ui||ui[1]!==ui[2]||ui[1]!=='91'||!files||files[1]!==files[2])throw Error('Renderer verification incomplete');
if(!/Tests\s+3 passed \(3\)/.test(fs.readFileSync(v+'frozen-electron.log','utf8')))throw Error('Electron verification incomplete');
if(!JSON.parse(fs.readFileSync(v+'package-verify.json')).verified||!JSON.parse(fs.readFileSync(v+'frozen-package-hashes.json')).verified)throw Error('Package verification incomplete');
const update=(p,fn)=>fs.writeFileSync(p,fn(fs.readFileSync(p,'utf8')));
const table=[
'## 冻结验证','',
'本次源码冻结后完成以下检查。真实服务语义质量和用户实际创作验收另列。','',
'| 检查 | 实际结果 | 证据 |','| --- | --- | --- |',
'| TypeScript 类型检查 | 通过 | verification/types-release-final2.log |',
'| 构建 | 通过 | verification/build-frozen.log |',
'| 全部引擎/集成测试 | 825/825；113 个文件通过 | verification/frozen-engine-final.json、frozen-engine-final.log |',
'| 全部挂载界面测试 | 91/91；'+files[1]+' 个文件通过 | verification/frozen-renderer-final.log |',
'| Windows 安装包 | 构建成功 | verification/package-frozen.log；apps/desktop/release-spec002/ |',
'| 包内容、原生模块、媒体运行时 | verified: true | verification/package-verify.json |',
'| 包与当前构建一致性 | 全部 21 个 out 文件 SHA-256 一致 | verification/frozen-package-hashes.json |',
'| 实际包体 Electron | 3/3；分集/草稿/多画布、utility engine 重开和性能边界 | verification/frozen-electron.log、electron-packaged.png |','',
'最终引擎命令：npm test -- --maxWorkers=4 --testTimeout=30000 --reporter=default --reporter=json --outputFile.json=<verification>/frozen-engine-final.json。最终界面命令：npx vitest run --config vitest.renderer.config.ts --testTimeout=30000 --hookTimeout=60000，使用本机 Chrome。包体运行 subprojects.test.ts 和 packaged-startup.test.ts，指向 release-spec002/win-unpacked。','',
'保留中间失败日志：首次冻结回归有 5 项在默认 10 秒上限超时；界面运行期间打包文件变动触发 Vite 热重载，并有启动/交互超时。停止打包后重新运行，采用 30 秒测试上限，全部通过；没有为消除超时修改业务断言。ASAR 初次比对脚本用了 Unix 分隔符导致查找失败，改为 Windows 规范路径后全部匹配，包体内容无需改动。','',
'已备份并更新工作区启动脚本，指向验证后的 release-spec002 包；继续使用原应用模型配置路径。测试使用隔离工程，未打开或迁移用户正在创作的工程。','',
].join('\n');
update(b+'implementation.md',s=>s.replace('状态：实现已冻结；最终整套回归、包体验证进行中。以本文件后续的冻结验证表为准，不能把中间失败日志当成最终结果。','状态：工程实现、本机回归和包体验证完成；用户实际试用与真实模型语义质量尚未验收。下表记录冻结版本结果，中间失败和修复过程另行保留。').replace(/## 冻结验证[\s\S]*?(?=## 验收条件与用例对应)/,table+'\n'));
update(b+'plan.md',s=>s.replaceAll('- [ ]','- [x]')+'\n完成记录：全部任务的工程实现与本机验收已完成，详见 [实施与验收记录](implementation.md)。真实服务质量不在本次通过结论中。\n');
update(b+'progress.md',s=>s+'\n- Final frozen: typecheck/build 通过；引擎 825/825（113 files），renderer 91/91（'+files[1]+' files），实际包体 Electron 3/3。package-verify 为 true，ASAR 与当前 out 的21个文件全部一致。最终日志见 implementation.md。\n- Timeout audit: 初次冻结5项达到10秒测试超时；打包曾触发 renderer Vite 热重载。冻结源码不变，停止打包后以30秒上限复验全部通过，保留中间日志。\n- Recovery completion: 新增当前摘要撤回阻止旧 pin 再用、已知外父项目生成素材不归为无主、长作品显式“仅完成说明”路径；模型输入不静默截断，完整采用内容保留快照。\n- Delivery: 工作区启动脚本备份后指向 release-spec002；没有提交用户真实模型请求，没有打开/迁移真实创作工程。保留历史工作树和用户文件。工程完成，真实模型语义质量与用户试用未验。\n');
update(b+'spec.md',s=>s.replace('实现已冻结，工程回归进行中；实际结果与边界见 [实施与验收记录](implementation.md)。','工程实现、本机回归和包体验证完成；用户实际试用与真实服务语义未验。结果见 [实施与验收记录](implementation.md)。').replace('本文描述 MovieAgent 自身的目标设计','| 2026-10-31 | 完成全部六项实施任务、独立审阅问题修复及冻结工程验收；825 集成、91 界面、3 包体测试通过 | 工程完成；真实模型语义质量未验，详见 implementation.md |\n\n本文描述 MovieAgent 自身的目标设计'));
update('D:/movieAgent/spec/README.md',s=>s.replace('Approved；Implementing，工程验收进行中','Approved；工程完成，真实服务未验'));
const summary={date:'2026-10-31',engine:{passed:825,files:113},renderer:{passed:91,files:Number(files[1])},electron:{passed:3,files:2},packageVerified:true,packagedBuildFilesMatched:21,realModelCalls:0,userProjectsMigratedDuringTests:0};
fs.writeFileSync(v+'final-results.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));

