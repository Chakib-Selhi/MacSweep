const COMMON_DIRECTIVES = [
  "default-src 'none'",
  "img-src 'self' data:",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
];

export const PROD_CSP = [
  ...COMMON_DIRECTIVES,
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'none'",
].join('; ');

// Vite injects inline scripts and styles for hot reload, and talks to its dev server over a WebSocket.
export const DEV_CSP = [
  ...COMMON_DIRECTIVES,
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' ws://localhost:*",
].join('; ');
