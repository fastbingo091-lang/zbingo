import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'admin-ui',
  base: '/admin-v2/',
  plugins: [react()],
  build: {
    outDir: resolve(process.cwd(), 'public/admin-v2'),
    emptyOutDir: true,
    sourcemap: false,
  },
});
