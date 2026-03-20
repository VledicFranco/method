import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/viz/',
  build: {
    outDir: '../dist/viz',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/strategies': 'http://localhost:3456',
      '/api': 'http://localhost:3456',
    },
  },
});
