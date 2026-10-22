import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:4000' } },
  build: {
    sourcemap: false,
    rollupOptions: { output: { manualChunks: { charts: ['recharts'], motion: ['framer-motion'], vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'] } } },
  },
});
