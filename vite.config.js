import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        estado: resolve(__dirname, 'estado.html'),
        voters: resolve(__dirname, 'voters.html'),
        story: resolve(__dirname, 'story.html'),
        misread: resolve(__dirname, 'misread.html'),
        shadeByVotes: resolve(__dirname, 'shade-by-votes.html'),
        sources: resolve(__dirname, 'sources.html'),
        why: resolve(__dirname, 'why.html'),
        relative: resolve(__dirname, 'relative.html'),
        history: resolve(__dirname, 'history.html'),
      },
    },
  },
  worker: {
    format: 'es',
  },
  plugins: [
    {
      name: 'copy-data-folder',
      closeBundle() {
        const src = resolve(__dirname, 'data');
        const dest = resolve(__dirname, 'dist', 'data');
        if (fs.existsSync(src)) {
          fs.cpSync(src, dest, { recursive: true });
        }
      },
    },
  ],
});
