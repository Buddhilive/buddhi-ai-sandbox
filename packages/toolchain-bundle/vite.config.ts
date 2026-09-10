import { resolve } from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      rollupTypes: true,
      include: ['src/**/*'],
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'BuddhiLiveSandboxToolchain',
      fileName: () => 'index.js',
      formats: ['es'],
    },
    rollupOptions: {
      external: ['esbuild-wasm', 'wa-sqlite'],
    },
  },
});
