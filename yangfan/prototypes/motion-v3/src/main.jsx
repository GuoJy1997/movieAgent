import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Aperture, Workflow, Layers, Settings2, ArrowUpRight, Plus, Image, Film, AudioLines, ChevronRight, Check, Pause, Play, Maximize2, X, SlidersHorizontal, HardDrive, ArrowLeft, Search, SquareDashed, Grip, Sparkles, Command } from 'lucide-react';
import LightPillar from './vendor/react-bits/LightPillar.jsx';
import Dock from './vendor/react-bits/Dock.jsx';
import StarBorder from './vendor/react-bits/StarBorder.jsx';
import './styles.css';

const initialNodes = [
  {id:'idea', title:'创作意图', type:'text', x:4, y:12},
  {id:'image', title:'画面生成', type:'image', x:36, y:24},
  {id:'video', title:'镜头生成', type:'video', x:69, y:10}
];

function usePreferences() {
  const [systemReduced,setSystemReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [hidden,setHidden]=useState(document.hidden);
  useEffect(()=>{
    const media=matchMedia('(prefers-reduced-motion: reduce)');
    const onChange=()=>setSystemReduced(media.matches), onVisibility=()=>setHidden(document.hidden);
    media.addEventListener('change',onChange);document.addEventListener('visibilitychange',onVisibility);
    return()=>{media.removeEventListener('change',onChange);document.removeEventListener('visibilitychange',onVisibility);};
  },[]);
  return {systemReduced,hidden};
}

function App(){
  const [page,setPage]=useState('studio');
  const [material,setMaterial]=useState('empty');
  const [paused,setPaused]=useState(false);
  const [solo,setSolo]=useState(false);
  const [modal,setModal]=useState(null);
  const [notice,setNotice]=useState('');
  const [draft,setDraft]=useState('');
  const [idea,setIdea]=useState('从一个想法开始，连接你自己的图像和视频模型。');
  const [nodes,setNodes]=useState(initialNodes);
  const [selected,setSelected]=useState('image');
  const [stage,setStage]=useState('idle');
  const [search,setSearch]=useState('');
  const [graphicsReady,setGraphicsReady]=useState(true);
  const {systemReduced,hidden}=usePreferences();
  const still=paused||systemReduced, suspended=still||hidden;
  const viewport=useRef(null), dialog=useRef(null), background=useRef(null), timers=useRef([]);
  const stageLabels={idle:'准备开始',input:'准备输入',rendering:'执行中',saving:'收存结果',done:'演示完成'};
  const busy=['input','rendering','saving'].includes(stage);

  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),3200);return()=>clearTimeout(timer);},[notice]);
  useEffect(()=>()=>timers.current.forEach(clearTimeout),[]);
  useEffect(()=>{
    if(modal)dialog.current?.showModal();else dialog.current?.close();
  },[modal]);
  useEffect(()=>{
    const canvas=background.current?.querySelector('canvas');
    if(canvas&&!canvas.getContext('webgl2'))setGraphicsReady(false);
  },[]);
  const go=next=>{setPage(next);setModal(null);};
  const run=()=>{
    if(busy)return;
    timers.current.forEach(clearTimeout);setStage('input');
    timers.current=[setTimeout(()=>setStage('rendering'),700),setTimeout(()=>setStage('saving'),2600),setTimeout(()=>{setStage('done');setNotice('动效演示完成 · 未发起模型调用');},3900)];
  };
  const LightButton=({children,className='',as='button',...props})=>suspended
    ?React.createElement(as,{...props,className:`light-button static ${className}`},children)
    :<StarBorder as={as} className={`light-button ${className}`} color="#fff2d6" trailColor="#fb8e43" backgroundColor="rgba(17,18,20,.88)" borderColor="#ffffff25" radius={16} thickness={1.3} duration={4.2} glow={.75} hover="brighten" {...props}>{children}</StarBorder>;

  function Material({kind='image',index=0}){
    const Icon=kind==='video'?Film:kind==='audio'?AudioLines:Image;
    if(material==='concept'&&kind!=='audio')return <div className={`material concept crop-${index%3}`}><img src="/portal.png" alt="用户示例素材：圆环场景"/><span className="media-label">示例素材</span></div>;
    if(material==='mixed')return <div className={`material mixed tone-${index%4}`}><Icon/><strong>{['浅色素材','深色素材','竖幅素材','普通素材'][index%4]}</strong><small>内容变化，界面保持</small></div>;
    return <div className="material empty"><Icon/><span>{kind==='video'?'等待镜头':kind==='audio'?'等待音频':'等待素材'}</span><small>将创作放在这里</small></div>;
  }

  function submitIdea(event){event.preventDefault();if(!draft.trim())return;setIdea(draft.trim());setDraft('');go('canvas');setSelected('idea');setNotice('已放入意图节点 · 本地界面演示');}
  function startDrag(event,node){
    if(event.button!==0)return;
    const header=event.currentTarget, bounds=viewport.current.getBoundingClientRect();
    const origin={x:event.clientX,y:event.clientY,nx:node.x,ny:node.y};
    setSelected(node.id);header.setPointerCapture(event.pointerId);
    const move=e=>setNodes(current=>current.map(n=>n.id===node.id?{...n,x:Math.min(75,Math.max(0,origin.nx+(e.clientX-origin.x)/bounds.width*100)),y:Math.min(66,Math.max(0,origin.ny+(e.clientY-origin.y)/bounds.height*100))}:n));
    const finish=()=>{header.removeEventListener('pointermove',move);header.removeEventListener('pointerup',finish);header.removeEventListener('pointercancel',finish);header.removeEventListener('lostpointercapture',finish);};
    header.addEventListener('pointermove',move);header.addEventListener('pointerup',finish,{once:true});header.addEventListener('pointercancel',finish,{once:true});header.addEventListener('lostpointercapture',finish,{once:true});
  }

  const dockItems=[
    {label:'创作台',icon:<Aperture/>,active:page==='studio',onClick:()=>go('studio')},
    {label:'工作流画布',icon:<Workflow/>,active:page==='canvas',onClick:()=>go('canvas')},
    {label:'资产空间',icon:<Layers/>,active:page==='assets',onClick:()=>go('assets')},
    {separator:true},
    {label:'模型连接',icon:<Settings2/>,onClick:()=>setModal('models')},
    {label:'动效来源',icon:<Command/>,onClick:()=>setModal('sources')}
  ];

  return <div className={`shell ${solo?'solo':''} ${still?'still':''} page-${page}`}>
    <div className="animated-space" ref={background} aria-label="实时动态背景">
      <LightPillar topColor="#ec6326" bottomColor="#ffe9c4" rotationSpeed={.75} flow={1.45} intensity={page==='studio'||solo?1.12:.8} pillarWidth={3.8} pillarHeight={.4} pillarRotation={42} twist={.6} detail={3} glowAmount={.0022} bloom={.45} noiseIntensity={.12} resolution={.38} paused={suspended} interactive={!suspended} clickPulse={!suspended} intro={!still}/>
      <div className="space-shade"/>
    </div>
    <div className="outer-frame"/>
    <header className="topbar">
      <button className="brand" onClick={()=>go('studio')}><Aperture/><strong>FLUX<span>STUDIO</span></strong></button>
      <nav className="page-nav" aria-label="主导航">{[['studio','创作台'],['canvas','画布'],['assets','资产']].map(([id,label])=><button key={id} className={page===id?'active':''} onClick={()=>go(id)}>{label}{page===id&&<span/>}</button>)}</nav>
      <div className="top-meta"><span className="live-dot"/>本机工作空间<span className="prototype-label">UI STUDY 03</span></div>
    </header>

    <div className="study-tools" aria-label="视觉验证工具">
      <span className="study-title"><SlidersHorizontal/>视觉验证</span>
      <label>素材<select value={material} onChange={e=>setMaterial(e.target.value)} aria-label="素材测试模式"><option value="empty">全部空白</option><option value="mixed">混合占位</option><option value="concept">概念图片</option></select></label>
      <button aria-pressed={solo} onClick={()=>setSolo(v=>!v)}><Maximize2/>{solo?'恢复界面':'只看动画'}</button>
      <button aria-pressed={still} onClick={()=>setPaused(v=>!v)} disabled={systemReduced}>{still?<Play/>:<Pause/>}{still?'继续动效':'暂停动效'}</button>
    </div>
    {!graphicsReady&&<div className="graphics-alert">当前浏览器未提供 WebGL2，动态背景未运行。</div>}

    <main className="product-content" inert={solo?true:undefined}>
      {page==='studio'&&<section className="studio-view view-enter" key="studio">
        <div className="studio-heading"><span className="eyebrow"><span/>A SPACE FOR WHAT'S NEXT</span><h1>让想象<br/><em>开始流动。</em></h1><p>连接你的模型，把想法变成画面。<br/>每一帧，都由你掌控。</p><div className="hero-actions"><LightButton onClick={()=>go('canvas')}><Plus/>开始创作<ArrowUpRight/></LightButton><button className="text-button" onClick={()=>setModal('models')}>连接我的模型<ChevronRight/></button></div><div className="small-caption"><HardDrive/>本机引擎与远程服务 · 界面演示</div></div>
        <div className="space-caption" aria-hidden="true"><span>01 / LIVE FIELD</span><div/><small>INTERACTIVE LIGHT<br/>CONTINUOUS MOTION</small></div>
        <section className="creation-panel glass"><div className="panel-top"><span><Sparkles/>创作 Agent</span><span className="tag">从一个想法开始</span></div><form onSubmit={submitIdea}><input aria-label="描述创作想法" placeholder="描述你想创作的内容…" value={draft} onChange={e=>setDraft(e.target.value)} maxLength={500}/><LightButton type="submit" className="send-button" aria-label="创建创作草案"><ArrowUpRight/></LightButton></form><div className="prompt-options"><button onClick={()=>setDraft('用三个镜头讲述一次雨夜重逢')}>短片故事<Plus/></button><button onClick={()=>setDraft('创作一组简洁的产品广告镜头')}>产品影像<Plus/></button><button onClick={()=>setDraft('建立角色设定与分镜计划')}>角色与分镜<Plus/></button></div></section>
        <section className="recent-strip"><div className="strip-title"><span>工作空间</span><small>YOUR LIBRARY</small></div><button className="new-project" onClick={()=>go('canvas')}><span className="plus-outline"><Plus/></span><span><strong>新建一个项目</strong><small>从空白画布开始</small></span><ArrowUpRight/></button><button className="recent-project" onClick={()=>go('canvas')}><div className="mini-preview"><Material index={0}/></div><span><strong>未命名创作</strong><small>3 个节点 · 演示项目</small></span><ChevronRight/></button></section>
      </section>}

      {page==='canvas'&&<section className="canvas-view view-enter" key="canvas"><div className="workspace-head"><div><button className="back-button" onClick={()=>go('studio')} aria-label="返回创作台"><ArrowLeft/></button><div><small>WORKSPACE / 01</small><h2>未命名创作<span>界面演示</span></h2></div></div><LightButton onClick={run} disabled={busy}><Play/>{busy?stageLabels[stage]:'演示生成'}</LightButton></div>
        <div className={`canvas-well ${busy?'running':''}`} ref={viewport}>
          <svg className="graph-connections" viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true">{[[nodes[0],nodes[1]],[nodes[1],nodes[2]]].map(([a,b],i)=><g key={i}><path d={`M${(a.x+24)*10} ${(a.y+16)*6} C${(a.x+30)*10} ${(a.y+16)*6} ${(b.x-8)*10} ${(b.y+16)*6} ${b.x*10} ${(b.y+16)*6}`}/><path className="edge-travel" d={`M${(a.x+24)*10} ${(a.y+16)*6} C${(a.x+30)*10} ${(a.y+16)*6} ${(b.x-8)*10} ${(b.y+16)*6} ${b.x*10} ${(b.y+16)*6}`}/></g>)}</svg>
          {nodes.map((node,i)=><article key={node.id} className={`flow-node ${selected===node.id?'selected':''}`} style={{left:`${node.x}%`,top:`${node.y}%`}} aria-label={node.title} tabIndex={0} onClick={()=>setSelected(node.id)} onKeyDown={e=>{if(e.key==='Enter')setSelected(node.id);}}><header onPointerDown={e=>startDrag(e,node)}><span>{node.type==='text'?<Sparkles/>:node.type==='image'?<Image/>:<Film/>}{node.title}</span><Grip/></header>{node.type==='text'?<div className="idea-content"><span className="node-kicker">PROMPT / 01</span><p>{idea}</p><small>连接下一个节点，继续创作</small></div>:<Material kind={node.type} index={i}/>}<footer><span className="node-dot"/>{node.type==='text'?'输入节点':stage==='done'?'演示完成':'尚未生成'}<span>{String(i+1).padStart(2,'0')}</span></footer><i className="node-port in"/><i className="node-port out"/></article>)}
          <div className="canvas-tag"><SquareDashed/>拖动节点标题 · 连线随动</div><button className="reset-button" onClick={()=>setNodes(initialNodes)}>重置位置</button>
        </div>
        <div className="canvas-bottom glass"><div className="agent-inline"><Aperture/><input aria-label="画布创作想法" placeholder="下一步想做什么…" value={draft} onChange={e=>setDraft(e.target.value)} maxLength={500} onKeyDown={e=>{if(e.key==='Enter')submitIdea(e);}}/><button onClick={submitIdea} aria-label="应用到意图节点"><ArrowUpRight/></button></div><div className="task-summary"><span className={`state-dot ${busy?'working':''}`}/><strong>{stageLabels[stage]}</strong><small>未调用真实模型</small></div></div>
      </section>}

      {page==='assets'&&<section className="assets-view view-enter" key="assets"><div className="asset-heading"><div><span className="eyebrow">YOUR CREATIVE MEMORY</span><h2>资产空间<span>.</span></h2><p>图片、镜头与声音，各归其位。</p></div><LightButton onClick={()=>setNotice('文件导入将在正式版接入；当前可用上方素材模式切换验证')}><Plus/>导入素材</LightButton></div><div className="asset-bar"><span>全部素材 <b>{material==='empty'?'0':'6'}</b></span><label><Search/><input placeholder="搜索名称…" aria-label="搜索资产" value={search} onChange={e=>setSearch(e.target.value)}/></label></div><div className="asset-grid">{['角色参考','场景设定','镜头片段','配音草稿','产品图片','分镜画面'].map((name,i)=>({name,i})).filter(x=>x.name.includes(search)).map(({name,i})=><button key={name} className="asset-card glass" onClick={()=>{setSelected('image');go('canvas');}}><Material kind={i===3?'audio':i===2?'video':'image'} index={i}/><div><span>{material==='empty'?'空素材位':name}</span><ArrowUpRight/></div></button>)}</div>{search&&!['角色参考','场景设定','镜头片段','配音草稿','产品图片','分镜画面'].some(x=>x.includes(search))&&<p className="asset-empty">没有匹配的资产。</p>}</section>}
    </main>

    <div className="dock-host" inert={solo?true:undefined}><Dock items={dockItems} position="bottom" baseItemSize={45} panelHeight={64} magnification={suspended?45:78} distance={170} bounce={!suspended} accentColor="#f9b174" roundness={.65} style={{'--dock-panel':'rgba(17,19,23,.82)','--dock-tile':'linear-gradient(145deg,#343538,#15171b)'}}/></div>
    <div className="footer-meta"><span className="live-dot"/>{still?'MOTION PAUSED':'LIVE / INTERACTIVE'}<span>素材与界面独立</span></div>
    {notice&&<div className="toast" role="status"><Check/>{notice}</div>}
    <dialog ref={dialog} onCancel={()=>setModal(null)} onClose={()=>setModal(null)} aria-labelledby="dialog-title"><button className="close-button" onClick={()=>setModal(null)} aria-label="关闭弹窗"><X/></button>{modal==='models'?<><span className="eyebrow">BRING YOUR OWN MODELS</span><h2 id="dialog-title">连接你的创造力</h2><p>文本、图像、视频与音频，自由选择服务。</p><div className="model-rows">{[['文本模型','创作与规划',Sparkles],['图像模型','生成与编辑',Image],['视频模型','镜头与运动',Film]].map(([name,desc,Icon])=><button key={name} onClick={()=>setNotice('这是连接界面演示，尚未保存或请求 API')}><Icon/><span><strong>{name}</strong><small>{desc}</small></span><Plus/></button>)}</div><small>界面演示，不接收或保存 API 密钥。</small></>:<><span className="eyebrow">BUILT ON EXISTING MOTION</span><h2 id="dialog-title">现成源码，真实动画。</h2><p>这版直接复用了 React Bits 的三个组件，不需要任何素材图来驱动动效。</p><ul><li><a href="https://reactbits.dev/backgrounds/light-pillar" target="_blank" rel="noreferrer">Light Pillar</a><span>实时 WebGL 光流 / 跟随指针 / 点击脉冲</span></li><li><a href="https://reactbits.dev/components/dock" target="_blank" rel="noreferrer">Dock</a><span>弹簧放大 / 相邻响应 / 点击回弹</span></li><li><a href="https://reactbits.dev/animations/star-border" target="_blank" rel="noreferrer">Star Border</a><span>Canvas 边缘光迹 / 悬停反馈</span></li></ul><small>MIT + Commons Clause · Copyright 2026 David Haz<br/>许可原文已随源码保留。样机尚未接入模型和 Electron 引擎。</small></>}</dialog>
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
