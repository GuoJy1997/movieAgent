import {useEffect,useState} from 'react';
import {Button,Badge} from '../../../../../../packages/ui/src/controls.tsx';
import type {McpStatus,McpConfigureInput} from '../../../../../../packages/contracts/src/mcp.ts';
export function McpSettings(){
 const [status,setStatus]=useState<McpStatus|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[copied,setCopied]=useState(false);
 async function refresh(){if(!window.studio.mcpStatus)return;const r=await window.studio.mcpStatus();if(r.ok)setStatus(r.value);else setError(r.error.message);}
 useEffect(()=>{let live=true;const tick=async()=>{if(!window.studio.mcpStatus)return;try{const r=await window.studio.mcpStatus();if(live){if(r.ok)setStatus(r.value);else setError(r.error.message);}}catch{if(live)setError('MCP设置暂不可用。');}};void tick();const timer=setInterval(()=>void tick(),2000);return()=>{live=false;clearInterval(timer);};},[]);
 async function configure(input:McpConfigureInput){if(!window.studio.mcpConfigure)return;setBusy(true);setError('');try{const r=await window.studio.mcpConfigure(input);if(r.ok)setStatus(r.value);else setError(r.error.message);}catch{setError('MCP设置暂不可用。');}finally{setBusy(false);}}
 async function directory(){if(!window.studio.mcpSelectImportDirectory)return;setBusy(true);try{const r=await window.studio.mcpSelectImportDirectory();if(r.ok)setStatus(r.value);else setError(r.error.message);}finally{setBusy(false);}}
 const config=status?JSON.stringify({mcpServers:{movieagent:status.clientConfig}},null,2):'';
 return <section className="settings-section" aria-label="MCP Agent 接入"><div className="section-head"><div><h2>MCP · 外部 Agent 接入</h2><p>让 Codex 等 Agent 导入图片、管理角色与画布，再使用已有图片生成视频。</p></div><Badge>{status?.enabled?'已启用':'未启用'}</Badge></div>
 <p className="hint">MCP 与当前工作目录共用本机引擎。生成模型的费用在提交前单独确认。</p>
 <div className="button-row"><Button disabled={busy||!status} tone={status?.enabled?'quiet':'primary'} onClick={()=>void configure({action:status?.enabled?'disable':'enable'})}>{status?.enabled?'停用 MCP':'启用 MCP'}</Button><Button disabled={busy||!status} onClick={()=>void directory()}>添加图片目录</Button><Button disabled={!status} onClick={()=>void refresh()}>刷新连接</Button></div>
 {error&&<p role="alert" className="alert">{error}</p>}{status?.error&&<p role="alert" className="alert">{status.error}</p>}
 {status&&<><details open={status.enabled}><summary>客户端配置</summary><p>将下面的配置添加到 MCP 客户端；此配置不含模型密钥。</p><textarea aria-label="MCP 客户端配置" value={config} readOnly rows={10} onFocus={e=>e.currentTarget.select()}/><Button onClick={()=>void navigator.clipboard.writeText(config).then(()=>setCopied(true),()=>setError('请选中上方文本后复制。'))}>{copied?'已复制':'复制 MCP 配置'}</Button></details>
 <h3>允许导入的图片目录</h3>{status.sources.map(s=><div className="config-row" key={s.id}><div className="grow"><strong>{s.name}</strong><p>{s.path}</p><small>目录 ID：{s.id}</small></div>{s.id!=='inbox'&&<Button disabled={busy} onClick={()=>void configure({action:'removeSource',id:s.id})}>移除授权</Button>}</div>)}
 <p className="hint">Agent 可将图片写入收件目录，或使用你添加的目录。导入会保存原件，不依赖临时文件继续存在。</p>
 <h3>当前连接 · {status.clients.length}</h3>{status.clients.length?status.clients.map(c=><div className="config-row" key={c.id}><div className="grow"><strong>{c.name}</strong><p>{new Date(c.connectedAt).toLocaleString('zh-CN')}</p></div><Button disabled={busy} onClick={()=>void configure({action:'revokeClient',id:c.id})}>断开连接</Button></div>):<p className="hint">暂无外部客户端连接。</p>}
 <p className="hint">断开结束当前连接；停用 MCP 可阻止继续接入。已受理的导入或生成任务可继续完成。</p></>}
 </section>;
}
