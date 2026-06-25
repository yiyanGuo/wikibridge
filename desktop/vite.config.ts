import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true
  },
  resolve: {
    alias:
      mode === 'system-test'
        ? {
            '@tauri-apps/api/core': path.resolve(__dirname, 'src/system-test/tauri-core-mock.ts'),
            '@tauri-apps/plugin-dialog': path.resolve(__dirname, 'src/system-test/dialog-mock.ts')
          }
        : {}
  },
  envPrefix: ['VITE_', 'TAURI_']
}));
