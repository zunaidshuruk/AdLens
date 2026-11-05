import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      dedupe: ['react', 'react-dom', 'react-router-dom'],
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-router-dom',
        'lucide-react',
        'recharts',
        'qrcode',
        'firebase/app',
        'firebase/auth',
        'firebase/firestore',
      ],
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    build: {
      target: 'es2022',
      sourcemap: false,
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          chunkFileNames(chunkInfo) {
            const safeName = (chunkInfo.name || 'chunk').replace(/error/gi, 'status');
            return `assets/${safeName}-[hash].js`;
          },
          // Vite 8 uses Rolldown: groups are matched by priority (higher first).
          // React core is pinned first so it is never parked inside the charts chunk,
          // which would force every first load to download all of the charts library.
          codeSplitting: {
            groups: [
              { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|react-is|use-sync-external-store)[\\/]/, priority: 40 },
              { name: 'vendor-icons', test: /node_modules[\\/]lucide-react[\\/]/, priority: 30 },
              { name: 'vendor-firebase', test: /node_modules[\\/](@firebase|firebase)[\\/]/, priority: 30 },
              { name: 'vendor-charts', test: /node_modules[\\/](recharts|d3-[a-z-]+|victory-vendor|@reduxjs|react-redux|redux|immer|reselect|es-toolkit|decimal\.js-light)[\\/]/, priority: 20 },
            ],
          },
        },
      },
    },
  };
});
