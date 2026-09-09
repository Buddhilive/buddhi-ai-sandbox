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
      name: 'BuddhiLiveSandbox',
      fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      external: ['fflate'],
      output: {
        globals: {
          fflate: 'fflate',
        },
      },
    },
  },
});
