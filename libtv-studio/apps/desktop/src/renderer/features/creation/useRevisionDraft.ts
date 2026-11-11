import { useLayoutEffect, useRef, useState } from 'react';

/** Local drafts survive query refresh; only an acknowledgement advances their save baseline. */
export function useRevisionDraft<T extends { expectedRevision: number }>(initial: () => T) {
  const [state, setState] = useState(() => ({ draft: initial(), saved: false, dirty: false }));
  const current = useRef(state);
  const generation = useRef(0);
  const scope = useRef(0);
  const active = useRef(false);
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);

  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; scope.current++; };
  }, []);

  function update(next: typeof state) {
    current.current = next;
    setState(next);
  }
  function change(patch: Partial<T>) {
    generation.current++;
    update({ draft: { ...current.current.draft, ...patch }, saved: false, dirty: true });
  }
  function reload(draft: T) {
    // An explicit reload replaces the editing baseline, invalidating an older acknowledgement.
    scope.current++;
    generation.current++;
    update({ draft, saved: false, dirty: false });
  }
  async function save<R>(persist: (draft: T) => Promise<R | undefined>, toDraft: (result: R) => T, onSaved: (result: R) => void) {
    if (inFlight.current) return false;
    const submitted = current.current.draft;
    const submittedGeneration = generation.current;
    const submittedScope = scope.current;
    inFlight.current = true;
    setSaving(true);
    try {
      const result = await persist(submitted);
      if (!result || !active.current || scope.current !== submittedScope) return false;
      const acknowledged = toDraft(result);
      const changed = generation.current !== submittedGeneration;
      update({
        draft: changed ? { ...current.current.draft, expectedRevision: acknowledged.expectedRevision } : acknowledged,
        saved: !changed,
        dirty: changed,
      });
      onSaved(result);
      return !changed;
    } finally {
      inFlight.current = false;
      if (active.current) setSaving(false);
    }
  }
  return { ...state, saving, change, reload, save };
}
