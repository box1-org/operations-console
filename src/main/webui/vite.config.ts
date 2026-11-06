import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Everything is bundled and served by the console pod: no CDN, no external fonts (decision D-001).
export default defineConfig({
  plugins: [react()],
  build: { outDir: '../../../target/webui-dist', emptyOutDir: true, sourcemap: false, assetsInlineLimit: 0 },
  server: { proxy: { '/api': 'http://localhost:8080', '/logout': 'http://localhost:8080', '/callback': 'http://localhost:8080' } },
});
