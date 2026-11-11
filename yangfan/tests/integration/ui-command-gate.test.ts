import { expect, it } from 'vitest';
import { CommandGate } from '../../apps/desktop/src/renderer/services/command-gate.ts';

it('uncertain ACK blocks replacement commands and retains original identity until receipt resolution', async () => {
  const gate = new CommandGate();
  const command = {
    commandId: 'original',
    libraryId: 'library',
    connectionEpoch: 'epoch',
    kind: 'generation.approveAndEnqueue',
    payload: { preparedId: 'plan' },
    schemaVersion: 1,
  };
  gate.begin(command);
  gate.uncertain();
  expect(gate.pending).toEqual(command);
  expect(() => gate.begin({ ...command, commandId: 'replacement' })).toThrow();
  expect(gate.resolve(null)).toBe(false);
  expect(gate.pending).toEqual(command);
  expect(gate.resolve({ commandId: 'other', libraryId: 'library' })).toBe(false);
  expect(gate.resolve({ commandId: 'original', libraryId: 'library' })).toBe(true);
  expect(gate.pending).toBeNull();
});
