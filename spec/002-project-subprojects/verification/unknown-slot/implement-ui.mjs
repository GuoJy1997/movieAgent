import fs from'node:fs';
const file='apps/desktop/src/renderer/features/tasks/TaskDetail.tsx';let s=fs.readFileSync(file,'utf8');function rep(a,b){if(!s.includes(a))throw Error('UI_ANCHOR '+a);s=s.replace(a,b);}
rep("    [savedNow, setSaved] = useState(false);","    [savedNow, setSaved] = useState(false),\n    [releasing, setReleasing] = useState(false),\n    [releaseOpen, setReleaseOpen] = useState(false),\n    [acknowledgeRisk, setAcknowledgeRisk] = useState(false);");
rep('const locked = !runtime.online || runtime.busy || runtime.pending;','const locked = !runtime.online || runtime.busy || runtime.pending || releasing;');
rep('                <dt>核实能力</dt>','                <dt>并发占用</dt>\n                <dd>{task.concurrencyReleasedAt ? \'已手动解除；原请求及账单仍待核实\' : task.providerState === \'unknown\' ? \'未知请求仍占用并发，可在确认风险后解除\' : \'按当前任务状态计算\'}</dd>\n                <dt>核实能力</dt>');
rep('          <div className="dialog-actions">',`          {releaseOpen && task.providerState === 'unknown' && !task.concurrencyReleasedAt && (
            <form className="save-asset-form" onSubmit={async event => {
              event.preventDefault(); if (locked || !acknowledgeRisk) return;
              setReleasing(true);
              try {
                if (await runtime.command('task.releaseUnknownSlot', { taskId, attemptId: task.attemptId, acknowledgeRisk: true })) {
                  setReleaseOpen(false); setAcknowledgeRisk(false);
                }
              } finally { setReleasing(false); }
            }}>
              <p>解除后，新的已批准任务可以继续排队执行。原请求仍为未知，不会重新提交；云端可能继续执行，本地费用预留和历史记录保留。若接口支持查询，请先核实原任务。</p>
              <label><input type="checkbox" checked={acknowledgeRisk} disabled={locked} onChange={event => setAcknowledgeRisk(event.target.checked)} />我了解原请求可能继续执行并产生费用</label>
              <div className="dialog-actions">
                <Button type="button" disabled={locked} onClick={() => { setReleaseOpen(false); setAcknowledgeRisk(false); }}>返回</Button>
                <Button type="submit" disabled={locked || !acknowledgeRisk}>确认解除占用</Button>
              </div>
            </form>
          )}
          <div className="dialog-actions">
            {task.providerState === 'unknown' && !task.concurrencyReleasedAt && !releaseOpen && <Button disabled={locked} onClick={() => setReleaseOpen(true)}>解除并发占用</Button>}`);
fs.writeFileSync(file,s);
const panel='apps/desktop/src/renderer/features/tasks/TaskPanel.tsx';let p=fs.readFileSync(panel,'utf8');p=p.replace('<p>{taskLabel[task.state]}</p>',"<p>{taskLabel[task.state]}{task.concurrencyReleasedAt ? ' · 已解除并发占用，账单待核实' : ''}</p>");fs.writeFileSync(panel,p);
