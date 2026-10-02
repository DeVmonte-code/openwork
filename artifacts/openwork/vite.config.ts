import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;
const localApiUrl = process.env.OPENWORK_LOCAL_API_URL;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

export default defineConfig({
  base: basePath,
  define: {
    "import.meta.env.VITE_OPENWORK_DEPLOYMENT": JSON.stringify("web"),
    "import.meta.env.VITE_DEN_REQUIRE_SIGNIN": JSON.stringify("1"),
    "import.meta.env.VITE_OPENWORK_DEN_PROXY_ENABLED": JSON.stringify("1"),
    // Unknown web origins cannot receive Den's approved redirect handoff.
    // Its existing paste-code flow works without changing upstream policy.
    "import.meta.env.VITE_OPENWORK_FORCE_MANUAL_AUTH": JSON.stringify(
      process.env.VITE_OPENWORK_FORCE_MANUAL_AUTH ?? "1",
    ),
    "import.meta.env.VITE_OPENWORK_APP_VERSION": JSON.stringify("0.0.0-dev"),
  },
  plugins: [
    react(),
    tailwindcss(),
    // Local browsers may inject extension errors unrelated to the app.
    // Keep Vite's own compile-error overlay; only skip the runtime modal.
    ...(localApiUrl ? [] : [runtimeErrorOverlay()]),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          // The imported UI uses generic JSX elements. Cartographer's
          // attribute injection cannot parse those without corrupting JSX.
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, "index.html"),
        overlay: path.resolve(import.meta.dirname, "overlay.html"),
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    // Local development only. Keep /api intact for the API server's existing
    // routes; Vite pipes raw requests/responses without parsing or buffering.
    ...(localApiUrl ? {
      proxy: {
        '/api': {
          target: localApiUrl,
          changeOrigin: true,
          ws: true,
        },
      },
    } : {}),
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
