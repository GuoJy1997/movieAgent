import { createHash } from 'node:crypto';
import type { CreationRef } from '../../contracts/src/creation.ts';
import type { RevisionRef } from '../../contracts/src/models.ts';
import type { DialogueRoute, DialogueEmotion, VoiceReference } from '../../contracts/src/character-voice.ts';

export interface AuditionFingerprintInput { voiceRef: CreationRef; profileRef: RevisionRef; route: DialogueRoute; dialect: string; reference: Pick<VoiceReference, 'hash' | 'probeId' | 'sourceInTicks' | 'durationTicks'>; entityImageHashes: string[]; templateRevision: number }
export interface AuditionEvidence { emotion: DialogueEmotion; fingerprint: string; pairKey?: string|null; checks: { timbre: string; accent: string; dialogue: string; lipsync: string } }
export interface AuditionException { reason: string; emotions: readonly DialogueEmotion[] }
export interface AuditionGate { allowed: boolean; missing: DialogueEmotion[] }
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : value;
export const computeAuditionFingerprint = (input: AuditionFingerprintInput) => createHash('sha256').update(JSON.stringify(stable(input))).digest('hex');
const required: DialogueEmotion[] = ['calm', 'excited', 'quiet'];
export function evaluateAuditionGate(input: { fingerprint: string; pairKey: string | null; route?:DialogueRoute; evidence: AuditionEvidence[]; exception?: AuditionException }): AuditionGate {
  if (input.exception?.reason.trim()) return { allowed: true, missing: [] };
  const requiredCases = input.exception?.reason.trim() ? input.exception.emotions : [...required, ...(input.pairKey ? ['exchange' as const] : [])];
  const missing = requiredCases.filter(emotion => !input.evidence.some(evidence => evidence.emotion === emotion && evidence.fingerprint === input.fingerprint && (emotion!=='exchange'||evidence.pairKey===input.pairKey) && evidence.checks.timbre === 'pass' && evidence.checks.accent === 'pass' && evidence.checks.dialogue === 'pass' && (evidence.checks.lipsync==='pass'||input.route==='voiceover'&&evidence.checks.lipsync==='not-applicable')));
  return { allowed: missing.length === 0, missing };
}
