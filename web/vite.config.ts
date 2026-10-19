import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const backend = process.env.CODESTREAM_WEB_PORT ?? '3000';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [],
  resolve: {
    // react/react-dom/scheduler are vendored in web/node_modules (offline cache copy).
    dedupe: ['react', 'react-dom'],
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': `http://localhost:${backend}`,
      '/auth': `http://localhost:${backend}`,
      '/healthz': `http://localhost:${backend}`,
    },
  },
  build: {
    outDir: '../web-dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
  },
});
