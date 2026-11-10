import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [tailwindcss(), react()],
  build: {
    chunkSizeWarningLimit: 1000
  },
  server: {
    host: true,
    port: 5174,
    allowedHosts: true
  }
});
