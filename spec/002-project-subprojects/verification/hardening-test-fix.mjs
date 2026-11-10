import {replace} from './edit.mjs';
replace('tests/integration/subproject-hardening.test.ts',"import {expect,it} from 'vitest';","import {expect,it} from 'vitest';\nimport {DatabaseSync} from 'node:sqlite';\nimport {join} from 'node:path';");
replace('tests/integration/subproject-hardening.test.ts',"const prepared=value(e.generation.prepare(f.prepareInput()));","const prepared=value(e.generation.prepare(f.prepareInput()));\n const db=new DatabaseSync(join(f.root,'library.sqlite')); const lib={db,libraryId:e.identity.libraryId,checkOwnership:()=>({ok:true,value:undefined})} as any; try{");
replace('tests/integration/subproject-hardening.test.ts','e.library.db.prepare','db.prepare');
replace('tests/integration/subproject-hardening.test.ts','e.library.db.prepare','db.prepare');
replace('tests/integration/subproject-hardening.test.ts','contentScopesFor(e.library)','contentScopesFor(lib)');
replace('tests/integration/subproject-hardening.test.ts','},30000);','}finally{db.close();}\n},30000);');

