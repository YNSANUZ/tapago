import { defineConfig } from 'vite';

export default defineConfig({
  base: '/tapago/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
