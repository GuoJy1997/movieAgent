import fs from 'node:fs';
const base='D:/movieAgent/spec/002-project-subprojects/';
const update=(p,fn)=>{const original=fs.readFileSync(p,'utf8');const next=fn(original);fs.writeFileSync(p,next);};
update(base+'spec.md',s=>s.replace('Implementing；实施与验收结果见 plan.md、progress.md 和 verification/。','实现已冻结，工程回归进行中；实际结果与边界见 [实施与验收记录](implementation.md)。')
.replace('以下为待实施标准，本次未执行：','以下为批准的验收标准；工程用例与实际结果见 [实施与验收记录](implementation.md)。真实模型语义验收独立列明，不把本地 fixture 视作真实服务质量通过。')
.replace('10. 本次规格编写不运行上述迁移，也不改变已有项目目录。','10. 编写规格时不运行迁移；实施验收使用隔离夹具。用户现有项目只在实际打开时按迁移流程升级，验收不擅自打开或迁移用户工程。')
.replace('## 9. 实施边界、待审默认与记录','## 9. 实施边界、批准决定与记录')
.replace('### 9.1 建议依赖顺序','### 9.1 实施依赖顺序')
.replace('以上是依赖边界，不是已经批准的实施任务；详细计划在规格审阅后另写。','用户已于 2026-10-31 批准实施；详细任务见 [实施计划](plan.md)，实际执行和验收见 [执行记录](progress.md) 与 [实施报告](implementation.md)。')
.replace('### 9.2 待审设计默认','### 9.2 已批准设计默认')
.replace('固定两层、多画布/多时间线、主时间线指针、版本固定策略和本稿目录形态均为可审阅默认；不表述为已经实现。','固定两层、多画布/多时间线、主时间线指针、固定版本策略与目录形态随最新规格获准实施。规格批准、源码实现、工程验收及真实服务验收分别记录。')
.replace('本文描述 MovieAgent 自身的目标设计','| 2026-10-31 | 用户明确“那开始执行吧”，批准本稿并开始按 plan.md 实施 | Approved；实现和验收见 implementation.md |\n\n本文描述 MovieAgent 自身的目标设计'));
const mapping=String.raw`## 验收条件与用例对应

以下列出工程证据；真实模型语义质量仍属未验项。

| 条件 | 实际用例或验证 |
| --- | --- |
| AC-01 / AC-03 | subprojects、subproject-directory、subproject-deliverables；实际包体 Electron 创建两集、多画布并重开 |
| AC-02 / AC-12 / AC-16 | subproject-assets、subproject-routing、subproject-hardening、subproject-review，及原有声音版本测试；固定版本可跨兄弟集引用，外父项目拒绝 |
| AC-04 | subproject-deliverables：本机 FFmpeg 真正输出两份 MP4，登记对应时间线修订、媒体与 hash |
| AC-05 / AC-06 / AC-07 | subproject-memory：本地 HTTP 服务自动整理、下一集 Agent 固定清单、无模型、迟到/未知、重开与旧完成快照再采用 |
| AC-08 / AC-09 | subproject-memory 与 subproject-review：规则优先、前期关系/修订锁定、撤回、采用旧时间线而非新候选 |
| AC-10 / AC-11 | subproject-hardening、subproject-review、draft-navigation；包体 Electron 实测取消/放弃/保存后切集 |
| AC-13 / AC-14 / AC-15 | subprojects 填充旧 schema25、原有迁移/维护测试、subproject-backup、subproject-directory；旧 JSON/ID/用户文件和固定引用保留 |
| AC-17 / AC-18 | renderer 交互、包体完成操作与 memory HTTP fixture；空配置不请求真实服务，摘要任务和输入来源可见 |

目录是可读资料与交付的工作区域；原件存储与已完成导出沿用原有对象存储和导出路径。本次没有把所有旧文件重新按集搬迁，也没有把手动放进目录的文件自动当成已登记资产。
`;
update(base+'implementation.md',s=>s.replace('## 执行裁定',mapping+'\n## 执行裁定'));
const launch='D:/movieAgent/启动MovieAgent.cmd';
const backup=base+'verification/launcher-before.cmd';if(!fs.existsSync(backup))fs.copyFileSync(launch,backup);
update(launch,s=>{if(!s.includes('release-flow-verified')&&!s.includes('release-spec002'))throw Error('unexpected launcher');return s.replace('release-flow-verified','release-spec002');});
console.log('Updated approved-spec wording, coverage mapping and verified-package launcher.');
