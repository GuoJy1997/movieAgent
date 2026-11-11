const fs=require('node:fs');
const path=require('node:path');
const root=__dirname;
const records=JSON.parse(fs.readFileSync(path.join(root,'libtv-observations.json'),'utf8'));
const refs=JSON.parse(fs.readFileSync(path.join(root,'reference-observations.json'),'utf8'));
const concerns=new Set(['01','03','04','08','13','14','15','16']);
for(const r of records){
 const n=Number(r.id);
 r.group=n<=5?'首页与项目':n<=15?'资产与弹层':n<=26?'Agent 与插件':n<=31?'内容内页':'画布与编辑器';
 r.health=r.status==='inconclusive'?'待复核':concerns.has(r.id)?'有改进点':['45','47','50'].includes(r.id)?'覆盖受限':'结构清楚';
 r.publicFile=r.id==='01'?null:r.file;
 if(r.id==='45')r.note='快捷键面板按四组排列，kbd 与说明分开；本帧右侧内容裁切可能受视口与截图方式影响，未据此确认产品溢出缺陷。我们的面板仍须限制宽度并支持滚动。';
 if(['43','44'].includes(r.id) && !r.note.includes('研究工具限制'))r.note+=' 全页截图可能触发组件重建，这属于研究工具限制，不能作为产品缺陷结论。';
 if(r.id==='54')r.note='生成历史实际为大型资产浏览 dialog，左侧来源分类，上方本项目/全部项目和媒体筛选；当前为空，失败/批量/真实产物状态未验证。';
 if(r.id==='50')r.health='覆盖受限';
}
fs.writeFileSync(path.join(root,'libtv-observations.json'),JSON.stringify(records,null,2)+'\n');
fs.writeFileSync(path.join(root,'research-data.js'),'window.LIBTV_EVIDENCE='+JSON.stringify(records)+';\nwindow.REFERENCE_EVIDENCE='+JSON.stringify(refs)+';\n');
const escape=s=>String(s).replaceAll('|','\\|').replaceAll('\n',' ');
let audit=`# LibTV 界面实看与组件研究记录\n\n日期：2026-10-24。目标：为个人 Electron 创作工具定义统一的组件与页面风格。\n\n## 覆盖与方法\n\n使用当前已登录的 LibTV 页面，实际点选导航、tab、菜单、模型选择、表单和已有画布；保存当轮截图。记录 **56 个界面/状态**：54 个有可观察结果，2 个预览/工具层结果不确定。数量包括同页的不同状态，**不代表 56 个独立页面，也不代表每一个功能都验收完成**。\n\n截图与 UI 文本是观察证据；“可迁移到我们的产品”属于设计推导。除第 05 项 DOM 读取的颜色/尺寸外，文中的宽度等为观察估计。静态截图不能证明全部动效、键盘可访问性或性能。\n\n“结构清楚”仅表示该帧的信息层级可理解；“有改进点”指本轮发现的具体问题或设计取舍；“覆盖受限”表示模型载入、裁图或工具条件限制；“待复核”不用于外观判断。\n\n## 关键判断\n\n1. 主要质感来自灰阶层级、精确的行高与间距、统一字阶及控件边界。LibTV 的内容图与 UI 框架有明确分工。\n2. 首页、资产浏览、Agent、画布和 3D 子编辑器具有不同结构，不能用同一套卡片模板换内容冒充全产品。\n3. 菜单、筛选 popover、表单 dialog、大型资产浏览 dialog、确认层必须分别设计。\n4. tab 的视觉需要跟随“文档 / 页面分区 / 互斥视图 / 组合条件”这四种关系。\n5. LibTV 也有不应继承的地方：自动促销/白色问卷打断、未改表单的退出确认、部分文本截断。菜单触边与 Escape 行为仍需针对性验证。\n\n## 已知账户变化\n\n点击项目列表的“新建文件夹”时，系统立即新增了一个空的“未命名文件夹”，没有先弹出名称表单。已在进行过程中向用户说明；未删除。除此之外，本轮没有已知的新内容提交、真实生成、发布、付款或权限变更。Skill 点击只加入了输入器上下文，未发送；草稿 token 的最终清理状态未核实，研究标签页不作为交付保留。\n\n## 未覆盖或不能确认\n\n- 当前资产/生成历史为空，未验证真实资产详情、批量选择、上传完成/失败、取消恢复等状态。\n- 没有新开真实 Agent 任务；消息流、工具运行、计费、预算审批、重试、部分成功没有运行证据。\n- 付费生成、图像加工、视频加工、最终发布/分享和账户设置保存未执行。\n- 图片灯箱及图片工具菜单的截图不稳定，保留为待复核；不能说已完整看过。\n- 插件页只确认截图中的 OpenClaw + CLI 等可见状态，没有逐一确认所有平台组合。\n- 3D 页面观察了布局、对象/机位/轨迹标签与时间轴；没有编辑关键帧、录制、导出或连接手机。\n- 支付码截图不进入交付图库；运动轨迹截图裁去动态配对码区域。\n- 浏览器全页截图曾影响状态组件重建；后来改用当前视口。由截图造成的裁切不计为产品缺陷。\n\n## 逐项记录\n\n| 编号 | 界面 / 状态 | 健康判断 | 证据与说明 |\n| --- | --- | --- | --- |\n`;
audit+=records.map(r=>`| ${r.id} | ${escape(r.surface)} | ${r.health} | ${escape(r.note)} ${r.publicFile?`[截图](screenshots/${r.publicFile})`:'支付码截图不展示'} |`).join('\n');
audit+='\n\n## 六站参考范围\n\n公开官方资料共核实 30 个组件条目，详见 [来源研究](references-research.md)。以下为实际浏览器观察；文字/源码研究不冒充实看动效。\n\n| 编号 | 来源与组件 | 可观察结果 |\n| --- | --- | --- |\n';
audit+=refs.map(r=>`| ${r.id} | [${escape(r.site)} / ${escape(r.component)}](${r.url}) | ${escape(r.note)} ${r.file?`[截图](screenshots/${r.file})`:''} |`).join('\n');
audit+='\n\n## 如何使用交付物\n\n- [可交互样板](index.html)：三种材质、组件、五类页面组合与实看图库。所有运行结果是本地演示。\n- [完整设计规范](design-system.md)：页面骨架、28 类组件合同、模型连接、动效及后续验收。\n- [设计变量](tokens.json)：提案值，可供后续实现复用。\n- [来源与许可](references-research.md)：未购买模板；不能把 Free 标签自动等同于 MIT。\n\n## 规格审阅\n\n独立 builder check 已完成，结论为没有阻碍制定后续计划的关键缺口。它不代替用户对视觉风格的批准，也不证明正式软件已实现。\n';
fs.writeFileSync(path.join(root,'audit.md'),audit);
let missing=[];for(const r of [...records,...refs]){const file=r.publicFile===null?null:r.publicFile||r.file;if(file&&!fs.existsSync(path.join(root,'screenshots',file)))missing.push(file);}
if(missing.length)throw new Error('Missing screenshots: '+missing.join(', '));
console.log(JSON.stringify({libtvRecords:records.length,observed:records.filter(r=>r.status==='observed').length,inconclusive:records.filter(r=>r.status==='inconclusive').length,referenceRecords:refs.length,missingScreenshots:missing.length}));
