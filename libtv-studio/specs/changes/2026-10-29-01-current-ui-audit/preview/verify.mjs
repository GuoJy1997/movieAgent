import { queryOutputValidators } from '../../../../packages/contracts/src/queries.ts';
import { queryData } from './data.ts';
const keys=['project.list','creation.read','canvas.read','asset.search','asset.history','timeline.list','timeline.read','timeline.history','timeline.exports','audio.read','voice.list','voice.read','dialogue.read','dialogue.takes','dialogue.productions','dialogue.reviewContext','shots.history','provider.list','model.list','profile.list','task.list','task.read','workflow.list','render.list','agent.list','agent.templates','finish.templates','finish.list'];
for(const kind of keys){const value=queryData(kind,{projectId:'project',shotId:'shot-1',takeId:'take-shot-1'});console.log(`${queryOutputValidators[kind](value)?'PASS':'FAIL'} ${kind}`);}
