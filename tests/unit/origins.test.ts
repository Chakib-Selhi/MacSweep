import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APP_ENTRY_URL,
  isAllowedRequestUrl,
  isTrustedSenderUrl,
  mimeTypeFor,
  resolveRendererFile,
} from '../../src/main/origins';

const DEV = 'http://localhost:5173';

describe('isTrustedSenderUrl', () => {
  it("accepte la page de l'app", () => {
    expect(isTrustedSenderUrl(APP_ENTRY_URL, undefined)).toBe(true);
  });

  it('accepte le serveur Vite seulement en dev', () => {
    expect(isTrustedSenderUrl(`${DEV}/`, DEV)).toBe(true);
    expect(isTrustedSenderUrl(`${DEV}/`, undefined)).toBe(false);
  });

  it.each([
    'https://example.com/',
    'http://localhost:9999/',
    'app://autre-hote/index.html',
    'file:///Users/x/index.html',
    '',
    'pas une url',
  ])('refuse %s', (url) => {
    expect(isTrustedSenderUrl(url, DEV)).toBe(false);
  });
});

describe('isAllowedRequestUrl', () => {
  it('bloque toute requête réseau sortante', () => {
    expect(isAllowedRequestUrl('https://example.com/track', undefined)).toBe(false);
    expect(isAllowedRequestUrl('http://192.168.1.1/', DEV)).toBe(false);
    expect(isAllowedRequestUrl('wss://example.com/', DEV)).toBe(false);
  });

  it("autorise les ressources de l'app et le serveur Vite en dev", () => {
    expect(isAllowedRequestUrl('app://macsweep/assets/index.js', undefined)).toBe(true);
    expect(isAllowedRequestUrl(`${DEV}/src/renderer/main.tsx`, DEV)).toBe(true);
    expect(isAllowedRequestUrl('ws://localhost:5173/', DEV)).toBe(true);
    expect(isAllowedRequestUrl('data:image/png;base64,AAAA', undefined)).toBe(true);
  });
});

describe('resolveRendererFile', () => {
  const root = path.resolve('/tmp/renderer');

  it("sert index.html à la racine et les fichiers sous le dossier de l'interface", () => {
    expect(resolveRendererFile(root, 'app://macsweep/')).toBe(path.join(root, 'index.html'));
    expect(resolveRendererFile(root, 'app://macsweep/assets/a.js')).toBe(
      path.join(root, 'assets/a.js'),
    );
  });

  it('garde les .. normalisés par le parseur d’URL dans le dossier de l’interface', () => {
    expect(resolveRendererFile(root, 'app://macsweep/../../etc/passwd')).toBe(
      path.join(root, 'etc/passwd'),
    );
    expect(resolveRendererFile(root, 'app://macsweep/%2e%2e/secret')).toBe(
      path.join(root, 'secret'),
    );
  });

  it.each([
    'app://macsweep/..%2F..%2Fetc%2Fpasswd',
    'app://macsweep/a%00.js',
    'app://macsweep/%E0%A4%A',
    'app://autre/index.html',
    'file:///etc/passwd',
  ])('refuse %s', (url) => {
    expect(resolveRendererFile(root, url)).toBeNull();
  });
});

describe('mimeTypeFor', () => {
  it('donne le bon type aux modules JavaScript et un type neutre au reste', () => {
    expect(mimeTypeFor('/a/index.JS')).toBe('text/javascript; charset=utf-8');
    expect(mimeTypeFor('/a/index.html')).toBe('text/html; charset=utf-8');
    expect(mimeTypeFor('/a/inconnu.bin')).toBe('application/octet-stream');
  });
});
