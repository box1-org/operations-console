import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: '../../../target/webui-dist', emptyOutDir: true, sourcemap: false },
});
