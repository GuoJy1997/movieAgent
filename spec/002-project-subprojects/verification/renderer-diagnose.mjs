import {read,write,replace} from './edit.mjs';
replace('tests/renderer/p4-harness.ts',"await server.listen();","await server.listen();console.log('p4 ready: server');");
replace('tests/renderer/p4-harness.ts',"await server.warmupRequest('/tests/fixtures/p4-renderer/main.tsx');","await server.warmupRequest('/tests/fixtures/p4-renderer/main.tsx');console.log('p4 ready: warm');");
replace('tests/renderer/p4-harness.ts',"await server.waitForRequestsIdle();","await server.waitForRequestsIdle();console.log('p4 ready: idle');");
replace('tests/renderer/p4-harness.ts',"const address=","console.log('p4 ready: browser');const address=");
replace('tests/integration/subproject-backup.test.ts',"'EXECUTION_PAUSED'","'RESTORED_PROJECT_PAUSED'");

