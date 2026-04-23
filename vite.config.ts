import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  
  // Dynamically find existing game files so the build doesn't fail
  const entryPoints: Record<string, string> = {
    main: path.resolve(__dirname, 'index.html'),
  };

  for (let i = 1; i <= 20; i++) {
    const fileName = `spel${i}.html`;
    if (fs.existsSync(path.resolve(__dirname, fileName))) {
      entryPoints[`spel${i}`] = path.resolve(__dirname, fileName);
    }
  }

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    build: {
      rollupOptions: {
        input: entryPoints
      }
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
