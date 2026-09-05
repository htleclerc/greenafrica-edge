import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

beforeEach(() => {
    vi.resetModules();
    // `NODE_ENV` est typée en lecture seule par Next : seul stubEnv permet de
    // la faire varier sans casser le typecheck.
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

function loggedErrors(): string {
    return (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat().join(' ');
}

describe('appBaseUrl', () => {
    it('rend la valeur configurée', async () => {
        vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://greengate.africa');
        const { appBaseUrl } = await import('./appUrl');
        expect(appBaseUrl()).toBe('https://greengate.africa');
    });

    // Une barre finale produisait `https://greengate.africa//owner/auth/callback`,
    // que GoTrue compare littéralement à sa liste d'URLs autorisées.
    it('retire la barre oblique finale', async () => {
        vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://greengate.africa///');
        const { appBaseUrl } = await import('./appUrl');
        expect(appBaseUrl()).toBe('https://greengate.africa');
    });

    it('ignore une valeur vide ou blanche', async () => {
        vi.stubEnv('NEXT_PUBLIC_APP_URL', '   ');
        const { appBaseUrl } = await import('./appUrl');
        expect(appBaseUrl()).toBe('http://localhost:3300');
    });

    it('replie silencieusement hors production — dev et tests doivent rester muets', async () => {
        vi.stubEnv('NODE_ENV', 'test');
        const { appBaseUrl } = await import('./appUrl');
        expect(appBaseUrl()).toBe('http://localhost:3300');
        expect(loggedErrors()).toBe('');
    });

    it('crie en production quand la variable manque', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        const { appBaseUrl } = await import('./appUrl');
        expect(appBaseUrl()).toBe('http://localhost:3300');
        const logged = loggedErrors();
        expect(logged).toContain('NEXT_PUBLIC_APP_URL');
        expect(logged).toContain('BUILD');
    });

    it("n'avertit qu'une fois, pour ne pas noyer les journaux", async () => {
        vi.stubEnv('NODE_ENV', 'production');
        const { appBaseUrl } = await import('./appUrl');
        appBaseUrl(); appBaseUrl(); appBaseUrl();
        expect((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(1);
    });
});
