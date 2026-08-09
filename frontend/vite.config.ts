import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  root: fileURLToPath(new URL('./admin', import.meta.url)),
  plugins: [vue(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    outDir: '../../dist',
    assetsDir: 'admin/assets',
    emptyOutDir: true,
    sourcemap: false,
  },
});
