import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  // served at the subdomain root (sequence.razzrohith.com), not a sub-path
  base: '/',
  plugins: [react()],
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
