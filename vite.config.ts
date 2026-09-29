import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: [
        // frappe-gantt's `exports` map exposes its stylesheet only under a
        // "style" condition, which bundlers cannot resolve, and it does not
        // expose ./dist/*. This alias points the documented stylesheet path at
        // the real file without patching node_modules.
        {
          find: 'frappe-gantt/dist/frappe-gantt.css',
          replacement: path.resolve(
            __dirname,
            'node_modules/frappe-gantt/dist/frappe-gantt.css',
          ),
        },
        {
          find: '@',
          replacement: path.resolve(__dirname, '.'),
        },
      ],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
