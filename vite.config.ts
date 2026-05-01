import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify—file watching is disabled to prevent flickering during agent edits.
    hmr: process.env.DISABLE_HMR !== 'true',
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React runtime — loaded on every page, keep tight
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          // Animation library — large, only needed after first paint
          'motion-vendor': ['motion'],
          // Supabase client — heavy, needed for auth/data but not in the
          // critical rendering path
          'supabase-vendor': ['@supabase/supabase-js'],
          // Icon set — tree-shaken by Rollup but the base module graph is
          // still sizeable; isolating it keeps the entry chunk clean
          'icons-vendor': ['lucide-react'],
          // Drag-and-drop — only used in the Produção (kanban) view
          'dnd-vendor': ['@hello-pangea/dnd'],
        },
      },
    },
  },
});
