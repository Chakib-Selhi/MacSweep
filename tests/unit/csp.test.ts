import { describe, expect, it } from 'vitest';
import { DEV_CSP, PROD_CSP } from '../../src/main/csp';

describe('CSP de production', () => {
  it("n'autorise ni script inline, ni eval, ni connexion réseau", () => {
    expect(PROD_CSP).toContain("default-src 'none'");
    expect(PROD_CSP).toContain("script-src 'self'");
    expect(PROD_CSP).toContain("connect-src 'none'");
    expect(PROD_CSP).not.toContain('unsafe-inline');
    expect(PROD_CSP).not.toContain('unsafe-eval');
    expect(PROD_CSP).not.toMatch(/https?:/);
  });
});

describe('CSP de développement', () => {
  it("n'autorise que le serveur Vite local en plus", () => {
    expect(DEV_CSP).not.toContain('unsafe-eval');
    expect(DEV_CSP).toContain('ws://localhost:*');
    expect(DEV_CSP).not.toMatch(/https?:/);
  });
});
