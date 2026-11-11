import { startEngine } from '../../packages/engine/src/bootstrap.ts';
const result = await startEngine({ root: process.argv[2]! });
if (!result.ok) throw Error(result.error.code);
process.send?.({ ready: true });
setInterval(() => {}, 1000);
