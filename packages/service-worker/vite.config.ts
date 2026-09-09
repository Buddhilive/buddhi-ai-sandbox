import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/sw.ts'),
      name: 'BuddhiLiveSandboxSW',
      fileName: () => 'sw.js',
      formats: ['es'],
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
