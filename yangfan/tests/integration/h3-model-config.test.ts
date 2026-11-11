import { expect, it } from 'vitest';
import { ADAPTER_TYPES, isModelCapabilities } from '../../packages/contracts/src/models.ts';
import { createHttpTransport } from '../../packages/providers/src/http-transport.ts';

it('registers an explicit H3 adapter and audio-reference capability without guessing by model ID', () => {
  expect(ADAPTER_TYPES).toContain('minimax-h3-v2');
  expect(isModelCapabilities({ taskTypes: ['text_to_video', 'image_to_video'], inputKinds: ['text', 'image', 'audio'], outputKinds: ['video'], maxBatch: 1 })).toBe(true);
  expect(isModelCapabilities({ taskTypes: ['text_to_video', 'image_to_video'], inputKinds: ['text', 'image'], outputKinds: ['video'], maxBatch: 1 })).toBe(true);
});

it('keeps the legacy transport restriction while allowing bounded H3 JSON only', async () => {
  const transport = createHttpTransport();
  const connection: any = { adapterType: 'minimax-h3-v2', baseUrl: 'http://127.0.0.1:1', networkPolicy: { privateEndpoint: { hostname: '127.0.0.1', port: 1, purpose: 'model-api' } }, timeoutMs: 1000 };
  await expect(transport.video(connection, Buffer.alloc(48000001), {})).rejects.toThrow();
  await expect(transport.video({ ...connection, adapterType: 'minimax-video-v2' }, Buffer.alloc(128 * 1024 + 1), {})).rejects.toThrow();
});
