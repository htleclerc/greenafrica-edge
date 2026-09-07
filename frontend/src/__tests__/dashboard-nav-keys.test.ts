import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Les libellés de la barre latérale, dans les six langues.
 *
 * `DashboardSidebar` fait `useTranslations('Dashboard')` et résout ses
 * libellés DYNAMIQUEMENT, depuis un tableau de `labelKey`. Aucune analyse
 * statique ne les voit, et `next-intl` LÈVE sur une clé absente : l'exception
 * remonte à la frontière d'erreur du groupe `(dashboard)`, qui affiche
 * « Une erreur s'est produite » sans dire laquelle.
 *
 * C'est arrivé en production le 2026-09-07 : `nav_admin_validations` avait été
 * posée dans le namespace `Navigation` au lieu de `Dashboard`, dans les six
 * fichiers. La clé existait — un grep la trouvait — mais pas là où le sidebar
 * la cherche. Un SUPERADMIN ouvrant « Ma Flotte » tombait sur l'écran d'erreur.
 *
 * La porte CI ne validait que la syntaxe JSON des fichiers de langue, ce qui ne
 * dit rien de la couverture des clés. Ce test comble ce trou.
 */

const LOCALES = ['en', 'fr', 'pt', 'sw', 'so', 'ar'] as const;

const root = join(__dirname, '..', '..');

function readJson(relative: string): Record<string, Record<string, string>> {
    return JSON.parse(readFileSync(join(root, relative), 'utf8'));
}

function sidebarLabelKeys(): string[] {
    const src = readFileSync(
        join(root, 'src/components/dashboard/layout/DashboardSidebar.tsx'),
        'utf8',
    );
    const keys = Array.from(src.matchAll(/labelKey:\s*'([^']+)'/g)).map((m) => m[1]);
    return Array.from(new Set(keys));
}

describe('libellés de la barre latérale', () => {
    const keys = sidebarLabelKeys();

    // Si l'extraction casse un jour, le test passerait à vide sans rien
    // garantir. On ancre donc un plancher.
    it('en extrait un nombre plausible', () => {
        expect(keys.length).toBeGreaterThan(20);
    });

    for (const locale of LOCALES) {
        it(`${locale} — chaque libellé existe dans le namespace Dashboard`, () => {
            const messages = readJson(`messages/${locale}.json`);
            const dashboard = messages.Dashboard ?? {};
            const missing = keys.filter((k) => !(k in dashboard));
            expect(missing).toEqual([]);
        });
    }

    // Le résidu est ce qui rend le bug trompeur : la clé se trouve dans le
    // dépôt, mais dans un namespace que personne ne lit.
    it("ne laisse aucun libellé du sidebar traîner dans le namespace Navigation", () => {
        for (const locale of LOCALES) {
            const messages = readJson(`messages/${locale}.json`);
            const navigation = messages.Navigation ?? {};
            const strays = keys.filter((k) => k in navigation);
            expect(strays, `${locale} porte des libellés de sidebar dans Navigation`).toEqual([]);
        }
    });
});
