import type { ImageProviderAdapter } from './image-provider.ts';
export type AdapterResolver = (adapterId: string) => ImageProviderAdapter | undefined;
/** Per-library adapters own their spool and evidence; frozen tasks choose an exact version. */
export function adapterRegistry(adapters: ImageProviderAdapter[]): AdapterResolver {
  const registry = new Map<string, ImageProviderAdapter>();
  for (const adapter of adapters) {
    if (registry.has(adapter.adapterId)) throw Error('DUPLICATE_ADAPTER');
    registry.set(adapter.adapterId, adapter);
  }
  return id => registry.get(id);
}
