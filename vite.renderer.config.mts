import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import { DEV_CSP, PROD_CSP } from './src/main/csp.ts';

function cspMeta(): Plugin {
  let csp = PROD_CSP;
  return {
    name: 'macsweep-csp-meta',
    configResolved(config) {
      csp = config.command === 'serve' ? DEV_CSP : PROD_CSP;
    },
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: csp },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

export default defineConfig({
  plugins: [cspMeta(), react(), tailwindcss()],
});
