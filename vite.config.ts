import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(import.meta.dirname, 'sidepanel.html'),
        demo: resolve(import.meta.dirname, 'demo.html'),
        fixture: resolve(import.meta.dirname, 'fixture.html'),
        smoke: resolve(import.meta.dirname, 'smoke.html'),
      },
    },
  },
});
