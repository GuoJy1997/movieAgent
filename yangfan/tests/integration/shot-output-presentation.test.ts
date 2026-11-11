import { expect, it } from 'vitest';
import { selectedOutputRevision, outputSoundSourceLabel } from '../../apps/desktop/src/renderer/features/creation/shot-output-presentation';
const ref={kind:'artifact' as const,libraryId:'library',artifactId:'old-result'};
it('keeps the production revision when a user selects an old result at a newer choice revision',()=>{
 expect(selectedOutputRevision(ref,[{reference:ref,shotRevision:2}])).toBe(2);
 expect(selectedOutputRevision({...ref,artifactId:'another-result'},[{reference:ref,shotRevision:2}])).toBeNull();
});

it('labels only the exact current dialogue output with its sound provenance', () => {
 const ref = { kind: 'assetVersion' as const, libraryId: 'library', assetId: 'video', version: 2 };
 const selection = { video: ref, dialogue: { route: 'dubbed-lipsync' } } as import('../../packages/contracts/src/creation.ts').ShotOutputSelection;
 expect(outputSoundSourceLabel(ref, selection)).toBe('独立配音＋修正画面');
 expect(outputSoundSourceLabel({ ...ref, version: 1 }, selection)).toBe('无对白元数据 · 默认静音');
});
it('matches asset versions exactly rather than substituting a different version or library',()=>{
 const asset={kind:'assetVersion' as const,libraryId:'library',assetId:'asset',version:1};
 const history=[{reference:asset,shotRevision:2},{reference:{...asset,version:2},shotRevision:5}];
 expect(selectedOutputRevision({...asset,version:2},history)).toBe(5);
 expect(selectedOutputRevision({...asset,libraryId:'foreign'},history)).toBeNull();
});
