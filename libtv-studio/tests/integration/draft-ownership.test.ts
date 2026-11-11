import { expect, it } from 'vitest';
import { createDraftRegistry } from '../../apps/desktop/src/renderer/state/draft-registry.ts';

it('removes only one owner and refuses navigation after a failed save', async () => {
  const registry = createDraftRegistry(), a = Symbol(), b = Symbol();
  registry.set(a, { dirty: true, save: async () => true, discard() {} });
  registry.set(b, { dirty: true, save: async () => false, discard() {} });
  registry.remove(a);
  expect(registry.dirty()).toBe(true);
  expect(await registry.saveAll()).toBe(false);
  registry.remove(b);
  expect(registry.dirty()).toBe(false);
});

it('a late A acknowledgement cannot navigate past edit B or a new owner', async () => {
  const registry = createDraftRegistry(), a = Symbol();
  let resolve!: (value: boolean) => void;
  registry.set(a, { dirty: true, save: () => new Promise(r => { resolve = r; }), discard() {} });
  const saving = registry.saveAll();
  registry.set(a, { dirty: true, save: async () => true, discard() {} });
  resolve(true);
  expect(await saving).toBe(false);
  registry.remove(a);
  expect(registry.dirty()).toBe(false);
});

it('rechecks all owners after each awaited save and ignores removed scope acknowledgements', async () => {
  const registry = createDraftRegistry(), a = Symbol(), b = Symbol();
  let resolve!: (value: boolean) => void;
  registry.set(a, { dirty: true, save: () => new Promise(r => { resolve = r; }), discard() {} });
  const saving = registry.saveAll();
  registry.remove(a);
  registry.set(b, { dirty: true, save: async () => true, discard() {} });
  resolve(true);
  expect(await saving).toBe(false);
});
