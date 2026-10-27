import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

const backend = process.env.BACKEND ?? 'https://localhost:8443';

export default defineConfig({
  root: 'client',
  plugins: [vue()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) },
  },
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: backend, secure: false, changeOrigin: true },
      '/socket.io': { target: backend, secure: false, ws: true, changeOrigin: true },
    },
  },
});
