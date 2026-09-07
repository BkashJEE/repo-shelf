import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.SHELF_API ?? 'http://127.0.0.1:4877';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PORT) || 5177,
    strictPort: false,
    proxy: {
      '/api': { target: API, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
