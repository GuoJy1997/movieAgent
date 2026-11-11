import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

// Deliberate release action; ordinary tests never write frozen documentation.
try {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--source' || args[2] !== '--target') throw Error('EXPECTED_SOURCE_AND_TARGET');
  const bytes = await readFile(resolve(args[1]));
  const evidence = JSON.parse(bytes.toString('utf8'));
  if (evidence.status !== 'passed' || !Array.isArray(evidence.packageIdentity) || evidence.packageIdentity.length !== 2) throw Error('SUCCESSFUL_MEASUREMENT_REQUIRED');
  for (const item of evidence.packageIdentity) {
    const hash = createHash('sha256').update(await readFile(item.path)).digest('hex');
    if (hash !== item.sha256) throw Error('MEASURED_PACKAGE_CHANGED');
  }
  await writeFile(resolve(args[3]), bytes);
  console.log('PERFORMANCE_EVIDENCE_PROMOTED');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'PROMOTION_FAILED');
  process.exitCode = 1;
}
