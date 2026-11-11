import type { ScriptRevision, ShotRevision } from '../../../../../../packages/contracts/src/creation.ts';

export interface CreationNavigation {
  scriptId: string;
  focusDismissed: boolean;
  shot: ShotRevision | 'new' | null;
  editing: ScriptRevision | 'new' | null;
}
type NavigationAction =
  | { type: 'selectScript'; scriptId: string }
  | { type: 'patch'; patch: Partial<CreationNavigation> };

export function creationNavigation(state: CreationNavigation, action: NavigationAction): CreationNavigation {
  if (action.type === 'selectScript') {
    return { scriptId: action.scriptId, focusDismissed: true, shot: null, editing: null };
  }
  return { ...state, ...action.patch };
}

export function resolveShotEditor(
  state: CreationNavigation,
  focusShotId: string | undefined,
  scriptId: string | undefined,
  shots: ShotRevision[],
): ShotRevision | 'new' | null {
  if (!scriptId) return null;
  const candidate = state.shot ?? (!state.focusDismissed ? shots.find(shot => shot.id === focusShotId) : null);
  return candidate === 'new' || candidate?.scriptId === scriptId ? candidate : null;
}
