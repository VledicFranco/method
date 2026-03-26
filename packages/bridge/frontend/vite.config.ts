import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/app/',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: '../dist/app',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-charts': ['recharts'],
          'vendor-xyflow': ['@xyflow/react', 'dagre'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/sessions/history': 'http://localhost:3456',
      '/sessions': 'http://localhost:3456',
      '/channels': 'http://localhost:3456',
      '/health': 'http://localhost:3456',
      '/pool': 'http://localhost:3456',
      '/strategies': 'http://localhost:3456',
      '/triggers': 'http://localhost:3456',
      '/api': 'http://localhost:3456',
      '/ws': { target: 'ws://localhost:3456', ws: true },
    },
  },
});
