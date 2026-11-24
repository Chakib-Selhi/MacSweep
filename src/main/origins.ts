import path from 'node:path';

export const APP_SCHEME = 'app';
export const APP_HOST = 'macsweep';
export const APP_ENTRY_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

export function mimeTypeFor(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

const LOCAL_ONLY_PROTOCOLS = new Set(['devtools:', 'data:', 'blob:']);

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function isAppUrl(url: string): boolean {
  const parsed = parse(url);
  return parsed?.protocol === `${APP_SCHEME}:` && parsed.host === APP_HOST;
}

function isDevServerUrl(
  url: string,
  devServerUrl: string | undefined,
  protocols: readonly string[],
): boolean {
  if (!devServerUrl) return false;
  const parsed = parse(url);
  const dev = parse(devServerUrl);
  if (!parsed || !dev) return false;
  return protocols.includes(parsed.protocol) && parsed.host === dev.host;
}

export function isTrustedSenderUrl(url: string, devServerUrl: string | undefined): boolean {
  return isAppUrl(url) || isDevServerUrl(url, devServerUrl, ['http:']);
}

export function isAllowedRequestUrl(url: string, devServerUrl: string | undefined): boolean {
  if (isAppUrl(url) || isDevServerUrl(url, devServerUrl, ['http:', 'ws:'])) return true;
  const parsed = parse(url);
  return parsed !== null && LOCAL_ONLY_PROTOCOLS.has(parsed.protocol);
}

export function resolveRendererFile(rendererDir: string, url: string): string | null {
  const parsed = parse(url);
  if (!parsed || !isAppUrl(url)) return null;

  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;

  const root = path.resolve(rendererDir);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolved = path.resolve(root, relative);
  return resolved.startsWith(root + path.sep) ? resolved : null;
}
