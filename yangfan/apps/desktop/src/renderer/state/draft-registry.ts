import type { AudioDraftHandle } from '../features/audio/AudioWorkspace.tsx';

/** Each mounted editor owns its buffer. Async saves cannot clear a newer generation. */
export function createDraftRegistry() {
  const owners = new Map<symbol, AudioDraftHandle & {ephemeral?:boolean}>();
  const listeners = new Set<() => void>();
  let version = 0;
  const publish = () => { version++; listeners.forEach(listener => listener()); };
  const dirty = () => [...owners.values()].some(handle => handle.dirty);
  return {
    dirty,
    onlyEphemeral: () => [...owners.values()].filter(h=>h.dirty).every(h=>h.ephemeral),
    version: () => version,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(owner: symbol, handle: AudioDraftHandle & {ephemeral?:boolean}) { owners.set(owner, handle); publish(); },
    remove(owner: symbol) { if (owners.delete(owner)) publish(); },
    async saveAll() {
      const captured = [...owners.entries()].filter(([, handle]) => handle.dirty);
      for (const [owner, handle] of captured) {
        if (owners.get(owner) !== handle) return false;
        if (!await handle.save()) return false;
        const current = owners.get(owner);
        if (current !== handle && current?.dirty) return false;
        // A true acknowledgement cleans exactly the submitted generation.
        if (current === handle) { owners.set(owner, { ...handle, dirty: false }); publish(); }
        if ([...owners].some(([key, value]) => value.dirty && !captured.some(([oldKey, oldValue]) => key === oldKey && value === oldValue))) return false;
      }
      return !dirty();
    },
    discardAll() { for (const handle of [...owners.values()]) if (handle.dirty) handle.discard(); },
  };
}
export const draftRegistry = createDraftRegistry();
