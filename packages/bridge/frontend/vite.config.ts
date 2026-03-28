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
      'crypto': resolve(__dirname, 'src/shared/crypto-shim.ts'),
      'node:crypto': resolve(__dirname, 'src/shared/crypto-shim.ts'),
      // Use local GlyphJS source with React 18 compat patches
      '@glyphjs/compiler': resolve(__dirname, '../../../../oss-glyphjs/packages/compiler/src/index.ts'),
      '@glyphjs/runtime': resolve(__dirname, '../../../../oss-glyphjs/packages/runtime/src/index.ts'),
      '@glyphjs/components': resolve(__dirname, '../../../../oss-glyphjs/packages/components/src/index.ts'),
      '@glyphjs/types': resolve(__dirname, '../../../../oss-glyphjs/packages/types/src/index.ts'),
      '@glyphjs/schemas': resolve(__dirname, '../../../../oss-glyphjs/packages/schemas/src/index.ts'),
      '@glyphjs/parser': resolve(__dirname, '../../../../oss-glyphjs/packages/parser/src/index.ts'),
      '@glyphjs/ir': resolve(__dirname, '../../../../oss-glyphjs/packages/ir/src/index.ts'),
    },
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
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
