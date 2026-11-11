import {startMediaDiagnostics} from './media-diagnostics.ts';
import { app, dialog, protocol } from 'electron';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { configPathFor, runProjectLauncher } from './project-launcher.ts';
import { validateWorkspace } from './workspace-bootstrap.ts';
import { runWorkbench } from './workbench.ts';
protocol.registerSchemesAsPrivileged([{ scheme: 'app-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
app.setName('MovieAgent');
const argument = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
if(argument('provider-evidence')==='fixture'&&process.env.MOVIEAGENT_MEDIA_DIAGNOSTICS_DIR)startMediaDiagnostics(process.env.MOVIEAGENT_MEDIA_DIAGNOSTICS_DIR,'main');
const child = process.argv.includes('--workspace-child');
const legacy = !process.argv.includes('--project-launcher') && (process.argv.includes('--legacy-workspace') || argument('library-root') !== undefined);
const launcherData = child || legacy ? argument('launcher-data') ?? join(app.getPath('appData'), 'MovieAgent', 'launcher') : argument('user-data-dir') ?? join(app.getPath('appData'), 'MovieAgent', 'launcher');
const token = argument('startup-token');
async function report(ready: boolean) { if (token && /^[a-f0-9-]{36}$/.test(token)) await writeFile(join(launcherData, `startup-${token}.json`), JSON.stringify({ ready })).catch(() => {}); }
void (async () => {
  if (child) {
    const root = argument('project-root'); if (!root) throw Error('PROJECT_REQUIRED');
    const checked = await validateWorkspace(root, launcherData); if (!checked.ok) throw Error(checked.error.code);
    app.setPath('userData', join(launcherData, 'directory-workspaces', checked.value.manifest.workspaceId));
    const modelConfig = argument('model-config') ?? join(launcherData, 'models.json');
    runWorkbench({ project: checked.value, launcherData, modelConfig, report });
  } else if (legacy) {
    app.setPath('userData', argument('user-data-dir') ?? join(app.getPath('appData'), '@libtv', 'desktop'));
    runWorkbench({ project: null, launcherData, modelConfig: argument('model-config') ?? join(launcherData, 'models.json'), report });
  } else {
    app.setPath('userData', launcherData);
    if (!app.requestSingleInstanceLock()) { app.exit(0); return; }
    const modelConfig = await configPathFor(launcherData, argument('model-config'));
    await runProjectLauncher({ data: launcherData, modelConfig, ...(argument('project-root') ? { initialRoot: argument('project-root') } : {}) });
  }
})().catch(async () => { await report(false); await app.whenReady(); dialog.showErrorBox('启动失败', '项目目录、登记身份或安装文件无效。请通过项目启动器重新打开。'); app.quit(); });
