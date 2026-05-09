import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/widget.ts',
      name: 'CopilotWidget',
      // Always output as widget.js regardless of format
      fileName: (_format) => 'widget.js',
      formats: ['iife'],
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
});
