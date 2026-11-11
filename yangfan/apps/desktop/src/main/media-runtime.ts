import { app } from 'electron';
import { join } from 'node:path';
import { loadMediaRuntime } from '../../../../packages/engine/src/media/manifest.ts';
/** Application-owned roots only. Failure keeps legacy images/video usable, audio fails closed. */
export function resolveMediaRuntime() {
  return loadMediaRuntime(app.isPackaged ? join(process.resourcesPath, 'media-runtime', 'win32-x64') : join(app.getAppPath(), 'resources', 'media-runtime', 'win32-x64'));
}
