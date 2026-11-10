const fs=require('node:fs');
const p='C:/Users/1266/.codex/visualizations/2026/10/24/01a16f36-bd2d-7c31-ac08-df752d7f1002/movieagent-conversation.html';
let h=fs.readFileSync(p,'utf8');
const edits=[
 ['function execute(t){if(t.status!==\'prepared\')return;','function execute(t){if(state.running||t.status!==\'prepared\')return;'],
 ['b.textContent=text;b.addEventListener(\'click\',fn);return b;','b.textContent=text;b.disabled=state.running;b.addEventListener(\'click\',fn);return b;'],
 ['function renderMenu(){pop.hidden=','function renderMenu(){const focusId=document.activeElement?.id;pop.hidden='],
 ["b.className='ma-option cursor-interaction';b.setAttribute('aria-pressed',String(state.selected.includes(c.id)));","b.className='ma-option cursor-interaction';b.id='ma-context-option-'+c.id;b.setAttribute('aria-pressed',String(state.selected.includes(c.id)));"],
 ["state.inherit=e.target.checked;renderMenu();updateInput();remember();","state.inherit=e.target.checked;$('#ma-budget').hidden=state.inherit;updateInput();remember();"],
 ["pop.append(note);}redrawIcons();}","pop.append(note);}redrawIcons();if(focusId){const el=document.getElementById(focusId);if(el)el.focus();}}"],
 ["function renderHistory(){const history=","function renderHistory(){const focusId=document.activeElement?.id;const history="],
 ["check.type='checkbox';check.checked=t.selected[i];","check.type='checkbox';check.id='ma-review-'+index+'-'+i;check.checked=t.selected[i];"],
 ["details.className='ma-details';details.innerHTML=","details.className='ma-details';details.open=Boolean(t.detailOpen);details.addEventListener('toggle',()=>{t.detailOpen=details.open;});details.innerHTML="],
 ["history.append(turn);});redrawIcons();}","history.append(turn);});redrawIcons();if(focusId){const el=document.getElementById(focusId);if(el)el.focus();}}"],
 ["state.turns=[];state.menu=null;input.value='';","state.turns=[];state.inherit=true;state.budget=4096;state.menu=null;input.value='';"],
 ['font-size:10px','font-size:11px']
];
for(const [from,to] of edits){if(!h.includes(from))throw Error('Missing anchor: '+from);h=h.replaceAll(from,to);}
fs.writeFileSync(p,h);
console.log('Applied '+edits.length+' interaction refinements.');
