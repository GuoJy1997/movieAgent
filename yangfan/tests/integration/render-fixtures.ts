import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startEngine } from '../../packages/engine/src/bootstrap.ts';
import { loadMediaRuntime } from '../../packages/engine/src/media/manifest.ts';
import { roots, engines, unwrap, command } from './timeline-fixtures.ts';
import type { LocalMediaOptions } from '../../packages/engine/src/render-service.ts';
export async function setupRender(localMedia?: LocalMediaOptions) {
    const root = await mkdtemp(join(tmpdir(), 'render-'));
    roots.push(root);
    const runtime = unwrap(await loadMediaRuntime(resolve('apps/desktop/resources/media-runtime/win32-x64')));
    const e = unwrap(await startEngine({
        root, runtime, localMedia
    }));
    engines.push(e);
    const projectId = (unwrap(await e.commands.execute(command(e, 'project.create', {
        name: 'Render'
    }))).result as {
        id: string;
    }).id;
    unwrap(await e.commands.execute(command(e, 'creation.saveScript', {
        projectId, id: 'script', expectedRevision: 0, title: 'Render', synopsis: '', body: '', scenes: []
    })));
    return {
        e, root, projectId, runtime
    };
}
