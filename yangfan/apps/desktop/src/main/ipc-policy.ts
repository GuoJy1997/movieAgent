import {isMcpConfigureInput,type McpDesktopActions} from '../../../../packages/contracts/src/mcp.ts';
import { isExportCreationInput } from '../../../../packages/contracts/src/creation-export.ts';
import { isExportTimelineInput, isCancelTimelineExport } from '../../../../packages/contracts/src/timeline-export.ts';
import { parseVoiceExport } from '../../../../packages/contracts/src/character-voice.ts';
import type { WorkspaceActions } from '../../../../packages/contracts/src/launcher.ts';
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { fail } from '../../../../packages/contracts/src/result.ts';
import { parseCreateProject } from '../../../../packages/contracts/src/projects.ts';
import { parseCommand } from '../../../../packages/contracts/src/commands.ts';
import { parseQuery } from '../../../../packages/contracts/src/queries.ts';
import { parseSubscription } from '../../../../packages/contracts/src/events.ts';
import type { LocalConnection } from './local-connection.ts';
import { isRevisionRef, type ConnectionRevisionRef } from '../../../../packages/contracts/src/models.ts';
import { isTimelineDraftState, type TimelineDraftState, type SubtitleFile, type CredentialEditorOutcome } from '../../../../packages/contracts/src/desktop.ts';
import type { Result } from '../../../../packages/contracts/src/result.ts';
import type { FileGrantRef } from '../../../../packages/contracts/src/assets.ts';
import { isModelConfigEditorInput, type ModelConfigActions, type RemoveModelConfigProviderInput } from '../../../../packages/contracts/src/model-config-file.ts';
export function installWorkspaceIpc(window: BrowserWindow, expectedUrl: string, connected: LocalConnection | (() => LocalConnection), openCredentialEditor?: (ref: ConnectionRevisionRef) => Promise<Result<CredentialEditorOutcome>>, files?: { select(): Promise<Result<FileGrantRef | null>>; selectSubtitle?():Promise<Result<SubtitleFile|null>>; setDraft?(value:TimelineDraftState):Promise<Result<void>>; mediaUrl(input: unknown): Promise<Result<string>>; derivedMediaUrl?(input: unknown): Promise<Result<string>>; releaseMediaUrl?(url: string): Promise<Result<void>> }, workspace?: WorkspaceActions, modelConfig?: ModelConfigActions, mcp?: McpDesktopActions): () => void {
  function allowed(event: IpcMainInvokeEvent): boolean {
    const frame = event.senderFrame;
    return !window.isDestroyed() && event.sender === window.webContents && frame !== null && frame === window.webContents.mainFrame && (frame.url === expectedUrl || (!expectedUrl.startsWith('file:') && frame.url === `${expectedUrl}/`));
  }
  const channels = ['studio:mcp:status','studio:mcp:configure','studio:mcp:select-directory','studio:subtitle:select', 'studio:timeline:draft', 'studio:timeline:export', 'studio:timeline:cancel-export', 'studio:voice:export', 'studio:creation:export', 'studio:model-config:read', 'studio:model-config:edit', 'studio:model-config:remove', 'studio:workspace:info', 'studio:workspace:folder', 'studio:workspace:launcher', 'studio:workspace:reload', 'studio:describe', 'studio:execute', 'studio:query', 'studio:events', 'studio:project:create', 'studio:project:list', 'studio:credential:open', 'studio:files:select', 'studio:media:url', 'studio:media:derived-url', 'studio:media:release'] as const;
  for (const channel of channels) {
    ipcMain.handle(channel, async (event, input: unknown) => {
      const connection = typeof connected === 'function' ? connected() : connected;
      if (!allowed(event)) return fail('FORBIDDEN', '此窗口或 frame 无权访问资料库。');
      if(channel==='studio:mcp:status')return input===undefined&&mcp?mcp.status():fail('INVALID_INPUT','MCP状态查询不接受参数。');
      if(channel==='studio:mcp:configure')return isMcpConfigureInput(input)&&mcp?mcp.configure(input):fail('INVALID_INPUT','MCP配置字段无效。');
      if(channel==='studio:mcp:select-directory')return input===undefined&&mcp?mcp.selectDirectory():fail('INVALID_INPUT','导入目录只能通过系统选择器授权。');
      if(channel==='studio:subtitle:select')return input===undefined&&files?.selectSubtitle?files.selectSubtitle():fail('INVALID_INPUT','字幕选择不接受参数。');
      if(channel==='studio:timeline:draft')return isTimelineDraftState(input)&&files?.setDraft?files.setDraft(input):fail('INVALID_INPUT','草稿状态无效。');
      if (channel === 'studio:timeline:export') return isExportTimelineInput(input) && workspace?.exportTimeline ? workspace.exportTimeline(input) : fail('INVALID_INPUT','导出参数无效。');
      if (channel === 'studio:timeline:cancel-export') return isCancelTimelineExport(input) && workspace?.cancelTimelineExport ? workspace.cancelTimelineExport(input) : fail('INVALID_INPUT','取消导出参数无效。');
      if (channel === 'studio:voice:export') { const parsed = parseVoiceExport(input); return parsed.ok && workspace?.exportVoice ? workspace.exportVoice(parsed.value) : fail('INVALID_INPUT','声音导出参数无效。'); }
      if (channel === 'studio:creation:export') return isExportCreationInput(input) && workspace?.exportCreation ? workspace.exportCreation(input) : fail('INVALID_INPUT','导出入口或参数无效。');
      if (channel.startsWith('studio:model-config:')) {
        if (!modelConfig) return fail('MODEL_CONFIG_UI_UNAVAILABLE','配置入口不可用。');
        if (channel === 'studio:model-config:read') return input === undefined ? modelConfig.read() : fail('INVALID_INPUT','配置读取不接受参数。');
        if (!isModelConfigEditorInput(input, channel === 'studio:model-config:remove')) return fail('INVALID_INPUT','请指定配置版本及有效条目 ID。');
        return channel === 'studio:model-config:edit' ? modelConfig.edit(input) : modelConfig.remove(input as RemoveModelConfigProviderInput);
      }
      if (channel.startsWith('studio:workspace:')) {
        if (input !== undefined || !workspace) return fail('INVALID_INPUT', '工作区入口不可用。');
        if (channel === 'studio:workspace:info') return workspace.info();
        if (channel === 'studio:workspace:folder') return workspace.openFolder();
        if (channel === 'studio:workspace:launcher') return workspace.openLauncher();
        return workspace.reloadModelConfig();
      }
      if (workspace && (channel === 'studio:project:create' || channel === 'studio:execute' && typeof input === 'object' && input !== null && 'kind' in input && input.kind === 'project.create')) {
        const info = await workspace.info();
        if (info.ok && info.value.project) return fail('DIRECTORY_PROJECT_FIXED', '此目录已绑定短剧项目，请从启动器新建其他短剧。');
      }
      if (channel === 'studio:files:select') return input === undefined && files ? files.select() : fail('INVALID_INPUT', '文件选择入口不可用。');
      if (channel === 'studio:media:release') return typeof input==='string'&&input.length<=512&&files?.releaseMediaUrl?files.releaseMediaUrl(input):fail('INVALID_INPUT','媒体授权无效。');
      if (channel === 'studio:media:derived-url') return files?.derivedMediaUrl ? files.derivedMediaUrl(input) : fail('MEDIA_UNAVAILABLE','派生媒体入口不可用。');
      if (channel === 'studio:media:url') return files ? files.mediaUrl(input) : fail('MEDIA_UNAVAILABLE', '媒体入口不可用。');
      if (channel === 'studio:describe') return input === undefined ? connection.describe() : fail('INVALID_INPUT', '描述查询不接受参数。');
      if (channel === 'studio:credential:open') {
        if (!isRevisionRef(input)) return fail('INVALID_INPUT', '请指定固定连接版本。');
        const descriptor = await connection.describe(); if (!descriptor.ok) return descriptor;
        if (input.libraryId !== descriptor.value.libraryId) return fail('WRONG_LIBRARY', '凭据连接属于其他资料库。');
        return openCredentialEditor ? openCredentialEditor(input) : fail('CREDENTIAL_UI_UNAVAILABLE', '凭据入口不可用。');
      }
      if (channel === 'studio:execute') {
        const parsed = parseCommand(input); if (!parsed.ok) return parsed;
        // Synchronize global defaults before any new single-task or workflow admission.
        // Receipt replay is recovery, not a new admission, and keeps its old policy.
        if (modelConfig && ['shots.prepareProduction','shots.applyProduction','agent.prepareTurn','agent.approveTurn','generation.prepare','generation.approveAndEnqueue','workflow.prepare','workflow.approveAndEnqueue'].includes(parsed.value.kind)) {
          const receipt = await connection.query({ schemaVersion: 1, libraryId: parsed.value.libraryId, connectionEpoch: parsed.value.connectionEpoch, queryId: randomUUID(), kind: 'command.receipt', payload: { commandId: parsed.value.commandId } });
          if (!receipt.ok) return receipt;
          if (!receipt.value) { const ready = await modelConfig.ensureCurrent(); if (!ready.ok) return ready; }
        }
        return connection.execute(parsed.value);
      }
      if (channel === 'studio:query') { const parsed = parseQuery(input); return parsed.ok ? connection.query(parsed.value) : parsed; }
      if (channel === 'studio:events') { const parsed = parseSubscription(input); return parsed.ok ? connection.readEvents(parsed.value) : parsed; }
      const descriptor = await connection.describe(); if (!descriptor.ok) return descriptor;
      const base = { schemaVersion: 1 as const, libraryId: descriptor.value.libraryId, connectionEpoch: descriptor.value.connectionEpoch };
      // Task 1 convenience calls route through exactly the same durable pipeline.
      if (channel === 'studio:project:create') {
        const parsed = parseCreateProject(input); if (!parsed.ok) return parsed;
        const result = await connection.execute({ ...base, kind: 'project.create', commandId: randomUUID(), payload: parsed.value });
        return result.ok ? { ok: true, value: result.value.result } : result;
      }
      if (input !== undefined) return fail('INVALID_INPUT', '项目列表查询不接受参数。');
      const result = await connection.query({ ...base, kind: 'project.list', queryId: randomUUID(), payload: {} });
      return result.ok ? { ok: true, value: result.value.projects } : result;
    });
  }
  return () => { for (const channel of channels) ipcMain.removeHandler(channel); };
}
