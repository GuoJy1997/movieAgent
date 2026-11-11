import {openLibrary} from '../../packages/storage/src/database.ts';
import {modelConfigFor} from '../../packages/engine/src/model-config-service.ts';
import {assetsFor} from '../../packages/engine/src/asset-service.ts';
import {canvasFor} from '../../packages/engine/src/canvas-service.ts';
import {generationFor} from '../../packages/engine/src/generation-service.ts';
import {workflowsFor} from '../../packages/engine/src/workflow-service.ts';
import {OpenAIChatAdapter} from '../../packages/providers/src/openai-chat.ts';
import {ArtifactSource} from '../../packages/providers/src/artifact-source.ts';
import {ProviderEvidence} from '../../packages/providers/src/probe.ts';
const opened=await openLibrary({root:process.argv[2]!});if(!opened.ok)throw Error(opened.error.code);
const library=opened.value,models=modelConfigFor(library),assets=assetsFor(library),canvas=canvasFor(library,assets);
const adapter=new OpenAIChatAdapter(new ArtifactSource(library.root,undefined,'text'),new ProviderEvidence(library));
const generation=generationFor(library,models,{adapter,context:{}},undefined,canvas,assets),workflows=workflowsFor(library,canvas,generation,models,assets);
if(process.argv[3]==='before')process.exit(83);
if(process.argv[3]==='between'){
 library.db.function('fixture_crash',()=>{process.exit(83);});
 library.db.exec('CREATE TEMP TRIGGER crash_link BEFORE UPDATE OF task_id ON workflow_step WHEN NEW.task_id IS NOT NULL BEGIN SELECT fixture_crash(); END');
}
const result=await workflows.wake();if(!result.ok)throw Error(result.error.code);process.exit(83);
