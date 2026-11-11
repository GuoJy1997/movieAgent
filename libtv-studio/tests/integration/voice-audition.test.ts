import { expect, it } from 'vitest';
import { computeAuditionFingerprint, evaluateAuditionGate } from '../../packages/domain/src/voice-audition.ts';

const input = {
  voiceRef: { id: 'voice-a', revision: 2 },
  profileRef: { libraryId: 'library', id: 'h3', revision: 3 },
  route: 'native-reference' as const,
  dialect: '山东话',
  reference: { hash: 'a'.repeat(64), probeId: 'probe-a', sourceInTicks: 48000, durationTicks: 96000 },
  entityImageHashes: ['b'.repeat(64)],
  templateRevision: 1,
};
const fingerprint = computeAuditionFingerprint(input);
const passed = (emotion: 'calm' | 'excited' | 'quiet' | 'exchange') => ({ emotion, fingerprint, pairKey: emotion==='exchange'?'a/b':null, checks: { timbre: 'pass', accent: 'pass', dialogue: 'pass', lipsync: 'pass' } });

it('binds acoustic evidence to voice, crop, model and route but not the display name', () => {
  expect(computeAuditionFingerprint(input)).toBe(fingerprint);
  expect(computeAuditionFingerprint({ ...input, templateRevision: 2 })).not.toBe(fingerprint);
  expect(computeAuditionFingerprint({ ...input, dialect: '普通话' })).not.toBe(fingerprint);
  expect(computeAuditionFingerprint({ ...input, reference: { ...input.reference, sourceInTicks: 0 } })).not.toBe(fingerprint);
  expect(computeAuditionFingerprint({ ...input, profileRef: { ...input.profileRef, revision: 4 } })).not.toBe(fingerprint);
});

it('threeEmotionsRequired and newPairNeedsExchange', () => {
  expect(evaluateAuditionGate({ fingerprint, pairKey: null, evidence: [] })).toMatchObject({ allowed: false, missing: ['calm', 'excited', 'quiet'] });
  const emotions = [passed('calm'), passed('excited'), passed('quiet')];
  expect(evaluateAuditionGate({ fingerprint, pairKey: null, evidence: emotions })).toMatchObject({ allowed: true, missing: [] });
  expect(evaluateAuditionGate({ fingerprint, pairKey: 'a/b', evidence: emotions })).toMatchObject({ allowed: false, missing: ['exchange'] });
  expect(evaluateAuditionGate({ fingerprint, pairKey: 'a/b', evidence: [...emotions, passed('exchange')] })).toMatchObject({ allowed: true, missing: [] });
  expect(evaluateAuditionGate({ fingerprint, pairKey: 'a/c', evidence: [...emotions, passed('exchange')] })).toMatchObject({ allowed: false, missing: ['exchange'] });
  expect(evaluateAuditionGate({ fingerprint, pairKey: null, route:'native-reference', evidence: emotions.map(e=>({...e,checks:{...e.checks,lipsync:'not-applicable'}})) })).toMatchObject({ allowed: false });
});

it('modelOrVoiceChangeStalesEvidence and batchExceptionIsScoped', () => {
  const evidence = [passed('calm'), passed('excited'), passed('quiet')];
  expect(evaluateAuditionGate({ fingerprint: computeAuditionFingerprint({ ...input, profileRef: { ...input.profileRef, revision: 99 } }), pairKey: null, evidence })).toMatchObject({ allowed: false });
  const exception = { reason: '导演确认本批例外', emotions: ['calm', 'excited', 'quiet'] as const };
  expect(evaluateAuditionGate({ fingerprint, pairKey: 'a/b', evidence, exception })).toMatchObject({ allowed: true, missing: [] });
  expect(evaluateAuditionGate({ fingerprint: computeAuditionFingerprint({ ...input, route: 'dubbed-lipsync' }), pairKey: 'a/b', evidence })).toMatchObject({ allowed: false });
});
