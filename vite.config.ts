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
      alias: {
        '@': path.resolve(__dirname, '.'),
        'date-fns': path.resolve(__dirname, 'src/utils/safeDateFns.ts'),
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
