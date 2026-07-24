import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  // served at the subdomain root (sequence.razzrohith.com), not a sub-path
  base: '/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // split big vendors into their own long-cached chunks that download in
        // parallel with the app code, shrinking the main bundle
        manualChunks: {
          react: ['react', 'react-dom'],
          motion: ['framer-motion'],
          mqtt: ['mqtt'],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true, // reachable from phones on the same network

    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:3001',
      },
    },
  },
});
