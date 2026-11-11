const app = document.getElementById('app');
const modal = document.getElementById('modal');
const dialogContent = document.getElementById('dialog-content');
const toastElement = document.getElementById('toast');
const motionToggle = document.getElementById('motion-toggle');
const systemReduced = matchMedia('(prefers-reduced-motion: reduce)');
let manualReduced = false;
let currentPage = 'home';
let transitionBusy = false;
let taskRunning = false;
let zoom = 1;
let epoch = 0;
let toastTimer;
let timers = new Set();
let activeDraft = '';
const icon = name => `<i data-lucide="${name}"></i>`;
const image = '<img src="assets/portal.png" alt="虚构影片 ECHO 的宇航员与圆环场景">';
const isReduced = () => manualReduced || systemReduced.matches;
const refreshIcons = () => lucide.createIcons({attrs:{'aria-hidden':'true'}});

function notify(message) {
  clearTimeout(toastTimer);toastElement.textContent=message;toastElement.classList.add('show');
  toastTimer=setTimeout(()=>toastElement.classList.remove('show'),3000);
}
function schedule(fn,ms) {
  const owner=epoch;
  const timer=setTimeout(()=>{timers.delete(timer);if(owner===epoch) fn();},ms);
  timers.add(timer);
}
function cleanup() {epoch++;for(const timer of timers)clearTimeout(timer);timers.clear();taskRunning=false;activeDraft='';}
function homeMarkup() {
  return `<section class="home"><div class="home-art">${image}</div><div class="grain"></div>
    <nav class="home-nav"><div class="nav-pills"><button class="active" data-action="home">我的项目</button><button data-action="open-assets">素材空间</button><button data-action="settings">模型连接</button></div><span class="library-status">${icon('database')} <span>本机资料库</span><span class="dot"></span></span></nav>
    <section class="hero"><div class="eyebrow">YOUR NEXT FRAME STARTS HERE</div><h1>ECHO<span>.</span></h1><p class="subhead">从想象，到下一镜。</p><p class="description">让素材、模型与创作意图，在同一个空间连接。<br>你的工作台，由你掌镜。</p><div class="actions"><button class="primary" data-action="open-project">进入工作台 ${icon('arrow-up-right')}</button><button class="secondary" data-action="about">${icon('play')} 动效说明</button></div><div class="hero-marker">01 / ECHO<span>ORIGINAL CONCEPT FRAME</span><span>16:9 · CINEMATIC STUDY</span></div></section>
    <section class="collection"><div class="collection-head"><h2>继续创作</h2><span>01 PROJECT / 一个场景，三种观察方式</span></div><div class="project-shelf">
    <button class="project-card" data-action="open-project"><div class="card-media">${image}</div><div class="card-meta"><strong>ECHO · 回声</strong><span>打开画布 ${icon('arrow-up-right')}</span></div><div class="card-reflection"></div></button>
    <button class="project-card" data-action="preview-detail"><div class="card-media">${image}</div><div class="card-meta"><strong>空间与光</strong><span>细节裁切</span></div><div class="card-reflection"></div></button>
    <button class="project-card" data-action="preview"><div class="card-media">${image}</div><div class="card-meta"><strong>镜头语言</strong><span>运镜演示</span></div><div class="card-reflection"></div></button></div></section>
    <div class="home-note">${icon('info')} UI 与动效探索 · 示例素材由 AI 生成 · 不调用模型、不产生费用</div></section>`;
}
function workspaceMarkup() {
  return `<section class="workspace" data-task-state="idle"><nav class="dock" aria-label="工作区导航"><button class="home-icon" data-action="home" title="返回项目" aria-label="返回项目">${icon('aperture')}</button><button class="active" data-action="canvas" title="画布" aria-label="画布">${icon('workflow')}</button><button data-action="assets" title="资产" aria-label="资产">${icon('images')}</button><button data-action="timeline" title="时间线" aria-label="时间线">${icon('clapperboard')}</button><button data-action="agent" title="创作 Agent" aria-label="创作 Agent">${icon('sparkles')}</button><button class="bottom" data-action="settings" title="模型设置" aria-label="模型设置">${icon('sliders-horizontal')}</button></nav>
    <header class="workspace-toolbar"><div class="project-heading"><button data-action="home">ECHO / 短片创作 ${icon('chevron-down')}</button><span class="save-state"><span class="dot"></span>动效探索 · 未保存业务数据</span></div><div class="toolbar-actions"><span class="engine-chip"><span class="dot"></span>本机引擎 · 演示</span><button class="icon-button optional" data-action="assets" aria-label="打开资产抽屉">${icon('folder-open')}</button><button class="icon-button" data-action="inspector" aria-label="参数面板">${icon('panel-right')}</button><button class="primary run-button" data-action="run">${icon('play')} 演示生成</button></div></header>
    <div class="workspace-body"><div class="stage"><div class="graph"><svg class="wires" aria-hidden="true"><path class="wire" data-edge="prompt-image"></path><path class="wire-packet" data-edge="prompt-image"></path><path class="wire" data-edge="reference-image"></path><path class="wire-packet" data-edge="reference-image"></path><path class="wire" data-edge="image-video"></path><path class="wire-packet" data-edge="image-video"></path></svg>
      <article class="node prompt-node" data-node="prompt" tabindex="0" aria-label="文本提示节点"><header>${icon('file-text')} 文本提示 ${icon('ellipsis')}</header><div class="prompt-text">一个孤独的宇航员，站在黑色火山地貌上。巨大的圆环被微弱橙光勾勒，银色雾气从远处涌来。</div><span class="port out"></span></article>
      <article class="node reference-node" data-node="reference" tabindex="0" aria-label="参考素材节点"><header>${icon('image')} 参考素材 ${icon('ellipsis')}</header><div class="media">${image}</div><footer><span>场景参考 / 裁切视图</span><span>图像</span></footer><span class="port out"></span></article>
      <article class="node image-node selected" data-node="image" tabindex="0" aria-label="生成画面节点"><header>${icon('image')} 生成画面 ${icon('ellipsis')}</header><div class="media">${image}<div class="scan"></div></div><footer><span>16:9 · 原始概念图</span><span class="badge" id="output-badge">已选中</span></footer><span class="port in"></span><span class="port out"></span></article>
      <article class="node video-node" data-node="video" tabindex="0" aria-label="视频预览节点"><header>${icon('film')} 镜头预览 ${icon('ellipsis')}</header><div class="media">${image}<button class="play-button" data-action="preview" aria-label="查看运镜演示"><span>${icon('play')}</span></button><span class="duration">静态运镜</span></div><footer><span>画面运动研究</span><span>预览</span></footer><span class="port in"></span></article>
    </div><div class="agent-composer"><div class="agent-title"><span>${icon('aperture')} 创作 Agent</span><span class="mode">手动审批 · 界面演示</span></div><div id="agent-reply"></div><form class="agent-form"><input id="agent-input" aria-label="创作描述" placeholder="描述下一镜，或引用画布中的素材…" maxlength="500" autocomplete="off"><button type="submit" aria-label="发送创作描述">${icon('arrow-up-right')}</button></form></div><div class="zoom-controls"><button data-action="zoom-out" aria-label="缩小画布">${icon('minus')}</button><span id="zoom-label">100%</span><button data-action="zoom-in" aria-label="放大画布">${icon('plus')}</button><button data-action="fit" aria-label="重置画布">${icon('scan')}</button></div></div>
    <aside class="inspector" aria-label="模型参数"><div class="panel-head"><span id="inspector-title">模型与参数</span>${icon('ellipsis')}</div><div class="field"><label for="model">模型 <button class="field-link" data-action="settings">配置模型</button></label><select id="model"><option>我的视频模型</option><option>我的图像模型</option></select></div><div class="field"><label for="duration">时长</label><select id="duration"><option>5 秒</option><option>10 秒</option></select></div><div class="field"><label for="ratio">画幅</label><select id="ratio"><option>16:9</option><option>4:3</option><option>1:1</option></select></div><div class="field"><label for="strength">参考强度 <span id="strength-value">0.70</span></label><input id="strength" type="range" min="0" max="100" value="70" aria-label="参考强度"></div><div class="approval"><span>手动审批</span><button class="switch" id="approval-switch" role="switch" aria-checked="true" aria-label="手动审批"></button></div><div class="task-state" role="status"><span class="task-icon">${icon('circle-check')}</span><div><strong id="task-title">准备好创作</strong><small id="task-detail">点击演示，查看完整状态变化</small></div></div><button class="primary run-button" data-action="run">${icon('play')} 演示生成</button><p class="demo-note">仅演示动效，不调用任何模型</p></aside>
    <aside class="asset-drawer" aria-label="资产抽屉" aria-hidden="true" inert><div class="panel-head">项目资产<button class="icon-button" data-action="assets" aria-label="关闭资产抽屉">${icon('x')}</button></div><input id="asset-search" aria-label="搜索素材" placeholder="搜索素材…"><button class="asset-thumb" data-action="select-reference"><div>${image}</div><span>portal.png · 场景原图</span></button><p class="asset-empty" hidden role="status">没有匹配的素材。</p><p>示例素材已在本地加载。正式版会在这里管理导入、版本和生成历史。</p></aside>
    <div class="timeline-panel" aria-label="时间线面板" aria-hidden="true" inert><span class="timeline-name">镜头序列</span><button class="film-frame active" data-action="frame" data-crop="center">${image}<span>01 / 全景</span></button><button class="film-frame" data-action="frame" data-crop="detail">${image}<span>02 / 细节裁切</span></button><button class="film-frame" data-action="frame" data-crop="subject">${image}<span>03 / 主体裁切</span></button><p>同一概念图的镜头预览<br>此处尚未生成真实视频</p></div><button class="timeline-handle" data-action="timeline" aria-expanded="false">时间线 ${icon('chevron-up')}</button></div></section>`;
}
async function navigate(page) {
  if(transitionBusy)return false;
  cleanup();modal.close();currentPage=page;zoom=1;
  const update=()=>{app.innerHTML=page==='home'?homeMarkup():workspaceMarkup();refreshIcons();bindView();};
  if(document.startViewTransition&&!isReduced()){
    transitionBusy=true;
    try{const transition=document.startViewTransition(update);await transition.finished;}finally{transitionBusy=false;drawWires();}
  }else{update();drawWires();}
  return true;
}
function drawWires() {
  const graph=app.querySelector('.graph');if(!graph)return;
  const rect=graph.getBoundingClientRect();if(!rect.width||!rect.height)return;
  const sx=graph.clientWidth/rect.width,sy=graph.clientHeight/rect.height;
  const routes=[['prompt','image'],['reference','image'],['image','video']];
  for(const [source,target]of routes){
    const from=graph.querySelector(`[data-node="${source}"] .port.out`).getBoundingClientRect();
    const to=graph.querySelector(`[data-node="${target}"] .port.in`).getBoundingClientRect();
    const x1=(from.x+from.width/2-rect.x)*sx,y1=(from.y+from.height/2-rect.y)*sy;
    const x2=(to.x+to.width/2-rect.x)*sx,y2=(to.y+to.height/2-rect.y)*sy;
    const bend=Math.max(45,Math.abs(x2-x1)*.5);
    for(const edge of graph.querySelectorAll(`[data-edge="${source}-${target}"]`))edge.setAttribute('d',`M${x1},${y1} C${x1+bend},${y1} ${x2-bend},${y2} ${x2},${y2}`);
  }
}
function selectNode(node) {
  app.querySelectorAll('.node').forEach(n=>n.classList.toggle('selected',n===node));
  const names={prompt:'文本与输入',reference:'参考素材',image:'模型与参数',video:'镜头预览'};
  document.getElementById('inspector-title').textContent=names[node.dataset.node];
}
function bindView() {
  for(const card of app.querySelectorAll('.project-card')){
    card.addEventListener('pointermove',e=>{if(isReduced())return;const r=card.getBoundingClientRect(),x=(e.clientX-r.x)/r.width-.5,y=(e.clientY-r.y)/r.height-.5;card.style.setProperty('--rx',`${-y*6}deg`);card.style.setProperty('--ry',`${x*7}deg`);card.style.setProperty('--mx',`${(x+.5)*100}%`);card.style.setProperty('--my',`${(y+.5)*100}%`);});
    card.addEventListener('pointerleave',()=>{card.style.setProperty('--rx','0deg');card.style.setProperty('--ry','0deg');});
  }
  for(const node of app.querySelectorAll('.node')){
    node.addEventListener('click',()=>selectNode(node));
    node.addEventListener('keydown',e=>{if(e.key==='Enter')selectNode(node);});
    const header=node.querySelector('header');let drag=null;
    header.addEventListener('pointerdown',e=>{if(e.button!==0)return;selectNode(node);const graph=node.parentElement,r=graph.getBoundingClientRect();drag={x:e.clientX,y:e.clientY,dx:Number(node.dataset.dx||0),dy:Number(node.dataset.dy||0),sx:r.width/graph.clientWidth,sy:r.height/graph.clientHeight};header.setPointerCapture(e.pointerId);});
    header.addEventListener('pointermove',e=>{if(!drag)return;const dx=drag.dx+(e.clientX-drag.x)/drag.sx,dy=drag.dy+(e.clientY-drag.y)/drag.sy;node.dataset.dx=String(dx);node.dataset.dy=String(dy);node.style.transform=`translate(${dx}px,${dy}px)`;drawWires();});
    header.addEventListener('pointerup',()=>{drag=null;});header.addEventListener('pointercancel',()=>{drag=null;});header.addEventListener('lostpointercapture',()=>{drag=null;});
  }
  const form=app.querySelector('.agent-form');form?.addEventListener('submit',e=>{e.preventDefault();const input=document.getElementById('agent-input');activeDraft=input.value.trim();if(!activeDraft){notify('先写下这一镜的创作想法');input.focus();return;}const reply=document.getElementById('agent-reply');reply.innerHTML='<div class="agent-reply"><strong>镜头草案已准备</strong><div class="draft-text"></div><small>规则演示，未调用大模型</small><button data-action="apply-draft">应用到提示节点</button></div>';reply.querySelector('.draft-text').textContent=activeDraft;input.value='';});
  document.getElementById('strength')?.addEventListener('input',e=>{document.getElementById('strength-value').textContent=(Number(e.target.value)/100).toFixed(2);});
  document.getElementById('ratio')?.addEventListener('change',e=>{const value=e.target.value.replace(':','/');app.querySelector('.image-node .media').style.aspectRatio=value;drawWires();});
  document.getElementById('asset-search')?.addEventListener('input',e=>{const show='portal.png 场景原图'.includes(e.target.value.trim());app.querySelector('.asset-thumb').hidden=!show;app.querySelector('.asset-empty').hidden=show;});
  requestAnimationFrame(drawWires);schedule(drawWires,700);
}
function setTask(title,detail,iconName) {
  document.getElementById('task-title').textContent=title;document.getElementById('task-detail').textContent=detail;
  app.querySelector('.task-icon').innerHTML=icon(iconName);refreshIcons();
}
function runDemo() {
  if(taskRunning||currentPage!=='workspace')return;
  taskRunning=true;const workspace=app.querySelector('.workspace');workspace.classList.add('generating');workspace.dataset.taskState='running';
  app.querySelectorAll('.run-button').forEach(b=>b.disabled=true);app.querySelector('.image-node').classList.remove('just-completed');
  setTask('准备输入','固定参考素材与模型参数 · 演示','loader-circle');document.getElementById('output-badge').textContent='等待结果';
  schedule(()=>setTask('模型执行中','连线显示当前任务流向 · 演示','loader-circle'),700);
  schedule(()=>setTask('保存输出','原件优先收存，随后生成预览 · 演示','loader-circle'),2200);
  schedule(()=>{taskRunning=false;workspace.classList.remove('generating');workspace.dataset.taskState='complete';app.querySelector('.image-node').classList.add('just-completed');setTask('演示完成','已展示执行与结果显现动效','circle-check');document.getElementById('output-badge').textContent='预览就绪';app.querySelectorAll('.run-button').forEach(b=>b.disabled=false);notify('动效演示完成，没有发起模型调用');},3400);
}
function togglePanel(selector,open) {const panel=app.querySelector(selector);const state=open??!panel.classList.contains('open');panel.classList.toggle('open',state);panel.setAttribute('aria-hidden',String(!state));panel.inert=!state;return state;}
function showDialog(kind) {
  if(kind==='settings')dialogContent.innerHTML=`<div class="eyebrow">YOUR MODELS, YOUR WORKSPACE</div><h2 id="dialog-title">模型连接</h2><p>这里演示配置界面与弹窗过渡。正式版支持自定义模型服务、地址和能力；此样机不保存或发送凭据。</p><label for="connection-name">连接名称</label><input id="connection-name" value="我的模型服务" maxlength="80"><label for="base-url">API 地址示例</label><input id="base-url" value="https://api.example.com/v1" readonly><div class="feature-lines"><span>文本</span><span>图像</span><span>视频</span><span>音频</span><span>本地模型</span></div><button class="primary" data-action="save-demo">保存演示名称 ${icon('check')}</button>`;
  if(kind==='about')dialogContent.innerHTML=`<div class="eyebrow">LAYERS INSPIRED / INDEPENDENT DESIGN</div><h2 id="dialog-title">让动作有来处。</h2><p>项目打开带来空间过渡；节点连接呈现任务流向；结果完成才触发高亮。卡片有轻微景深，工作区中的文字和工具保持稳定。</p><div class="feature-lines"><span>620ms 项目过渡</span><span>280ms 抽屉</span><span>420ms 结果显现</span><span>减少动态效果</span></div><p>这是独立实现的交互动效样机。素材由 Image Gen 生成；模型任务、保存与视频生成仍待工程实现。</p><button class="primary" data-action="open-project">进入工作台 ${icon('arrow-up-right')}</button>`;
  if(kind==='preview'||kind==='preview-detail')dialogContent.innerHTML=`<div class="eyebrow">ECHO / FRAME STUDY</div><h2 id="dialog-title">${kind==='preview-detail'?'空间与光':'镜头运动预览'}</h2><div class="modal-media">${image}</div><p>用一张原始概念图演示缓慢推近。这里没有真实视频生成，也不会发起模型请求。</p>`;
  refreshIcons();if(!modal.open)modal.showModal();
}
app.addEventListener('click',async e=>{
  const target=e.target.closest('[data-action]');if(!target)return;
  const action=target.dataset.action;
  if(action==='home')return navigate('home');
  if(action==='open-project')return navigate('workspace');
  if(action==='open-assets'){if(await navigate('workspace'))togglePanel('.asset-drawer',true);return;}
  if(['settings','about','preview','preview-detail'].includes(action))return showDialog(action);
  if(action==='canvas'){app.querySelector('.agent-composer').scrollIntoView({block:'nearest'});return;}
  if(action==='assets'){togglePanel('.asset-drawer');return;}
  if(action==='select-reference'){selectNode(app.querySelector('.reference-node'));togglePanel('.asset-drawer',false);return;}
  if(action==='inspector'){const inspector=app.querySelector('.inspector');if(innerWidth<=950)inspector.classList.toggle('force-show');else inspector.classList.toggle('hide');return;}
  if(action==='agent'){document.getElementById('agent-input').focus();return;}
  if(action==='run')return runDemo();
  if(action==='timeline'){const open=togglePanel('.timeline-panel');app.querySelector('.workspace').classList.toggle('timeline-open',open);app.querySelector('.timeline-handle').setAttribute('aria-expanded',String(open));schedule(drawWires,350);return;}
  if(action==='frame'){app.querySelectorAll('.film-frame').forEach(x=>x.classList.toggle('active',x===target));const img=app.querySelector('.image-node img');img.style.transform=target.dataset.crop==='center'?'none':`scale(${target.dataset.crop==='detail'?1.6:1.9})`;img.style.objectPosition=target.dataset.crop==='detail'?'90% 50%':'0% 100%';return;}
  if(action==='apply-draft'){app.querySelector('.prompt-text').textContent=activeDraft;document.getElementById('agent-reply').replaceChildren();selectNode(app.querySelector('.prompt-node'));notify('草案已应用到文本节点，仅保留在本次样机页面');return;}
  if(['zoom-in','zoom-out','fit'].includes(action)){zoom=action==='fit'?1:Math.min(1.3,Math.max(.6,zoom+(action==='zoom-in'?.1:-.1)));app.querySelector('.graph').style.setProperty('--zoom',zoom);document.getElementById('zoom-label').textContent=`${Math.round(zoom*100)}%`;if(action==='fit'){app.querySelectorAll('.node').forEach(n=>{n.style.transform='';n.dataset.dx='0';n.dataset.dy='0';});}schedule(drawWires,280);return;}
});
modal.addEventListener('click',e=>{if(e.target.closest('.dialog-close'))modal.close();const action=e.target.closest('[data-action]')?.dataset.action;if(action==='open-project')navigate('workspace');if(action==='save-demo'){notify(`演示名称：${document.getElementById('connection-name').value.trim()||'未命名连接'}`);modal.close();}});
document.addEventListener('click',e=>{const control=e.target.closest('#approval-switch');if(control)control.setAttribute('aria-checked',String(control.getAttribute('aria-checked')!=='true'));});
function applyMotionPreference(){const reduced=isReduced();document.body.classList.toggle('reduced',reduced);motionToggle.setAttribute('aria-pressed',String(reduced));}
motionToggle.addEventListener('click',()=>{manualReduced=!manualReduced;applyMotionPreference();notify(isReduced()?'已减少动态效果，任务状态保持完整':'已启用完整动效');});systemReduced.addEventListener('change',applyMotionPreference);
document.addEventListener('visibilitychange',()=>document.body.classList.toggle('page-hidden',document.hidden));
window.addEventListener('resize',drawWires);window.addEventListener('beforeunload',cleanup);
applyMotionPreference();app.innerHTML=homeMarkup();refreshIcons();bindView();
