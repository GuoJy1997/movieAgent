import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        external: ['sharp'],
        input: { index: resolve('src/main/index.ts'), 'engine-process': resolve('src/main/engine-process.ts'), 'mcp-stdio': resolve('src/main/mcp/stdio.ts') },
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  preload: { build: { rollupOptions: { input: { index: resolve('src/preload/index.ts'), credentials: resolve('src/preload/credentials.ts'), launcher: resolve('src/preload/launcher.ts'), 'model-config': resolve('src/preload/model-config.ts') }, output: { format: 'cjs', entryFileNames: '[name].js' } } } },
  renderer: {
    root: resolve('src'),
    // Keep static shared dependencies in each entry's HTML so protected windows
    // can allow those exact resources without widening their session boundary.
    build: { modulePreload: { polyfill: false }, rollupOptions: { input: { index: resolve('src/renderer/index.html'), credentials: resolve('src/credentials/index.html'), launcher: resolve('src/launcher/index.html'), 'model-config': resolve('src/model-config/index.html') } } },
    plugins: [
      {
        name: 'renderer-boundary',
        enforce: 'pre',
        resolveId(source) {
          if (/^(?:node:|electron$|@libtv\/(?:storage|providers|engine)(?:\/|$))/.test(source) || /packages[\\/](?:storage|providers|engine)[\\/]/.test(source)) {
            throw new Error(`Renderer cannot import privileged module: ${source}`);
          }
        },
      },
      react(),
    ],
  },
});
