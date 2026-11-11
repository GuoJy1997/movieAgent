import { join } from 'node:path';
import { inspectDirectoryProject, createDirectoryProject, bindDirectoryProject } from './project-directories.ts';
import { RecentProjects } from './recent-projects.ts';
import type { DirectoryProject } from '../../../../packages/contracts/src/directory-projects.ts';
import { fail, ok, type Result } from '../../../../packages/contracts/src/result.ts';
import { isResult } from '../../../../packages/contracts/src/desktop.ts';
import { isReceipt } from '../../../../packages/contracts/src/commands.ts';
import { isProject } from '../../../../packages/contracts/src/projects.ts';
import { queryOutputValidators } from '../../../../packages/contracts/src/queries.ts';
import type { EngineHost } from './engine-host.ts';

export async function validateWorkspace(root: string, launcherData: string): Promise<Result<DirectoryProject>> {
  const inspected = await inspectDirectoryProject(root); if (!inspected.ok) return inspected;
  const registry = await RecentProjects.open(join(launcherData, 'recent-projects.json')); if (!registry.ok) return registry;
  const registered = await registry.value.validate(inspected.value); if (!registered.ok) return registered;
  return inspected;
}
export async function bootstrapWorkspace(project: DirectoryProject, host: Pick<EngineHost, 'identity' | 'execute' | 'query'>): Promise<Result<DirectoryProject>> {
  const base = { schemaVersion: 1, libraryId: host.identity.libraryId, connectionEpoch: 'directory-bootstrap' };
  let binding = project.manifest.binding;
  if (!binding) {
    // Receipt identity survives a process exit between DB commit and manifest binding.
    const receipt = await host.execute({ ...base, kind: 'project.create', commandId: `directory-init-${project.manifest.workspaceId}`, payload: { name: project.manifest.name } });
    if (!isResult(receipt, isReceipt) || !receipt.ok || !isProject(receipt.value.result)) return fail('WORKSPACE_INIT_FAILED', '项目初始化未完成，请重新打开。');
    binding = { libraryId: host.identity.libraryId, projectId: receipt.value.result.id };
  }
  if (binding.libraryId !== host.identity.libraryId) return fail('WORKSPACE_BINDING_MISMATCH', '项目与资料库身份不匹配。');
  const listed = await host.query({ ...base, kind: 'project.list', queryId: 'directory-binding', payload: {} });
  if (!isResult(listed, queryOutputValidators['project.list']) || !listed.ok || !listed.value.projects.some(p => p.id === binding.projectId && p.libraryId === binding.libraryId)) return fail('WORKSPACE_BINDING_MISMATCH', '绑定的项目不存在，请恢复原资料库。');
  const bound = await bindDirectoryProject(project.root, { ...binding, workspaceId: project.manifest.workspaceId }); if (!bound.ok) return bound;
  const filled = await createDirectoryProject({ mode: 'existing', directory: project.root, name: project.manifest.name });
  return filled.ok ? ok(filled.value) : filled;
}
