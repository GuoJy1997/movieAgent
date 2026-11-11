import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
export const packageExecutable = resolve(process.env.MOVIEAGENT_TEST_PACKAGE ?? 'apps/desktop/release/win-unpacked', 'MovieAgent.exe');
/** Explicit empty software config prevents test launches from importing user services. */
export async function isolatedModelConfig(root: string) {
  const path = join(root, 'isolated-models.json');
  await writeFile(path, JSON.stringify({ schemaVersion: 1, providers: [] }));
  return `--model-config=${path}`;
}
