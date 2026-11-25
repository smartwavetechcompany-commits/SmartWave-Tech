import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

function resolveAllowedHosts(env: Record<string, string>): string[] {
  const hosts = new Set<string>([
    'tidehotels.de',
    '.tidehotels.de',
    '.run.app',
    '.vercel.app',
  ]);

  const urlCandidates = [
    env.APP_URL,
    process.env.APP_URL,
    env.VITE_APP_URL,
    process.env.VITE_APP_URL,
  ];
  for (const raw of urlCandidates) {
    if (!raw) continue;
    try {
      const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
      if (parsed.hostname) {
        hosts.add(parsed.hostname);
      }
    } catch {
      // Ignore malformed env URL
    }
  }

  const extraHosts = (env.ALLOWED_HOSTS || process.env.ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  for (const host of extraHosts) {
    hosts.add(host);
  }

  return Array.from(hosts);
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const allowedHosts = resolveAllowedHosts(env);
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: [
        { find: '@', replacement: path.resolve(__dirname, '.') },
        { find: /^date-fns$/, replacement: path.resolve(__dirname, 'src/utils/safeDateFns.ts') },
        { find: 'date-fns-raw', replacement: path.resolve(__dirname, 'node_modules/date-fns/index.js') },
      ],
    },
    optimizeDeps: {
      include: ['date-fns-raw'],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('/firebase/') || id.includes('/@firebase/')) return 'vendor-firebase';
            if (id.includes('/xlsx/')) return 'vendor-xlsx';
            if (id.includes('/jspdf') || id.includes('/html2canvas/')) return 'vendor-pdf';
            if (id.includes('/recharts/') || id.includes('/d3-')) return 'vendor-charts';
            if (id.includes('/lucide-react/')) return 'vendor-icons';
            return undefined;
          },
        },
      },
    },
    server: {
      allowedHosts,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    preview: {
      allowedHosts,
    },
  };
});
