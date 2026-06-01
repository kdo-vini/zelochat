import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
// Resolved once at build time and baked into the bundle. The backend computes
// the SAME value at build time (Dockerfile → /api/version), so both sides of a
// deploy match and the UpdateAvailableBanner only fires across deploys.
// In production PUBLIC_APP_VERSION is NOT set as an env here — Dockerfile.frontend
// derives the git commit (`git rev-parse HEAD`) and passes it in, so each deploy
// gets a distinct version. The fallbacks below only matter for local/manual
// builds; pkg.version (0.0.0) is the last resort and is fine in dev because the
// banner is suppressed when import.meta.env.DEV.
// Filter out unexpanded shell variables like "${SOURCE_COMMIT}" passed literally
// by some CI/CD systems (e.g. Dokploy, which does NOT expand SOURCE_COMMIT for
// Dockerfile builds — that bug is exactly why this guard exists).
const resolvedEnv = (s: string | undefined) =>
  s && !s.startsWith('${') ? s : undefined;

const buildVersion =
  resolvedEnv(process.env.PUBLIC_APP_VERSION) ||
  resolvedEnv(process.env.VITE_PUBLIC_APP_VERSION) ||
  resolvedEnv(process.env.SOURCE_COMMIT) ||
  resolvedEnv(process.env.GIT_COMMIT_SHA) ||
  pkg.version;

export default defineConfig({
  define: {
    __ZELO_BUILD_VERSION__: JSON.stringify(buildVersion),
  },
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
