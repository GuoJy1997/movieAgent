import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AudioDraftHandle } from '../features/audio/AudioWorkspace.tsx';
import { Button } from '../../../../../packages/ui/src/controls.tsx';
import { Dialog } from '../../../../../packages/ui/src/overlays.tsx';
import { draftRegistry } from './draft-registry.ts';

export function timelineNavigate(action: () => void) {
  if (window.dispatchEvent(new CustomEvent('studio:timeline-navigate', { cancelable: true, detail: action }))) action();
}

export function useOwnedDraft(handle: AudioDraftHandle & {ephemeral?:boolean}, generation: unknown) {
  const owner = useRef(Symbol('draft')), latest = useRef(handle);
  latest.current = handle;
  useLayoutEffect(() => { draftRegistry.set(owner.current, { dirty: handle.dirty, ephemeral:handle.ephemeral, save: () => latest.current.save(), discard: () => latest.current.discard() }); }, [generation, handle.dirty]);
  useLayoutEffect(() => () => draftRegistry.remove(owner.current), []);
}

export function DraftNavigationGuard() {
  const version = useSyncExternalStore(draftRegistry.subscribe, draftRegistry.version);
  const [pending, setPending] = useState<{ id:number; action:() => void } | null>(null), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const intent = useRef(0);
  const cancel = () => { intent.current++; setPending(null); };
  const token = useRef(crypto.randomUUID());
  useEffect(() => { const dirty = draftRegistry.dirty(); if (dirty) token.current = crypto.randomUUID(); void window.studio.setTimelineDraftState?.({ dirty, token: token.current }); }, [version]);
  useEffect(() => {
    const navigate = (event: Event) => { const id = ++intent.current; setError(''); if (draftRegistry.dirty()) { event.preventDefault(); setPending({ id, action:(event as CustomEvent<() => void>).detail }); } else setPending(null); };
    const close = (event: BeforeUnloadEvent) => { if (draftRegistry.dirty()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('studio:timeline-navigate', navigate); window.addEventListener('beforeunload', close);
    return () => { intent.current++; window.removeEventListener('studio:timeline-navigate', navigate); window.removeEventListener('beforeunload', close); void window.studio.setTimelineDraftState?.({ dirty: false, token: token.current }); };
  }, []);
  if (!pending) return null;
  return <Dialog title={draftRegistry.onlyEphemeral()?"保留创作草稿":"保存当前剪辑"} onClose={cancel}><p>{draftRegistry.onlyEphemeral()?"未发送的内容可保留到本次应用会话；完全退出前请自行保存需要的文字。":"有未保存内容。保存期间的新编辑也会保留，全部保存后才离开。"}</p>{error && <p role="alert">{error}</p>}<div className="dialog-actions"><Button disabled={saving} onClick={cancel}>继续编辑</Button><Button disabled={saving} onClick={async () => { const captured = pending; setSaving(true); setError(''); try { if (await draftRegistry.saveAll() && intent.current === captured.id) { cancel(); captured.action(); } } catch { if (intent.current === captured.id) setError('保存失败，草稿已保留。'); } finally { setSaving(false); } }}>{draftRegistry.onlyEphemeral()?"保留草稿并离开":"保存并离开"}</Button><Button tone="danger" disabled={saving} onClick={() => { draftRegistry.discardAll(); const action = pending.action; cancel(); action(); }}>放弃草稿并离开</Button></div></Dialog>;
}
