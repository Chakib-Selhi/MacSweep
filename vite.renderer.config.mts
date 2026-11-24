import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import { DEV_CSP, PROD_CSP } from './src/main/csp.ts';

// Browsers ignore frame-ancestors in a <meta> tag; the HTTP header of the app:// protocol keeps it.
const forMeta = (policy: string) =>
  policy
    .split('; ')
    .filter((directive) => !directive.startsWith('frame-ancestors'))
    .join('; ');

function cspMeta(): Plugin {
  let csp = forMeta(PROD_CSP);
  return {
    name: 'macsweep-csp-meta',
    configResolved(config) {
      csp = forMeta(config.command === 'serve' ? DEV_CSP : PROD_CSP);
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
